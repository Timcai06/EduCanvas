# ADR-0028：桌宠作为统一 EduCanvas 系统的第一方桌面外延

- 状态：`accepted`
- 日期：2026-08-13
- 负责人：@Timcai06
- 替代：ADR-0024「远端桌宠运行形态与语音交互边界」（已压缩进决策历史）
- 扩展：[ADR-0002](./0002-网关客户端渠道与能力节点.md)、[ADR-0003](./0003-统一运行时与笔记本上下文.md)、[ADR-0008](./0008-Web账号身份与会话边界.md)
- 配合：[ADR-0025](./0025-语音双入口与云端级联边界.md)、[ADR-0026](./0026-多模态输入原件与派生表示边界.md)、[ADR-0027](./0027-Canvas多形态输出与交互运行时边界.md)
- 产品需求：[桌宠第一方桌面外延需求](../01-product/04-桌宠第一方桌面外延需求.md)

## 背景

ADR-0024 将桌宠确定为独立于浏览器的 Electron 第一方远程 Client，并冻结了 2D 角色、
点击语音、原生登录、唯一 Agent Runtime 和 Web/Canvas 交接方向。当前实现已经完成透明桌宠
外壳、文本与整段语音问答、系统浏览器登录、可撤销桌面会话、`gateway.v1` 接入、可折叠
对话框和独立聊天窗口。

继续把桌宠定义为“只显示短气泡的语音附件”已经过窄；把它扩展为独立桌面聊天系统又会
复制 Web 的会话、消息、输入输出、记忆和工具逻辑。新的方向是：桌宠成为统一 EduCanvas
系统在桌面的第一方交互外延。Web 与桌宠使用相同业务事实，只在系统集成、交互密度和
富内容 Renderer 能力上不同。

## 候选方案

### 方案一：独立桌面 Agent

- 客户端可以独立演进；
- 但会复制 Agent Loop、Conversation、Memory、RAG、Tools、Provider 和消息账本；
- 拒绝。

### 方案二：只保留语音短气泡

- 客户端简单；
- 但无法继续 Web Conversation、恢复历史或承接统一多模态输出；
- 拒绝作为长期边界，可作为降级形态保留。

### 方案三：统一系统的能力受限第一方桌面外延

- 共享身份、Agent、Notebook、Conversation、Message、Turn、Operation、Runtime、Memory、
  RAG、Tools、Asset、Artifact 与 CanvasResource；
- 桌宠只实现适合桌面的输入、状态和轻量结果投影，复杂工作面通过授权 handoff 打开 Web；
- 选择。

## 决定

### 1. 系统一致性

桌宠与 Web 必须共享以下服务端事实：

- 同一个自然人用户身份和 Personal Agent；
- 同一个 Notebook 与 Conversation 目录；
- 同一份 Message Ledger、Turn、Operation 与唯一终态；
- 同一个 Agent Runtime、Context、Memory、RAG、Tool Policy 和 Tool 执行结果；
- 同一份 Asset、Citation、Artifact、Artifact Version 与 CanvasResource。

允许 Web BFF、Gateway NDJSON、语音 HTTP 等不同 Transport，但 Transport 不能产生新的业务
权威、专属 Prompt、第二 Agent 回答或客户端专属消息账本。

### 2. 身份与 Conversation 解耦

桌面继续使用系统浏览器、PKCE S256 和 `educanvas://auth/callback` 授权：

- 回跳只携带一次性短期 `code` 与 `state`；
- 长期 Token 只存在 Electron main 和操作系统保护存储；
- renderer/preload 不接收 Token，`401` 后立即清除本地凭据；
- Provider Secret、原始响应和内部错误不进入桌面进程边界；
- 打包版本禁止回退到 `local:owner`。

桌面 Session 只证明用户和客户端身份。授权时返回的 Notebook/Conversation 只作为初始游标，
不能永久限制用户。Notebook 和 Conversation 必须通过统一服务端目录创建、读取、切换和
校验；客户端传入的 ID 不是授权证据。

