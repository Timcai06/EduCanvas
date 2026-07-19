# `@educanvas/gateway-core`

EduCanvas Gateway 的纯协议与授权契约。该包定义连接角色、规范化消息信封、路由、Notebook Membership、能力、审批、事件和恢复语义。

边界：

- 可以依赖 `agent-core` 中的通用消息 Part 和 Zod；
- 不依赖 Next.js、Drizzle、教育状态、模型供应商或具体渠道 SDK；
- 身份字段只表示 Gateway 已认证后的可信主体，原始客户端/渠道输入不得自行构造可信 Envelope；
- 共享 Notebook 权限不会传播私人 Memory、Credential、Node 或默认工具授权。
