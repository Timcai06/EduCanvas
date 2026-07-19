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
4. Gateway 负责身份与配对、消息标准化、Notebook/Conversation 路由、能力协商、幂等、速率限制、审批、事件分发、断线恢复和渠道投递。
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