### 3. 共享 Conversation 与 Message Ledger

桌宠聊天窗是服务端 Conversation 的轻量投影：

- Web 已有 Conversation 可以在桌宠继续；
- 桌宠可以新建、选择 Conversation，并在 Web 打开同一会话；
- User Message 与 Assistant Message 只在服务端写入一次；
- Web 与桌宠读取相同消息 ID、角色、Part、时间、Citation、Artifact 和终态；
- 桌宠启动、切换 Conversation 或刷新时按分页读取服务端完整历史；
- 小窗与大窗可以共享可删除、可重建的 View Cache；
- 动画、录音状态、提示文案和本地 busy 状态不写入正式消息。

桌宠不得自行生成正式消息的长期 ID、长期时间戳或完成状态。

### 4. 统一输入和语音语义

文本和语音最终都进入 canonical Turn，至少包含可信用户身份、Notebook、Conversation、
稳定 `clientMessageId`、版本化 MessagePart、客户端能力和受权资源引用。

- 文本复用统一校验、消息写入、Context、Memory、RAG、Tools、Runtime 和错误语义；
- 桌面只负责显式录音、VAD、取消与上传，ASR Provider 和限制保留在服务端；
- ASR transcript 是同一 Conversation 的 User Message；
- TTS 是同一 Assistant Message 的音频呈现，不是第二次 Agent 回答；
- 重新播报不得重新执行 Turn；
- 后续图片、PDF 或文件输入复用 Asset 上传、版本、派生表示和权限契约，不直传模型供应商。

首版不做持续监听、唤醒词、后台静默录音、声纹识别或实时全双工语音。

### 5. Canonical 输出与能力投影

Agent 输出先形成 Operation Event、Assistant Message、结构化 Parts、Citation、工具状态、
Generated Image、Artifact/Version、CanvasResource 和 handoff target，再由客户端投影。

- 文本与短 Markdown 在桌宠直接显示并可 TTS；
- Citation 显示摘要和可追溯入口；
- 图片和简单 Artifact 显示简化预览或结果卡；
- Slides、思维导图、复杂 Canvas、Artifact 编辑和详细 Source 定位保留 Web Renderer；
- 未支持的 Part 必须保留资源身份并明确提示，不静默丢弃或伪装成纯文本成功。

客户端使用版本化 capability manifest 声明文本、语音、流式输出、取消、Citation、Artifact
卡片、图片预览、文件输入和 handoff 能力。Gateway 不按客户端名称复制业务分支。

### 6. Operation、流式输出与恢复

桌宠消费与 Web 一致的 accepted、增量输出、工具状态、completed、failed、cancelled：

- 服务端唯一终态是权威；
- 用户取消协作式停止录音、播放、网络读取和远端 Operation；
- 断线恢复消费同一个 Operation，而不是生成第二个回答；
- 同一逻辑请求重连或安全重试复用稳定 `clientMessageId`；
- 只有新的用户意图才创建新的 `clientMessageId`；
- 已完成的写工具不得因响应丢失而被重复执行。

桌面本地 operation lease 只负责跨小窗/大窗的交互协调，不是消息或终态权威。

### 7. Web/Canvas handoff

复杂结果在同一 Operation 中生成和持久化。桌宠展示摘要与精确结果卡，由用户点击
“在 EduCanvas 中打开”后进入 Web，不默认突然打开浏览器。

handoff 必须：

- 指向精确 Notebook、Conversation、Message、Artifact Version 或 CanvasResource；
- 使用受控 HTTPS 和一次性服务端凭证，资源 ID 或任意 URL 本身不是授权；
- Web 打开时重新验证身份与资源权限；
- 打开失败可再次打开，但不得重新提交 Prompt 或执行 Tool；
- handoff 失败不改变原 Operation 的终态。

### 8. 本地数据边界

桌宠可以本地持有：加密客户端凭据、窗口位置/尺寸/折叠状态、多屏恢复信息、静音/音量/
动画偏好、瞬时录音播放状态、角色资产、托盘状态和可重建 View Cache。

