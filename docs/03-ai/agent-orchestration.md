# 智能体编排

- 状态：`accepted`
- 相关决策：[ADR-0004](../09-decisions/0004-state-machine-runtime.md)

## 原则

不让框架替代领域设计。教学正确性由显式状态和规则保证，大模型负责自然语言、内容组织和受控工具选择。

## 三层结构

### 教学状态机（设计定稿见 ADR-0004）

**脊柱状态**只有五个，管理课程推进：

```text
DIAGNOSE → EXPLAIN → DEMONSTRATE → PRACTICE → ASSESS
```

- REMEDIATE 和 ADVANCE 不是状态，是 ASSESS 的出口决策：REMEDIATE 带着误区标签转回 EXPLAIN 或 PRACTICE；ADVANCE 结束当前知识点并推荐下一个；
- **自由问答是横切能力**：任何状态内学生提问，模型直接回答，脊柱状态不变；学生跳题使用深度为 1 的中断栈，处理完恢复原状态；
- **转移权在 runtime**：模型只能请求转移或由工具结果触发，runtime 用 guard 校验（练习量、掌握度阈值等）；
- **初始状态由 runtime 显式决定**：新学生进 DIAGNOSE，有掌握记录的学生可直接进 EXPLAIN，数据库不设默认值；
- 每次转移写入 `learning_events`（`event_type: state_transition`），可回放可审计。

### Agent Tool Loop

#### 当前实现状态

| 能力                                      | 状态       | 当前边界                                                        |
| ----------------------------------------- | ---------- | --------------------------------------------------------------- |
| 五态教学状态机、guard与中断恢复纯函数     | 已实现     | `packages/teaching-core/src/state-machine.ts`                   |
| 工具名称闭集与“状态 × 工具”白名单         | 已实现     | `packages/teaching-core/src/tools.ts`；只判断已解析工具是否获准 |
| 模型与知识检索Port                        | 已实现契约 | 仅有供应商无关接口，尚无真实适配器                              |
| Turn Orchestrator与状态感知Prompt         | 待实现     | 尚未形成模型调用—工具执行—状态推进循环                          |
| 工具参数Schema注册表与白名单Tool Executor | 待实现     | 未知工具解析、参数校验、权限和执行隔离尚未落地                  |
| 工具超时、重试、幂等、限流与审计          | 待实现     | 属于运行时执行策略，不能由当前白名单替代                        |
| Prompt/Trace持久化与Agent评测             | 待实现     | 尚无完整调用链审计与回放                                        |

初始工具：

- `retrieveKnowledge`
- `getStudentState`
- `renderCanvas`
- `generateQuiz`
- `gradeAnswer`
- `requestHint`
- `updateMisconception`
- `recommendNextNode`

完整运行时中的工具必须有Schema校验、权限、超时、幂等、限流和审计。**每个脊柱状态绑定工具白名单**，runtime 按当前状态限制可调用集合，越权调用直接拒绝并记录。当前代码只实现工具闭集和白名单判断，不能把这些运行时要求视为已经完成。

阶段一白名单由`packages/teaching-core/src/tools.ts`维护：

| 状态          | 允许工具                                                                                                                    |
| ------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `DIAGNOSE`    | `retrieveKnowledge`、`getStudentState`、`generateQuiz`、`gradeAnswer`、`requestHint`、`updateMisconception`                 |
| `EXPLAIN`     | `retrieveKnowledge`、`getStudentState`、`renderCanvas`、`requestHint`                                                       |
| `DEMONSTRATE` | `retrieveKnowledge`、`getStudentState`、`renderCanvas`、`requestHint`                                                       |
| `PRACTICE`    | `retrieveKnowledge`、`getStudentState`、`renderCanvas`、`generateQuiz`、`gradeAnswer`、`requestHint`、`updateMisconception` |
| `ASSESS`      | `getStudentState`、`generateQuiz`、`gradeAnswer`、`requestHint`、`updateMisconception`、`recommendNextNode`                 |

工具获准不等于结果自动可信：`gradeAnswer`仍需服务端答案判定，状态转移仍需guard，掌握度仍只消费可信领域事件。

### 持久工作流

Temporal负责教材处理、批量生成、学习报告、定时任务和Embedding迁移等长流程。按 ADR-0003，阶段一不引入。

## 框架边界

- LangChain不作为核心依赖；
- LangGraph只在复杂内容生产、人工审核或多分支工作流中按需使用；
- AI SDK可用于Web流式消息和类型化工具；
- 领域状态保存在自己的数据库和代码中，不保存在第三方Agent框架内部。

## 开放问题

- PRACTICE进入ASSESS所需的最少练习证据量由课程配置提供，待猫狗课程规格确定；
- 深度为1的中断状态当前使用 `lesson_sessions.interrupted_state` 持久化；若未来支持嵌套中断，需要新ADR决定是否改为独立栈结构。
