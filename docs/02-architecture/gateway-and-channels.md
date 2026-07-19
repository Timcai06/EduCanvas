# Gateway 与多入口架构

- 状态：`accepted`
- 负责人：项目负责人
- 最后验证时间：2026-07-19
- 关键决策：[ADR-0016](../09-decisions/0016-gateway-clients-channels-and-nodes.md)、[ADR-0018](../09-decisions/0018-capability-trust-and-learning-evidence.md)

## 定位与实现

EduCanvas Gateway 是长期个人 Agent 的云端控制平面。`packages/gateway-core` 已冻结严格的 `gateway.v1`；`packages/gateway-runtime` 承担路由、幂等、事件恢复和终态纪律；`apps/gateway` 提供真实 HTTP/NDJSON 组合根。Client、Channel 和 Node 都不能绕过 Gateway 直连 Runtime。

## 连接角色

- `client`：Web、TUI 等第一方交互应用；
- `channel`：Telegram 等第三方消息协议适配器；
- `node`：经配对、从本地主动出站连接的能力宿主；
- `operator`：内部运维/管理入口，不等同于普通用户。

每个 `GatewayInboundEnvelope` 包含稳定 `envelopeId`、`idempotencyKey`、时间、连接、服务端建立的 principal、Notebook/Conversation 路由提示、多模态 parts、能力清单和 reply target。客户端请求 Schema 不接受 principal；Gateway/服务端 Adapter 必须从已验证会话或渠道绑定构造主体。

## 事件和恢复

标准事件覆盖：

- Operation accepted/completed/failed/cancelled；
- Message started/delta/citation；
- Tool started/completed/failed；
- Artifact proposed/version/progress/failed；
- Approval required/resolved。

每个事件持久化 `operationId/eventId/sequence/occurredAt`。同一 Operation 只能有一个终态；重复幂等键与相同请求返回 replay，不同请求指纹返回冲突；Client 可使用 `afterSequence` 恢复。Gateway 的 `message.started` 让 Web 兼容层继续复用同一个 Turn/Message ID，而不是创建平行账本。

## HTTP 入口

| 入口                                     | 用途                          | 认证                             |
| ---------------------------------------- | ----------------------------- | -------------------------------- |
| `GET /healthz`                           | 健康与协议版本                | 无敏感信息                       |
| `POST /v1/internal/envelopes`            | 可信 Web/Channel Adapter 入站 | internal bearer                  |
| `GET /v1/internal/operations/:id/events` | 按 actor 恢复内部事件         | internal bearer + actor header   |
| `GET /v1/internal/metrics`               | 低基数进程指标                | internal bearer                  |
| `POST /v1/client/bootstrap`              | 管理员/本地创建第一方 session | bootstrap bearer                 |
| `GET /v1/client/conversations`           | 可访问 Notebook/Conversation  | session bearer                   |
| `POST /v1/client/turns`                  | TUI 等第一方 Client 流式 Turn | session bearer                   |
| `GET /v1/client/operations/:id/events`   | 状态与断线恢复                | session bearer + actor check     |
| `GET /v1/client/approvals` / decision    | 列表、批准或拒绝              | session bearer + actor check     |
| `/v1/node/*`                             | 配对、心跳、轮询和结果        | bootstrap 或 node session bearer |

认证配置缺失时相应 transport 返回明确 503，不降级为匿名开放入口。请求体上限、严格 Zod Schema、稳定安全错误码和 `no-store/nosniff` 响应头在 HTTP 边界统一执行。

## 路由和共享 Notebook

路由取已认证 `userId/agentId` 与显式 Notebook/Conversation Hint 的交集。Repository 再校验 Membership、Conversation 从属和所需权限：owner/editor/contributor 可回复，viewer 与无成员关系主体被拒绝。共享 Notebook 不传播个人 Agent 的私人能力；每次 Operation 都保留真实 Actor 和其个人 Agent。

## 能力与审批

能力按 `l0..l3` 风险分层，并带版本、约束、签发/到期/撤销信息。有效能力必须同时满足主体权限、Notebook Membership、Profile、部署策略以及 Client/Channel/Node 声明。模型输出不能创建 grant 或改变风险等级。

Gateway 已持久化 `approval.required/resolved`，Web/TUI 可列出并批准或拒绝；拒绝会形成 `APPROVAL_DENIED` 终态。当前交付能力只有 L0/L1，因此没有暴露“批准后执行 L2/L3 动作”的产品路径；增加这类动作前必须单独实现可恢复续跑和安全评审，不能把现有审批记录机制描述成已开放高风险执行。

## 当前入口

### Web

`/api/v1/chat/turn` 与 `/api/v1/learn/turn` 在服务端构造 Gateway Envelope，分别通过通用和教育 Profile 进入同一 `AgentLoopEngine`，再把 canonical events 投影回现有 Web SSE。历史切换、Sources/Studio 隔离、引用、Artifact、取消、幂等和刷新恢复已通过原 E2E 回归。

### TUI

`apps/tui` 只依赖 `gateway-client/gateway-core`。本地 loopback 首次进入时由 Gateway 为固定 local registered user 幂等准备 Personal Agent、默认 Notebook/Conversation 和短期 session，不再要求用户输入 ID 或共享 bootstrap token。TUI 提供持续交互 Chat、Notebook 切换、状态、恢复、审批和 Web 入口；非 TTY 自动化仍可使用原子子命令。session 配置写入 `~/.config/educanvas/client.json`，目录/文件权限为 0700/0600。

### Telegram

Telegram 私聊文本是已完成的实验性协议纵切，不是当前产品优先渠道，也不由 `make all` 默认启动。Adapter 只接受已绑定、非 bot、private chat 的文本 Update，以官方 `update_id` 形成幂等键，拒绝群聊、未知账号和媒体；输出按 `sendMessage` 4096 字符上限切分，不使用 `parse_mode`。Delivery 在 PostgreSQL 中去重和记录回执，offset 只在成功处理 Update 后推进。仓库只有官方形状 Fixture，没有 live 发送证据。

### Capability Node

Node 主动配对并轮询 Gateway，只开放 `device.status` 和 `filesystem.read_allowlisted`。文件能力要求预配置 root alias，拒绝绝对路径、`..`、symlink escape、超限文件、过期/重放/撤销请求；代码和依赖边界同时禁止 `child_process`、shell 与写操作。Node 离线不影响云端对话。

## 可观测性和隐私

Gateway 结构化日志只记录固定路由标签、HTTP 状态/时延及 Operation ID/事件类型，不记录原始 URL 参数、请求正文、消息、令牌、私有存储键或异常。内部指标提供请求、错误、活跃请求、Operation Event 和终态计数；生产环境仍需把这些信号接入外部指标/Trace 后端。

## 仍未开放

- 群聊、电话、实时语音和普通语音消息；
- 面向终端用户的正式登录与渠道自助绑定；
- Web Connections 与 TUI `/channels` 统一控制面；
- 微信/QQ 的真实扫码授权 Adapter；
- Inbox 自动路由；
- L2/L3 Node 能力及审批后续执行；
- Telegram live smoke、Webhook 部署和生产告警。
