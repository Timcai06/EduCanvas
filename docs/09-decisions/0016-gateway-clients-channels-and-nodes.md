# ADR-0016：Gateway、客户端、渠道与能力节点

- 状态：`accepted`
- 日期：2026-07-19
- 决策人：项目负责人

## 背景

现有系统由 Web BFF 直接组合 Runtime、数据库和 Provider，适合早期纵切，却无法自然承载 TUI、社交消息、语音和远程设备能力。若每个入口复制身份、会话、工具确认和事件恢复逻辑，系统会再次形成多套运行路径。

## 决定

1. 新增逻辑上的 **EduCanvas Gateway**，作为常驻交互控制平面。它与连接模型供应商的 `model-gateway` 是两个不同概念。
2. Web 与 TUI 是第一方客户端；微信、QQ、飞书、Telegram、Discord、短信和语音等通过 Channel Adapter 接入；手机、电脑或其他设备能力通过受配对的 Node 接入。
3. 所有入口只连接 Gateway，不直接调用 Agent Runtime、领域服务或数据库。
4. Gateway 负责身份与配对、消息标准化、Notebook/Conversation 路由、能力协商、幂等、速率限制、审批、事件分发、断线恢复、操作取消和渠道投递。取消是协作式的：客户端请求后，运行中操作在下一个事件边界（或竞速打断正在 await 的 runner）追加 `operation.cancelled`，经既有事件流回到客户端，不另开终态写入路径，也不伪造已取消。
5. Gateway 不负责模型循环、Prompt/Context 构造、Provider 路由、判分、掌握度或 Artifact 生成；这些职责分别属于 Agent Runtime、Model Gateway、可信领域服务和 Worker。
6. Web 是 K12 学生主客户端，提供 Chat、Sources、Studio、Canvas、渠道连接和复杂授权；TUI 是高级第一方客户端，提供聊天、任务、状态、日志、渠道连接与审批；能力较弱的渠道返回文本、媒体、卡片或 Web 深链接，不要求功能表现完全相同。
7. Channel 与 Node 采用声明式能力清单。Gateway 根据客户端/渠道能力决定输入输出形态，不把不支持的多模态静默降级为虚假成功。
8. Gateway 采用**云端控制平面 + 每用户逻辑隔离 + 可选本地设备 Node**的物理拓扑：
   - 云端 Gateway 承接第一方客户端和第三方渠道连接，并持有身份、路由、审批与投递的权威状态；
   - 每个用户拥有独立的 Agent、Notebook、Conversation、Operation 和能力授权命名空间，不共享上下文或工具许可；
   - 本地 Node 只通过出站配对连接声明受限设备能力，不持有平台级 Provider Secret，也不是用户身份、Notebook 或操作终态的事实源；
   - Node 离线时，依赖该 Node 的能力明确不可用，但云端 Agent、历史、Sources 和不依赖设备的任务继续可用；
   - 当前路线不把“每用户自托管一套 Gateway”作为正式部署形态。

## 实施选择与仍开放事项

- Telegram私聊文本作为协议纵切已经完成，以数据库账号/线程Binding映射到User和Conversation；它当前降为实验性、非默认启动，不再决定正式渠道优先级；
- 用户选择和管理通信方式必须通过 Web GUI 或 TUI 控制面完成；来源消息的回复仍由 Gateway 确定性回到来源，主动跨渠道投递是独立显式动作；
- 第一方第二客户端为TUI；首个Node只提供状态与白名单只读文件，不提供Shell/写入；
- 实时电话、语音消息、群聊和面向终端用户的渠道自助绑定仍未决定，不影响本ADR的控制平面边界。

## 后果

- Next.js 不再是长期系统中枢，只是 Web 客户端及迁移期 BFF；
- 现有 SSE 可以作为 Web 传输兼容层，但长期事件协议由 Gateway 对所有客户端统一提供；
- 渠道插件和设备 Node 不能绕过主体权限、Notebook 所有权和工具策略；
- 云端部署必须提供服务端强制的用户级租户隔离、配对撤销和审计，不能只依赖 Prompt 或客户端传入的用户标识；
- 本地 Node 是可撤销的能力扩展，不是绕过云端 Gateway 的第二条控制路径；
- Gateway 不应因命名相似而吸收 `model-gateway` 的 Provider 适配职责。