桌宠不得本地持有：Conversation/Message 事实数据库、Memory、RAG 索引、Tool Registry、
Prompt 主链、Artifact/Citation/学习事实权威副本、Provider Key 或动画业务 Ledger。

### 9. Electron、角色资产与权限

- 保留 Electron + React、透明无框窗口、受控穿透、拖动、置顶、托盘和多屏恢复；
- Windows 是当前首要开发和验收平台，完成主流程后补 macOS 同等业务契约；
- 使用可替换 2D 语义状态资产包，不引入 3D 或骨骼 Runtime；
- 资产可使用 APNG、PNG 序列或 sprite sheet，通过 manifest 映射稳定语义状态；
- 至少表达 idle、listening、transcribing、thinking、speaking、success 和稳定错误状态；
- 非语音持续态在数秒后回到 idle，视觉状态由 canonical Voice/Operation 状态投影；
- reduced motion 下停止非必要移动；素材需具备展示、录屏和分发许可；
- 录音必须由用户显式触发，只允许受信 renderer 主 frame 申请音频权限；
- 不默认获取屏幕、摄像头、Shell、任意文件或系统控制权限。

## 迁移约束

1. 本 ADR 已替代 ADR-0024；旧决策只保留在关键决策历史中，不再作为当前约束引用。
2. 当前 `chat-history-store` 降为 View Cache，正式历史改读 canonical Message。
3. Token grant 中的 Notebook/Conversation 改为初始游标，不再是永久授权绑定。
4. Desktop Assistant Adapter 从最终字符串演进为事件和结构化消息投影。
5. 打包与远端模式必须使用可撤销桌面身份；localhost 只限开发。
6. handoff 是统一输出闭环的必需能力，不能以“只显示文字”代替。
7. 不推倒重写现有 MVP，按身份与上下文分离、服务端历史、结构化输出、精确 handoff 纵切收敛。

## 非目标

- 不在 Electron 复制完整 Sources、Studio、Canvas、课程或 Artifact 编辑工作面；
- 不建设第二 Runtime、离线 Agent、桌宠专属 RAG、Prompt 或工具市场；
- 不建立本地长期 Conversation/Message 数据库；
- 不要求 Web 与桌宠使用相同网络拓扑或 UI；
- 不要求首版原生渲染全部 Slides、Canvas、Web App 和复杂 Artifact；
- 不实现持续监听、唤醒词、声纹识别、后台静默录音或默认屏幕理解；
- 不在本提案建设完整儿童账户、监护人后台或商业上线合规体系。

## 验证方式

1. 同一用户在 Web 与打包桌宠解析为同一 Agent，并读取相同 Notebook/Conversation。
2. 任一端发送后，另一端读取同一消息、引用和 Artifact，数据库无重复消息。
3. 删除 View Cache 或重启不丢历史；可切换、新建 Conversation。
4. 跨用户、无 Membership、已撤销资源始终拒绝。
5. 语音 transcript 进入同一 Turn；TTS 重试不重新执行 Agent。
6. 桌宠请求复杂产物只生成一个 Operation/Artifact Version，handoff 打开精确资源。
7. Citation、图片、Artifact 或未知 Part 均能预览、提示或 handoff，不丢资源身份。
8. 取消、超时、断线、重连遵守唯一终态与稳定 `clientMessageId`。
9. Token 和 Provider Secret 不进入 renderer、日志、URL 或浏览器响应。
10. Windows 打包应用先完成完整主流程验收；macOS 随后完成相同业务流程与平台证据。

## 接受记录

- 2026-08-13，项目负责人确认采用 PRD 中的全部 A 方案，并明确接受 ADR-0028；
- DP00 已完成现有实现、ADR-0024 约束、自动化保护和迁移任务审计；
- ADR-0024 的有效安全与架构约束已并入本文，产品差异记录于 DP00 质量基线；
- 后续实现按 `DP01-DP13` 渐进收敛，不推倒重写当前桌宠 MVP。
