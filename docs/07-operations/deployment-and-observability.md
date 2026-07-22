# 部署与可观测性

- 状态：`draft`
- 负责人：待认领
- 最后验证时间：2026-07-22

## 当前部署事实

- 本地 `make all` 运行 PostgreSQL、迁移、`apps/web`、`apps/gateway`、`apps/worker`和显式启用的非交互 Channel Adapter；`make dev`进入 Web 验证，`make tui`进入交互式 TUI；实验性 Telegram、交互 Client 和外部 Node 不属于默认 all profile；
- Web、Gateway与Worker共享Monorepo包和数据库，但分别是独立进程组合根；
- Artifact 二进制通过对象存储 Port 保存；
- `apps/gateway`已实现HTTP/NDJSON、Client/Node session、路由、恢复、审批和内部指标；尚未部署到共享云环境；
- Redis、Temporal、Kafka和Kubernetes尚未接入。OpenTelemetry已完成默认关闭的Turn Trace、OTLP Exporter与Turn→PostgreSQL continuation→Worker的W3C carrier纵切；正式Collector/SLO和其余生产Span仍未完成。

## 环境

- `local`：个人开发；
- `shared-dev`：未来共享开发；
- `staging`：未来生产前验收；
- `production`：未来正式环境。

环境之间必须隔离数据库、对象存储和密钥。未实际存在的环境不能在文档中写成已部署。

### 实验性 Telegram 纵切

Telegram 不属于默认 `make all` profile。只有同时配置 `TELEGRAM_BOT_TOKEN` 与公开的 `TELEGRAM_BOT_USERNAME` 后，才单独运行 `pnpm --filter @educanvas/telegram dev`；Gateway/Web 只读取 username 来生成官方 deep link，Bot Token 只进入 Adapter 进程。用户从 Web `/settings` 或 TUI `/channels connect telegram` 发起，十分钟内在 Bot 私聊确认。仓库没有 live 账号证据，因此这仍是实验性能力，不可写成生产可用。

### MCP v1 外部工具

`EDUCANVAS_MCP_TOOLS_JSON`是最多32项的服务端可信注册数组；默认`[]`即关闭。每项必须显式给出`serverId`、`endpoint`、`remoteToolName`、`modelToolName`、`description`、`capability`、`risk`、`effect`、`authentication`、`inputSchema`和`timeoutMs`。生产端点强制HTTPS，本地HTTP只允许loopback。配置不应包含Token、Cookie或URL userinfo。

L2/L3只允许write，capability必须为`external.mcp.invoke`，并额外要求`EDUCANVAS_MCP_INTENT_ENCRYPTION_KEY`：32字节随机值的base64编码。可用`openssl rand -base64 32`生成，但只能写入部署Secret，禁止提交仓库。Gateway、Web和Worker必须使用同一密钥；缺失或非法时仅高风险工具以`disabled/durability`关闭。当前生产组合尚无Bearer Credential Broker，因此Bearer工具仍全部关闭；不要把Token改放进工具JSON或加密意图。

Gateway与Web General在进程启动时读取同一配置。无鉴权L0/L1工具直接进入统一Tool Kernel；L2/L3只准备审批并由Worker continuation恢复，前台调用被拒绝。状态使用`disabled/idle/ready/degraded`和`configuration/credential/durability/transport/protocol`稳定码，不记录端点、参数、Credential或远端错误正文。MCP配置错误只禁用MCP，不拖垮普通聊天；协议或输出异常只让该次工具诚实失败。

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
- 未决`outcome_unknown`数量与最老年龄、按低基数结论/原因code聚合的reconciliation决议数、自动核验失败数；
- MCP server disabled/idle/ready/degraded、稳定失败码与Schema漂移（外部指标导出待OTel纵切）；
- Context Segment 数量、预算和来源；
- PostgreSQL 连接、慢查询和锁竞争；
- graphile-worker 队列积压、重试和任务年龄；
- Artifact 生成、对象校验和媒体读取；
- 学习事件处理、判分和投影延迟。

## Trace

一次用户操作以Gateway `operationId`为主关联键：Client/Channel、Gateway事件、Agent Runtime `traceId/turnId`、Model Run、Tool Call和数据库共享该ID或显式关联；Artifact长任务另有job ID并从Operation/Artifact引用恢复。Turn span只记录`operation_id/stage/entrypoint`和静态事件白名单，采样默认0.1、Batch队列512、批次64、导出超时默认3秒。当Turn因审批挂起时，只将严格W3C v00 `traceparent`作为可空元数据写入审批意图与PostgreSQL continuation；Graphile payload仍只含`continuationId`。Worker领取后用该carrier建立`educanvas.continuation`子Span，只记录`operation_id/stage`。Actor、Notebook、continuation ID、carrier本身、正文、Prompt、工具参数、判分键、Token、Secret、Credential和对象key均不进入遥测。

遥测配置：

- `EDUCANVAS_OTEL_ENABLED=false`默认关闭；
- `EDUCANVAS_OTEL_EXPORTER_OTLP_ENDPOINT`必须显式配置，production/staging只允许HTTPS，本地HTTP只允许loopback；
- `EDUCANVAS_OTEL_EXPORTER_HEADERS_JSON`最多16个受控Header，拒绝CR/LF、Host和Content-Length；
- `EDUCANVAS_OTEL_SAMPLE_RATIO`范围0–1，默认0.1；
- `EDUCANVAS_OTEL_EXPORT_TIMEOUT_MS`范围100–30000，默认3000；
- 配置或初始化失败返回安全`degraded` NOOP；运行期导出失败更新`export_failed`，业务继续运行。

## Tool Effect 对账

Effect reconciliation是追加审计，不是修改历史终态：原`outcome_unknown` Effect、Tool Call与Operation保持不变，受控读取投影再联合最新决议。自动核验只能查询Adapter提供的可信外部状态，且只能使用Effect intention中由服务端冻结的verifier；调用方选择、缺少绑定或绑定漂移都必须fail closed，禁止invoke或重放write。MCP v1当前没有可信查询契约，必须继续显示未决。人工处置只允许已鉴权operator或service principal，学生与模型不能自证。数据库、日志与指标只使用稳定身份、低基数code、证据/回执hash和时间，不记录参数、输出、证据正文、远端错误、Credential或Secret。

当前只具备core/runtime/db决议边界，不应部署成无人值守对账任务。生产触发、各Adapter只查询verifier、未决积压告警，以及Graphile Worker异常退出长锁的指标、告警与受控解锁Runbook必须在后续独立PR完成；在此之前不得把“没有核验器”降级为默认成功或默认未提交。

## 故障降级

- Gateway 不可用：客户端明确失败，不直连 Runtime；
- Channel 不可用：保留终态和待投递记录，不能伪装已送达；
- 高级模型不可用：只有配置了正式 fallback 才切换，否则诚实失败；
- 检索增强不可用：明确说明无法使用来源，不生成伪引用；
- MCP不可用或Schema漂移：该工具fail closed并进入degraded，普通聊天与其他工具继续；
- 图片/语音不可用：回退到受支持的文本表达并标明能力限制；
- Worker 不可用：任务保持可恢复状态，不在 Web 请求中临时执行长任务；
- 结构化课程推荐不可用：保留可信学习记录，不由模型猜测掌握度。
