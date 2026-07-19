# ADR-0017：统一 Agent Runtime 与 Notebook 上下文

- 状态：`accepted`
- 日期：2026-07-19
- 决策人：项目负责人

## 背景

决策时通用Chat与K12纵切仍拥有两套模型/工具循环，历史数据也同时存在通用Conversation与教学Session。多渠道Gateway如果建立在这套双轨结构上，只会把重复运行路径暴露给更多入口。

## 决定

1. 所有正常 Agent Turn 最终只进入 `agent-runtime` 的一个生产循环；Profile、Skill、Tool 和领域服务不能拥有另一套模型循环。
2. Runtime 统一负责 Context Engine、模型运行、工具圈、预算、取消、终态、Trace 和可恢复事件；Model Gateway 只做供应商适配。
3. Notebook 是用户侧长期上下文与归属单位，整体拥有 Sources、Conversation、Artifact/Studio、当前 Profile、相关记忆和运行记录。
4. 内部继续以 Space 作为归属根；一个 Notebook 可以逐步容纳多条 Conversation，不再把一对一关系写成永久约束。
5. Channel Thread 必须确定性绑定 User、Notebook 和 Conversation。未绑定消息进入显式 Inbox Notebook 或要求用户选择，禁止模型猜测归属。
6. Context Engine 按预算装配 Profile/System、Notebook 摘要、最近消息、选中来源、当前 Artifact、相关记忆和本轮多模态附件，并记录 Context Snapshot。
7. 普通教育问答无需课程状态。诊断、讲解、示范、练习、测评的状态流程是可选结构化课程 Workflow，与普通问答共享同一 Agent Loop。
8. 历史实现中的固定 answer/synthesis 两阶段和固定两次模型调用只是兼容行为，不是长期 Runtime 契约；长期由显式 TurnBudget 限制模型运行、工具圈、耗时和资源。
9. Notebook 可以是私人或共享资源域。共享 Notebook 只授予其 Sources、Conversations、Artifacts 和明确标记的 Notebook Memory，不继承成员个人 Agent 的私人 Memory、Credential、Node 或默认工具授权。
10. 共享 Notebook 中的 Turn 同时记录 `actorUserId`、`agentId` 和 `notebookId`；Runtime 使用 Actor 权限与 Notebook 授权的交集装配 Context 和工具能力。

## 后果

- `general-turn.ts`、`TeachingTurnOrchestrator` 和重复 Tool Executor 必须逐步收敛；
- `lesson_sessions` 退回结构化课程上下文，不再拥有通用消息；
- Web、TUI 和渠道共享同一消息、终态、引用和恢复语义；
- `/learn` 只作为迁移期兼容入口，教育能力最终由统一客户端中的默认 Profile 提供。
- 家庭或班级协作不需要创建共享 Agent Runtime；同一 Notebook 中的参与者仍由各自 Agent 发起并留下独立 Actor 审计。

## 验证方式

- 仓库只存在一个生产 Agent Loop；
- 普通教育问答在没有 `lessonState` 时运行且不产生虚假学习事件；
- 结构化课程继续通过状态 guard、判分和恢复测试；
- Web、TUI、Channel Fixture 切换 Notebook 时 Sources、Conversation 和 Studio 整体切换；
- Context Snapshot 能解释每个片段的来源、版本与预算。
- 共享 Notebook 测试证明私人 Memory、Credential 和 Node Capability 不会进入其他成员的 Context 或 Tool Policy。

## 实施状态（2026-07-19）

`AgentLoopEngine`现为唯一生产模型/工具循环；General、Teaching与Gateway Runner都只注入Profile/Prompt/工具回调。User/Personal Agent、Notebook Membership和Actor审计已落库，Web/TUI同路由与共享contributor/viewer权限已有测试。Notebook摘要、长期记忆、Artifact Context与原生多模态仍是Context Engine后续能力，不影响循环统一已经完成的事实。
