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
| 模型与知识检索Port                        | 部分实现       | 正常Turn使用供应商无关流事件；OpenAI-compatible真实Adapter已实现；审核资料FTS/快照/候选/引用仓储已落地，Turn工具接线仍待实现 |
| Turn Orchestrator与状态感知Prompt         | 已实现运行骨架 | 支持一次直答或`answer → tools → synthesis`硬上限两次运行；answer可哈希Prompt材料由唯一纯函数构建          |
| 工具参数Schema注册表与白名单Tool Executor | 已实现基础层   | 已覆盖未知工具、参数/输出Schema、权限交集、整批预检和执行隔离                                             |
| 工具超时、重试、幂等、限流与审计          | 部分实现       | 已有读超时取消、写超时结果未知、持久工具幂等、Turn限流、脱敏工具账本与租约恢复；分布式配额和自动重试策略待实现 |
| Prompt/Trace持久化与Agent评测             | 部分实现       | 消息、模型运行、工具调用、安全决策和Prompt hash已持久化；真实课程质量、RAG和Agent教学效果评测仍待建立       |
| 可信状态推进、投影与回放                   | Core/Runtime已实现 | 状态应用服务使用guard、UoW、乐观锁与幂等事实；尚未接入Web判分后的应用组合根                                |

runtime可识别的初始教学操作：

- `retrieveKnowledge`
- `getStudentState`
- `renderCanvas`
- `generateQuiz`
- `gradeAnswer`
- `requestHint`
- `updateMisconception`
- `recommendNextNode`

这些名称不等于全部向模型开放。模型每轮实际可见集合是“权威状态白名单 ∩ 已注册Handler ∩ `exposure=model`”；`gradeAnswer`等可信操作应由Canvas事件或runtime触发，不能仅因名称在闭集中就暴露。执行器会在启动Handler前完成整批预检；运行期失败后立即停止，含写工具的多调用批次直接拒绝。写工具软超时只表示结果未知，不能自动重试。阶段一已把工具结果、稳定错误和幂等事实写入脱敏账本；生产强化仍需分布式分层配额、正式告警和经批准的重试策略。

阶段一白名单由`packages/teaching-core/src/tools.ts`维护：

| 状态          | 允许工具                                                                                                                    |
| ------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `DIAGNOSE`    | `retrieveKnowledge`、`getStudentState`、`generateQuiz`、`gradeAnswer`、`requestHint`、`updateMisconception`                 |
| `EXPLAIN`     | `retrieveKnowledge`、`getStudentState`、`renderCanvas`、`requestHint`                                                       |
| `DEMONSTRATE` | `retrieveKnowledge`、`getStudentState`、`renderCanvas`、`requestHint`                                                       |
| `PRACTICE`    | `retrieveKnowledge`、`getStudentState`、`renderCanvas`、`generateQuiz`、`gradeAnswer`、`requestHint`、`updateMisconception` |
| `ASSESS`      | `getStudentState`、`generateQuiz`、`gradeAnswer`、`requestHint`、`updateMisconception`、`recommendNextNode`                 |

工具获准不等于结果自动可信：`gradeAnswer`仍需服务端答案判定，状态转移仍需guard，掌握度仍只消费可信领域事件。

当前`TeachingTurnOrchestrator.streamTurn()`是正常教学轮次唯一入口：直接回答只运行`phase=answer`；出现受控工具调用时，runtime执行整批预检与工具Handler，再把自包含的工具调用/结果交换交给唯一一次`phase=synthesis`。正常轮次不再使用结构化`TeachingTurnPlan`，也不会调用`generateStructured()`。两个路径都刻意只返回`STAY`：直接回答不改变脊柱状态；工具执行结果也不会自动触发状态转移。

可信状态推进由独立应用服务完成：`state_transition`冻结当时的策略版本、最少练习量与实践证据；`assessment_graded`冻结掌握度算法参数和先修快照；ASSESS 的 `ADVANCE` 不伪装成脊柱状态，而写入 `assessment_exit_decided` 决策事实。同一causation重放原决定，投影器优先使用事件内快照，避免策略升级改写历史。在线事件还校验生产者、闭集reason及from/to语义；只有显式`migration`通道兼容旧事实。

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
