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

| 能力                                      | 状态           | 当前边界                                                                                                  |
| ----------------------------------------- | -------------- | --------------------------------------------------------------------------------------------------------- |
| 五态教学状态机、guard与中断恢复纯函数     | 已实现         | `packages/teaching-core/src/state-machine.ts`                                                             |
| 工具名称闭集与“状态 × 工具”白名单         | 已实现         | `packages/teaching-core/src/tools.ts`；只判断已解析工具是否获准                                           |
| 模型与知识检索Port                        | 已实现契约     | 有确定性Scripted Model Gateway测试替身；尚无真实供应商与RAG适配器                                         |
| Turn Orchestrator与状态感知Prompt         | 已实现最小纵切 | 支持结构化直接回答/工具计划；工具结果二次合成与持久化尚未实现                                             |
| 工具参数Schema注册表与白名单Tool Executor | 已实现基础层   | 已覆盖未知工具、参数/输出Schema、权限交集、整批预检和执行隔离                                             |
| 工具超时、重试、幂等、限流与审计          | 部分实现       | 已有读超时取消、写超时结果未知、有界进程内幂等和非阻塞脱敏审计Hook；持久幂等、重试、限流与Trace存储待实现 |
| Prompt/Trace持久化与Agent评测             | 待实现         | 尚无完整调用链审计与回放                                                                                  |

runtime可识别的初始教学操作：

- `retrieveKnowledge`
- `getStudentState`
- `renderCanvas`
- `generateQuiz`
- `gradeAnswer`
- `requestHint`
- `updateMisconception`
- `recommendNextNode`

这些名称不等于全部向模型开放。模型每轮实际可见集合是“权威状态白名单 ∩ 已注册Handler ∩ `exposure=model`”；`gradeAnswer`等可信操作应由Canvas事件或runtime触发，不能仅因名称在闭集中就暴露。执行器会在启动Handler前完成整批预检；运行期失败后立即停止，含写工具的多调用批次直接拒绝。写工具软超时只表示结果未知，不能自动重试。完整生产运行时还必须补齐持久幂等、限流、重试策略和Trace存储。

阶段一白名单由`packages/teaching-core/src/tools.ts`维护：

| 状态          | 允许工具                                                                                                                    |
| ------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `DIAGNOSE`    | `retrieveKnowledge`、`getStudentState`、`generateQuiz`、`gradeAnswer`、`requestHint`、`updateMisconception`                 |
| `EXPLAIN`     | `retrieveKnowledge`、`getStudentState`、`renderCanvas`、`requestHint`                                                       |
| `DEMONSTRATE` | `retrieveKnowledge`、`getStudentState`、`renderCanvas`、`requestHint`                                                       |
| `PRACTICE`    | `retrieveKnowledge`、`getStudentState`、`renderCanvas`、`generateQuiz`、`gradeAnswer`、`requestHint`、`updateMisconception` |
| `ASSESS`      | `getStudentState`、`generateQuiz`、`gradeAnswer`、`requestHint`、`updateMisconception`、`recommendNextNode`                 |

工具获准不等于结果自动可信：`gradeAnswer`仍需服务端答案判定，状态转移仍需guard，掌握度仍只消费可信领域事件。

当前`TeachingTurnOrchestrator`刻意只返回`STAY`：直接回答不改变脊柱状态；工具执行结果也不会自动触发状态转移。后续状态转移应用服务必须通过guard、Unit of Work与`state_transition`可信事件完成，不能在模型计划中直接增加可持久化状态字段。

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
