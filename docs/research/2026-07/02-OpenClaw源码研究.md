# OpenClaw 源码研究

- 状态：`research`
- 核验日期：2026-07-21
- 研究对象：OpenClaw 官方仓库与官方文档
- 用途：为 EduCanvas Gateway、跨入口会话、渠道生命周期、工具策略和 compaction 提供对照

## 一、研究结论

OpenClaw 最值得学习的不是“支持很多聊天平台”，而是把长期 Agent 的连接、会话、路由和执行控制集中在一个 Gateway truth 中。客户端、渠道和设备可以不同，但服务端决定它们能以什么身份进入哪个会话、调用哪些能力、如何恢复或终止运行。

这与 EduCanvas 的 Gateway-first 方向一致，但不能整套照搬。OpenClaw 面向单操作者个人助理的信任假设、workspace/host execution 和 session 语义，不适合作为多用户 K12 平台的身份或 Notebook 边界。

## 二、五条纵向切片

### 1. Gateway 是运行控制平面

OpenClaw 把 session、channel、node 与运行方法汇集到 Gateway 协议，客户端先声明角色和能力，再使用服务端方法。EduCanvas 应继续让 Gateway 拥有身份、Notebook 路由、Operation、审批、投递和恢复，而不是让 Web、TUI 或渠道各自创建隐藏 session。

采用：一个服务端 truth 和显式连接角色。适配：EduCanvas 的 principal、Membership 与 delegated grant 必须比 OpenClaw 的单操作者模型更严格。

### 2. 路由在服务端解析

OpenClaw 的 session key 是上下文与路由标识，不应被理解为认证凭据。EduCanvas 更需要坚持：客户端只能提供 Notebook/Conversation hint，Gateway 必须从已认证主体与 Membership 交集解析最终路由。

采用：稳定会话键和服务端 route resolution。拒绝：把可猜测的 session/conversation ID 当授权。

### 3. `send / steer / abort` 是独立控制语义

成熟 Agent 产品需要区分发起新 Turn、对进行中运行补充方向和终止运行。EduCanvas 已有 send/取消与事件恢复基础，但 steer、跨进程 cancel 和 continuation 尚未完整定义。目标不是照抄方法名，而是让 Web、TUI、渠道对同一 Operation 遵守同一控制语义。

### 4. 渠道是有生命周期的 Adapter

连接配置、监听进程、健康状态、重连、停止与撤销是不同状态。删除或撤销连接需要停止相应监听器，degraded health 也应显示给用户。EduCanvas 的 Connections 控制面已存在，但 enabled Adapter supervisor 与 live health 仍是缺口。

采用：provider-neutral 控制面加 provider Adapter 生命周期。拒绝：用“配置已保存”伪装渠道已经可用。

### 5. Compaction 必须保持工具调用完整性

长会话压缩不能破坏 assistant tool call 与对应 tool result 的配对，也不能把未经授权的历史内容提升为 system 指令。EduCanvas 的 Context Engine 应把 compaction 当版本化、可审计的 Segment 变换，并保留来源、工具和运行 ID，而不是生成一段不可追溯摘要。

## 三、采用、适配与拒绝

| 判断 | 内容                                                                                                                                 |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 采用 | 单一 Gateway truth；服务端路由；显式连接角色；send/steer/abort；渠道 lifecycle/health；工具调用配对完整性                            |
| 适配 | session 映射到 EduCanvas Conversation/Operation；工具策略叠加 Actor/Notebook/Profile/入口/环境交集；compaction 固化 Context Snapshot |
| 拒绝 | 单操作者信任；session key 充当授权；workspace 充当 Notebook；默认宿主机执行；为了渠道数量牺牲未成年人隐私                            |

## 四、对第二代架构的直接影响

1. Gateway 保持控制平面，不被 LangGraph 或 Web BFF 替换；
2. 三条 Turn Application 应收敛，让不同入口共享相同 Operation 与工具策略；
3. Tool Kernel 必须位于渠道与工具 Adapter 之上；
4. Context Engine 需要可验证的 compaction 与 tool-pair preservation fixture；
5. Connections 后续优先补 Adapter supervisor、真实 health 与诚实失败，而不是先增加更多 provider 名称。

## 五、主要来源

- [OpenClaw 文档入口](https://github.com/openclaw/openclaw/blob/main/docs/index.md)
- [Gateway 协议](https://github.com/openclaw/openclaw/blob/main/docs/gateway/protocol.md)
- [Gateway 安全模型](https://github.com/openclaw/openclaw/blob/main/docs/gateway/security/index.md)
- [Session 与 compaction](https://github.com/openclaw/openclaw/blob/main/docs/reference/session-management-compaction.md)
- [Channels CLI](https://github.com/openclaw/openclaw/blob/main/docs/cli/channels.md)
- [Gateway 方法清单源码](https://github.com/openclaw/openclaw/blob/main/src/gateway/server-methods-list.ts)

外部项目会持续变化；进入 ADR 前必须固定核验 commit 或 release，并用 EduCanvas 自有 fixture 复现相关语义。
