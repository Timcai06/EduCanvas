# ADR-0008：消息、模型 Trace 与刷新恢复

- 状态：`accepted`
- 日期：2026-07-15
- 负责人：@Timcai06
- 实现状态：契约已接受；数据库账本与应用服务待 PR-D1/A2 落地

## 背景

当前学生消息只存在浏览器内存，刷新后丢失；模型运行没有独立账本，无法回答“哪条老师消息由哪次 Provider 调用产生”。把 SSE 当作事实源或只保存最终文本，都无法处理重复提交、取消/完成竞争、进程中断和恢复。

## 决定

1. 阶段一复用 `lesson_sessions` 作为主要对话容器，生命周期为 `active / archived`；新建学习保留旧 session，恢复学习在同一可信身份与课程范围内事务性切换 active session；
2. `clientMessageId` 是发送 Turn 的唯一幂等键。同 session 下同 ID + 同规范化正文返回原 Turn；同 ID + 不同正文稳定返回 `message_id_conflict`，且不调用 Provider；
3. 用户可见事实写入 `chat_messages`，运行 Trace 写入 `model_runs`。浏览器不提交可信 `studentId` 或 `sessionId`，所有权由服务端 Cookie 与课程范围恢复；
4. 消息状态只允许 `pending → streaming → completed | failed | cancelled | interrupted`。模型运行状态独立记录 `pending / running / succeeded / failed / cancelled / interrupted`；
5. 每次正常 Turn 的 `model_runs` 以 `operationKind=teaching_turn`、`operationId=turnId` 审计，phase 只能为 `answer` 或 `synthesis`，同一 phase/attempt 唯一；
6. 短事务先写学生消息、pending assistant message 与 pending model run，再调用 Provider；流式期间不持有数据库事务；
7. 完成、失败、取消和 lease 回收都使用条件终态更新，遵守 first-terminal-write-wins；
8. Provider `aborted` 只有在服务端已记录显式取消请求时映射为 `cancelled`。浏览器断连、进程退出或意外上游中断映射为 `interrupted` 或 `failed`；
9. 刷新恢复已持久化的消息与稳定终态。首版不承诺逐 token 断点续传；若流被中断，UI 显示 interrupted 并允许显式重试；
10. 成功 assistant message 必须至少关联一个成功 model run；完整工具路径应关联恰好两个运行，零 Provider 调用的“成功老师回答”是数据不变量违规。

## 原因

- 消息体验与模型审计分层后，可以独立演进 UI、成本统计和供应商路由；
- 唯一幂等键消除 `clientMessageId` 与额外 `idempotencyKey` 的重复语义；
- 条件终态更新能确定处理 Stop、Provider 完成和进程回收竞争；
- 明确“不做 token 续传”避免用没有事件账本的 resume token 伪装可靠恢复。

## 后果

- PR-D1 需要新增 session 生命周期字段、`chat_messages`、`model_runs`、仓储和真实 PostgreSQL 迁移测试；
- PR-A2 的 Route 必须先建立账本，再启动 `TeachingTurnOrchestrator.streamTurn()`，并把每个模型阶段分别审计；
- 正式账号、多租户、删除/保留策略和跨实例限流不属于匿名 shared-dev 纵切，必须进入 production-hardening 计划；
- 后续如需真正 token 续传，需要新增 durable event ledger 或外部 stream broker，并另写 ADR。

## 验证方式

- 并发幂等测试覆盖同 ID 同正文复用、同 ID 不同正文冲突；
- 仓储状态机测试覆盖 cancel/complete 与 lease/complete 竞争；
- 集成测试确认成功消息至少一个 model run，工具路径恰好两个 phase；
- 刷新 E2E 覆盖 completed、failed、cancelled、interrupted；
- 安全测试确认错误身份不能读取、恢复或取消其他学生 session。
