# ADR-0012：Artifact Runtime 与持久任务基础设施

- 状态：`accepted`
- 日期：2026-07-17
- 决策人：项目负责人
- 关联：[ADR-0009](0009-general-multimodal-platform-and-k12-vertical.md)（平台分层）、[ADR-0010](0010-canvas-trust-tiers.md)（Canvas 分层信任）

## 背景

阶段目标已明确为复刻 Gemini + NotebookLM 的产品体验：Canvas 是持久、可跨轮迭代的共创产物；Studio 输出思维导图、Slides、测验/闪卡、音频概览乃至视频。这些能力有两个共同前提，而当前架构都不具备：

1. **产物不是一等公民**。现有 Artifact 要么是 K12 编译期闭集，要么是消息文本里的一次性 ```html 块——没有独立实体、没有版本、模型无法跨轮修改，SSE 协议也没有产物生命周期事件；
2. **没有持久异步任务**。音频/视频/Slides 生成是分钟级多步骤工作，而全部计算目前活在单次 HTTP 请求的 SSE 生命周期内，浏览器断连即任务丢失，Route Handler 也不能承载分钟级渲染。

原平台计划把 Artifact Runtime 排在 P4（通用 Agent Runtime 之后）；在新阶段目标下它是关键路径的第一站。

## 候选方案

- **A. Temporal / 独立工作流引擎**（ADR-0001 原设想）：能力过剩，引入新的运维面与学习成本，与当前单人团队和模块化单体不匹配；
- **B. Redis 队列（BullMQ 等）**：引入第二个有状态基础设施，违反"PostgreSQL 唯一事实源、Redis 引入前需 ADR"的既有纪律，且任务表与业务数据分家导致审计割裂；
- **C. PostgreSQL 背书的任务队列 + 独立 worker 进程（本决定）**：graphile-worker 或 pg-boss，任务即数据库行，事务与业务数据同库，重启可恢复，与 additive migration 纪律同构。

## 决定

1. **持久任务**：采用 PostgreSQL 背书的任务队列（实现期在 graphile-worker 与 pg-boss 中二选一，以事务性入队和 TypeScript 类型质量为准），运行在独立的 Node worker 进程中。模块化单体从"一个进程"演化为"web + worker 两个进程"，仍是同一 Monorepo、同一数据库、同一部署单元的伸缩，不是微服务拆分；
2. **Artifact 一等公民**：新增 `artifacts`（身份、类型、trust tier、归属 Space/Conversation）、`artifact_versions`（不可变版本、内容或对象存储引用、生成来源）、`artifact_generation_jobs`（任务状态、进度、失败原因、与 model run 关联）三类表，按 additive migration 引入；
3. **生命周期事件进入 SSE 协议**：新增 `artifact.proposed/created/version_added/generation_progress/failed` 事件族，协议版本号递增；浏览器断连后可通过 Conversation 恢复产物状态，不依赖流的连续性；
4. **对象存储 Port**：音频/视频/图像等二进制产物经 `ObjectStoragePort` 写入（本地磁盘实现起步，S3 兼容实现可替换），PostgreSQL 只存引用与校验和，不存媒体二进制；
5. **信任分层贯穿**（继承 ADR-0010）：Tier 1 判分型产物继续走白名单 Schema + 服务端判分；Tier 2 沙箱产物获得持久化与版本后仍不产生可信学习事件；tier 记录在 artifact 行上，消费方必须校验；
6. **非对话模型任务**：`model-gateway` 按 TaskAlias 扩展 `speech.generate` 等非流式对话任务的 Provider Adapter，复用 ADR-0007 的别名治理与 Secret 边界,worker 是这些任务的唯一调用方。

## 原因

- 任务即 Postgres 行：可审计、可回放、事务性入队与业务写入同库原子提交，符合"事件流是可重放账本"的既有原则；
- Canvas 共创（跨轮迭代同一产物）与 Studio 输出（一键生成多形态产物）在数据模型上是同一个东西，一次建设两处受益；
- 运维增量最小：不引入新存储系统，worker 与 web 共享全部 workspace 包和迁移流程。

## 选型结论（2026-07-17，随 PR-J1 回写）

对比后选择 **graphile-worker**：

| 维度 | graphile-worker | pg-boss |
| --- | --- | --- |
| 事务性入队 | `graphile_worker.add_job()` 是普通 SQL 函数，可在任意 Drizzle 事务内与业务写入**原子提交**（决定性理由） | 入队走自身连接池，与业务事务的原子性需要绕行 |
| 任务拾取延迟 | LISTEN/NOTIFY 即时唤醒 + 轮询兜底 | 纯轮询 |
| 定时任务 | 内置 crontab | 内置 cron |
| 生命周期电池 | 归档/保留策略较少，按需自补 | 归档、过期、死信等更齐全 |

取舍：接受 graphile-worker 较少的"生命周期电池"，换取入队原子性与低延迟；归档策略等真实需求出现再补。集成测试以"事务回滚则任务消失、提交则被消费"作为选型承诺的守护用例（`apps/worker/src/worker.integration.test.ts`）。

## 后果

- 部署形态变化：本地 `make dev` 与生产都需要拉起 worker 进程；CI 增加 worker 冒烟；
- `agent-runtime` 新增 Artifact/Job 应用服务；K12 的 Artifact 提议流程（原纵切计划 PR-C1）合并进本基础设施实现，不再单独按 K12 专用路径开发；
- SSE 协议、`docs/05-engineering/api-conventions.md` 与数据设计文档需同步更新；
- 引入的任务队列库成为核心依赖，选型结论在实现 PR 中以对比记录补充到本 ADR。

## 开放问题

- 任务优先级与并发配额策略（先到先得起步，配额等真实拥塞出现再设计）；
- 视频生成的 Provider 选型与成本控制；
- worker 的失败告警通道（当前仅账本可查，无主动通知）。

## 验证方式

- 集成测试：任务入队 → worker 消费 → 产物版本落库 → SSE 事件到达的全链路；进程杀死后重启，任务从上次状态恢复；
- 边界测试：Tier 2 产物持久化后仍无法写入学习事件；对象存储引用与校验和一致；
- E2E：一个"生成思维导图"回路（对话 → 任务 → 产物卡 → Canvas 打开）作为首个验收场景。