## 验证方式

- 同一条规范化消息可以从 Web 和 TUI Fixture 进入同一 Conversation；
- Channel Adapter 不导入 Agent Runtime 内部实现；
- Gateway 停止时客户端明确失败，不隐式绕过 Gateway 直连 Runtime；
- 两个用户即使连接同一渠道或同类 Node，也不能读取彼此的 Notebook、Operation、凭据或事件；
- Node 断线、撤销或重放旧请求时，Gateway 能给出明确终态且不执行越权设备动作；
- 能力协商测试覆盖文本、图片、文件、语音和 Web 深链接降级。

## 实施状态（2026-07-19）

`gateway-core`、`gateway-runtime`、`apps/gateway`、TUI、Telegram私聊Adapter和Capability Node已按本ADR落地。Web/TUI同路由、跨租户隐藏、共享Notebook Actor、Delivery去重和Node撤销/重放均有自动化证据。Telegram live账号和L2/L3设备能力仍不属于已完成声明。

**2026-07-20 补充**：操作取消（`POST /v1/client/operations/:id/cancel`）与近期操作列表（`GET /v1/client/operations`）落地。取消经进程内 `GatewayCancellationRegistry` 触发协作式中止，鉴权后由操作自身的 handle 循环追加 `operation.cancelled`；跨用户取消拒绝、已终态幂等回报、慢 Provider 竞速打断均有单测。TUI 侧 Esc 触发服务端取消并渲染回流的取消事件，首页与 `/resume` 列出可回看的历史操作。

**2026-07-21 补充**：进程内Registry降为低延迟Adapter，`agent_operations.cancel_requested_at`成为取消事实源。审批continuation处于等待态时，Gateway在请求事务中同时终结continuation与Operation；Worker持有lease时通过heartbeat或最终结算观察请求，清除lease并写入唯一取消终态。未过期lease必须让Graphile任务重试，不能作为成功no-op删除；过期重领由单调generation隔离旧owner。

**跨客户端交接（2026-07-21）**：TUI `/web` 通过 Client session 向 Gateway 请求两分钟有效的 32-byte opaque token，再以 `/open?token=<token>` 打开 Web。PostgreSQL 只保存 SHA-256 摘要、签发主体、Conversation、到期与消费时间；Web 必须以当前可信主体原子消费，成功后才写 Conversation 游标。重放、过期、跨主体与非法 token 均不写游标并静默回默认笔记本，拒绝原因不返回浏览器。反向（Web→TUI）继续依靠两端统一主体与 Gateway Notebook 目录：启动 TUI 即看到同一批笔记本，不在 K12 主界面暴露终端入口。该实现使用既有 PostgreSQL 事实源，不引入 Redis 或进程内一次性状态。

**Connections 控制面（2026-07-21）**：`gateway-core` 只公开 `telegram/wechat/qq` 产品级 provider、`pending/active/revoked` 状态与 external URL 授权，不公开 Adapter ID 或外部账号 ID。Gateway Client API、Web `/settings` BFF 与 TUI `/channels` 复用同一个 `GatewayConnectionService` 和 PostgreSQL Repository。Telegram 发起后创建十分钟 pending，官方 Bot 私聊只有携正确 `/start educanvas_<connectionId>` 才可原子激活；过期、重放、已被其他主体绑定均拒绝。微信/QQ 在正式资格和凭据缺失时为 disabled。撤销同时终止账号/线程 Binding 并保留 `revokedAt`，列表和撤销查询始终带可信 userId。

**兼容投影边界（2026-07-23 更新）**：浏览器继续通过 Next.js BFF 和既有 SSE 使用统一 Runtime，这是第一方 Web 的有意兼容投影，不要求为了形式统一迁移到 Gateway 持久传输。独立Gateway runner、Web General与Web Teaching均已迁入`TurnApplicationService`并接通通用Context/Model Run审计；三条组合路径都通过共享Resolver解析可信五维Tool Policy，Web Teaching额外保留K12安全、状态与学习证据。独立Gateway仍未复用Web Tool/Asset和K12 Adapter，因此“同一Gateway协议/Notebook路由”不等于能力已经等价。后续收敛的是应用语义和可验证能力，不把替换浏览器传输本身列为架构债务。
