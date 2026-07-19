# 部署与可观测性

- 状态：`draft`
- 负责人：待认领
- 最后验证时间：2026-07-19

## 当前部署事实

- 本地 `make all` 运行 PostgreSQL、迁移、`apps/web`、`apps/gateway`、`apps/worker`和显式启用的非交互 Channel Adapter；`make dev`进入 Web 验证，`make tui`进入交互式 TUI；实验性 Telegram、交互 Client 和外部 Node 不属于默认 all profile；
- Web、Gateway与Worker共享Monorepo包和数据库，但分别是独立进程组合根；
- Artifact 二进制通过对象存储 Port 保存；
- `apps/gateway`已实现HTTP/NDJSON、Client/Node session、路由、恢复、审批和内部指标；尚未部署到共享云环境；
- Redis、Temporal、Kafka、Kubernetes 和 OpenTelemetry 尚未接入。

## 环境

- `local`：个人开发；
- `shared-dev`：未来共享开发；
- `staging`：未来生产前验收；
- `production`：未来正式环境。

环境之间必须隔离数据库、对象存储和密钥。未实际存在的环境不能在文档中写成已部署。

## 部署原则

- 镜像或发布产物不可变并带 Git 提交标识；
- 数据库迁移先兼容、后切换、再清理；
- 长任务不依赖 Web、TUI 或渠道连接生命周期；
- 目标 `apps/gateway` 是云端组合根，但 Gateway、Runtime 和数据层是否作为独立发布单元由连接规模、隔离和发布证据决定；
- 每用户逻辑隔离由认证、查询条件、约束和自动化测试共同强制，不能只靠进程内对象或 Prompt；
- 本地 Node 主动向云端建立连接；不要求家庭网络开放入站端口，也不把 Node 当作云端 Gateway 的可互换部署模式；
- 发布需要可回滚，Provider 故障必须诚实失败或使用经批准的显式 fallback。

## Gateway 当前观测与后续目标

已实现：

- 固定低基数路由标签的HTTP请求/错误/活跃请求计数；
- Operation Event与终态计数；
- 受internal bearer保护的`GET /v1/internal/metrics`；
- 仅包含路由标签、状态、时延、Operation ID和事件类型的JSON结构化日志；
- 所有日志禁止正文、动态URL ID、token、Provider Secret、私有storage key和原始异常。

待接入外部后端：

- 连接数、配对/认证失败、Channel/Node 健康；
- 入站 Envelope、路由失败、Notebook 绑定和投递回执；
- 审批等待、拒绝、超时和撤销；
- 每渠道的延迟、错误率、媒体能力和消息丢失/重复；
- Web/TUI/Channel 的断线恢复与终态一致性；
- p50/p95/p99、SLO、告警、分布式Trace和日志保留策略。

## Runtime 与 Worker 指标

- Turn 数、错误率、首 Token 和完整终态延迟；
- 模型运行、Token、成本、工具圈和预算截停；
- Tool 成功/失败/超时/结果未知；
- Context Segment 数量、预算和来源；
- PostgreSQL 连接、慢查询和锁竞争；
- graphile-worker 队列积压、重试和任务年龄；
- Artifact 生成、对象校验和媒体读取；
- 学习事件处理、判分和投影延迟。

## Trace

一次用户操作以Gateway `operationId`为主关联键：Client/Channel、Gateway事件、Agent Runtime `traceId/turnId`、Model Run、Tool Call和数据库共享该ID或显式关联；Artifact长任务另有job ID并从Operation/Artifact引用恢复。当前单进程日志与账本已可串联，跨进程OpenTelemetry传播仍是production门禁。

## 故障降级

- Gateway 不可用：客户端明确失败，不直连 Runtime；
- Channel 不可用：保留终态和待投递记录，不能伪装已送达；
- 高级模型不可用：只有配置了正式 fallback 才切换，否则诚实失败；
- 检索增强不可用：明确说明无法使用来源，不生成伪引用；
- 图片/语音不可用：回退到受支持的文本表达并标明能力限制；
- Worker 不可用：任务保持可恢复状态，不在 Web 请求中临时执行长任务；
- 结构化课程推荐不可用：保留可信学习记录，不由模型猜测掌握度。
