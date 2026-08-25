# 桌宠统一桌面外延

- 任务分配名：`DP 桌宠统一桌面外延`
- 状态：`active`
- 负责人：@Timcai06
- 实现执行：项目负责人 + 协作 Agent，每次只领取一个原子任务
- 代码审核与最终验收：Codex；平台实机证据需人工确认
- 最后验证时间：2026-08-25
- 当前领取任务：`无（DP08-DP10 已完成；DP11 等待领取）`
- 产品需求：[桌宠第一方桌面外延项目需求](../../01-product/04-桌宠第一方桌面外延需求.md)
- 关键决策：[ADR-0028](../../09-decisions/0028-桌宠作为统一EduCanvas系统的第一方桌面外延.md)

## 一、目标

在不重写现有桌宠 MVP、不复制 Web 后端的前提下，把 `apps/desktop` 从“固定会话、内存历史、
最终字符串回复”的客户端，收敛为统一 EduCanvas 系统的能力受限第一方桌面外延：

- 身份与 Conversation 解耦，可读取、新建和切换统一服务端会话；
- 聊天窗读取 canonical Message，应用重启或删除缓存后不丢历史；
- 文本与语音复用同一 Turn/Operation，支持真实增量、取消和断线恢复；
- Citation、Artifact 和未知 Part 有可追溯的简化投影；
- 复杂结果由用户点击后 handoff 到 Web 精确资源，不重复执行 Tool；
- 先完成 Windows 打包主流程验收，再补 macOS 同等业务证据。

## 二、已完成基线

以下能力已存在，不作为本线重新实现目标：

- Electron main/preload/renderer 信任分层、透明无框窗口、拖动、托盘、位置与多屏恢复；
- 桌宠语义表情素材、折叠对话框、独立可缩放聊天窗口；
- 文本 Turn、整段 ASR、TTS、显式录音、VAD、停止和失败降级；
- 系统浏览器 PKCE 登录、deep link、可撤销桌面 bearer 与保护存储；
- 直连 `gateway.v1` 并复用唯一 Agent Runtime；
- 跨窗口本地 operation lease、IPC sender 边界和有界语音响应读取；
- Windows portable 的初始构建配置。

基线代码必须先由测试保护；后续任务不得以“统一”为由回退拖动、透明穿透、折叠、语音或
登录体验。

## 三、范围

- 桌面身份 Session、Gateway Client directory/history/operation/handoff 契约；
- Conversation 选择、新建和当前游标；
- canonical Message 分页、View Cache 和跨窗口同步；
- 流式事件、稳定 `clientMessageId`、取消、重连和 resume cursor；
- capability manifest、Citation、Artifact、工具状态和 handoff 投影；
- 语音与 canonical Message 对齐；
- 后续图片/PDF Asset 输入；
- Windows 与 macOS 打包、权限、窗口和主流程证据；
- 产品、架构、质量、ADR 与计划状态回写。

## 四、非目标

- 在 Electron 复制 Sources、Studio、Canvas、Slides 或 Artifact 编辑器；
- 第二 Agent Runtime、本地 Agent、桌宠专属 Prompt、RAG、Memory 或 Tool Registry；
- 本地长期 Conversation/Message 数据库；
- 持续监听、唤醒词、声纹识别、后台静默录音和实时全双工；
- 默认屏幕、摄像头、Shell、任意文件系统或设备控制；
- 用自动化测试代替 Windows/macOS 人工实机验收；
- 不把已压缩进历史的 ADR-0024 重新解释为当前架构约束。

## 五、共同实施边界

1. 每次只领取一个 `DPxx`；先阅读本计划、PRD、相关 ADR、`AGENTS.md` 和目标代码。
2. 对外输入使用运行时 Schema；ID 是选择器，不是授权证据，服务端每次重验身份与 Membership。
3. renderer 不接触 bearer、Provider Secret、原始 Provider Body、Prompt 或内部错误。
4. Message、Operation、Artifact 和终态以服务端为权威；本地只能做可重建 View Cache。
5. 新增或改变 Gateway 契约时同步更新 core、client、server、desktop 和 cross-entry conformance。
6. 新增功能或修复先写失败测试；完成前运行窄测试、类型检查、格式检查和 diff 检查。
7. 不修改或覆盖工作区中与当前任务无关的用户改动。
8. 未经项目负责人明确要求，不提交、推送、创建 PR 或合并。

## 六、执行顺序

```text
DP00
  ↓
DP01 → DP02 → DP03
                 ├→ DP04 → DP05
                 └→ DP06 → DP07 → DP08
DP03 + DP05 + DP08 → DP09
DP09 → DP10
DP00-DP10 → DP11 → DP12 → DP13
```

- 第一纵切：`DP01-DP03`，身份、目录与服务端历史；
- 第二纵切：`DP04-DP05`，幂等、真实流式与恢复；
- 第三纵切：`DP06-DP08`，结构化结果与 handoff；
- 第四纵切：`DP09-DP10`，语音对齐与多模态输入；
- 发布纵切：`DP11-DP13`，Windows 先验收、macOS 后补、文档收口。

## 七、原子任务

### DP00：冻结需求、决策与事实基线

- 依赖：无
- 状态：`PASS`
- 文件边界：PRD、ADR-0028、本计划、桌宠事实审计与基线测试
- 证据：[DP00 桌宠事实与回归基线](../../06-quality/evidence/15-DP00桌宠事实与回归基线.md)

交付：

- 评审 PRD 的产品范围、用户流程、状态和成功指标；
- 确认 ADR-0028 是否从 `proposed` 进入 `accepted`；
- 若接受，先把 ADR-0024 仍有效约束并入 0028，再压缩历史、删除旧文件并更新引用；
- 为当前 MVP 建立 capability/status 基线和回归测试清单；
- 记录工作区既有改动，避免后续任务覆盖用户文件。

完成标准：方向、当前事实和计划能力不再相互矛盾；ADR 替代动作有明确评审结论。

### DP01：桌面身份与路由游标解耦

- 依赖：DP00
- 状态：`PASS`
- 文件边界：desktop auth/session、native auth contract、Web token exchange、Gateway auth

交付：

- Token 只绑定用户和第一方客户端；Notebook/Conversation 改为可选初始游标；
- 兼容迁移现有保护存储中的旧固定会话格式，非法或过期数据安全清理；
- Turn、历史和 handoff 每次服务端重验目标资源权限；
- 保持登录撤销、`401` 清理、并发登录/退出 generation 和超时边界。

完成标准：不重新登录即可改变当前 Conversation；旧 Session 不导致越权或永久卡死。

### DP02：Notebook/Conversation 目录、切换与新建

- 依赖：DP01
- 状态：`PASS`
- 文件边界：gateway-core/client/http、directory repository、desktop main/preload/renderer

拆分执行：`DP02-A 后端目录/新建（PASS）` → `DP02-B main 当前游标（PASS）` → `DP02-C 切换（PASS）` → `DP02-D UI（PASS）` → `DP02-E 回归验收（PASS）`。

DP02-A 证据：Core 3、Client 11、Gateway HTTP 7 个用例通过；Core/Client/DB/Gateway/TUI 类型检查通过。PostgreSQL 仓库集成测试已编写，但因当前未配置隔离 `TEST_DATABASE_URL` 未执行，禁止使用开发库清表代替。

DP02-B 至 DP02-E 证据：Desktop 主进程统一保存当前游标并向桌宠小窗和独立聊天窗广播同一版本化快照；切换或新建后清空旧本地历史，旧游标上的晚到回复不会写入新会话。小窗显示当前 Notebook/Conversation，大窗支持目录刷新、切换和在有编辑权限的 Notebook 中新建。Desktop 37 个测试文件、175 个用例、类型检查与生产构建通过；Gateway Core 28 个用例、Client 16 个用例、相关 HTTP 11 个用例与 Gateway 类型检查通过。

交付：

- 版本化目录响应包含 Notebook、Conversation、标题、Profile、Membership 与分页/排序语义；
- 补服务端新建 Conversation 契约，名称、Notebook 从属和权限在服务端确定；
- 独立聊天窗口提供当前会话选择和新建入口，小窗显示当前会话；
- 当前游标由 main 协调，小窗/大窗同步；切换时取消或隔离旧会话未完成的本地 UI 更新。

完成标准：可继续 Web 会话、创建新会话、切换后不串历史；越权与删除会话稳定拒绝。

### DP03：Canonical Message 历史与 View Cache

- 依赖：DP02
- 状态：`PASS`
- 文件边界：platform message repository、Gateway history contract/client、desktop cache/UI

拆分执行：`DP03-A 后端分页历史（PASS）` → `DP03-B View Cache 分区/去重（PASS）` → `DP03-C 首屏最近页与切换重建（PASS）` → `DP03-D 向上加载更早页（PASS）` → `DP03-E 回归验收（PASS，实机人工待确认）`。

DP03-A 证据：Gateway Core 新增 `conversation-messages` 契约（`gmh1` 游标、entry schema），DB `DrizzlePlatformTurnRepository.listMessagePage` 按 `(createdAt, id)` 键集游标翻页并内联加载 web 引用，Gateway HTTP 暴露 `/v1/client/conversations/:id/messages`，Gateway Client 新增 `listMessagePage`/`listMessages`。Core/Client/DB/Gateway 类型检查与单测通过。

交付：

- 新增按用户和 Conversation 授权的 cursor 分页历史读取；
- 返回 canonical messageId、role、时间、status、parts、citations 和资源引用；
- 将 `chat-history-store` 改为按 Conversation 分区、可删除可重建的 View Cache；
- 首屏最近页、向上加载更早页、刷新校正、稳定滚动锚点和跨窗口 revision；
- optimistic User Message 通过 `clientMessageId` 与服务端事实对齐并去重。

完成标准：重启或删除缓存后完整恢复；Web/桌宠消息 ID 一致；状态文案不进入历史。桌面单测覆盖分区/去重/加载更早页；「重启恢复、长历史翻页」仍待实机人工确认。

### DP04：稳定请求身份、Operation 所有权与断线恢复

- 依赖：DP03
- 状态：`PASS`
- 文件边界：desktop request/lease/IPC、Gateway operation client、resume contract

拆分执行：`DP04 单次合并（PASS，实机人工待确认）`。

证据：Desktop 新增 `operation-registry.ts`（内存态 Operation 注册表：按 `clientMessageId` 记录 `operationId / lastSequence / conversationId / owner / status`）与 `operation-ipc.ts`（`operation:resume` + `operation:get-pending`）。`assistant-proxy` 新增 `TurnTracker`（流式上报 operationId/sequence）、`resume()`（从 `afterSequence` 回放事件快照并收口终态）、`cancel()`；网络中途断开时 `turn` 返回 `interrupted` 而非假 `http`，`TurnResult` 增加 `interrupted` 码。renderer 在 `interrupted` 时显示「续传」入口；`before-quit` 对在途 Operation 做 best-effort 远端取消。Desktop 38 个测试文件、187 个用例、类型检查、生产构建与 file:check 全绿。

简化取舍（应负责人要求写简单）：不做 owner 跨窗口转移、不做 `powerMonitor` 休眠自动续传、注册表不绑定 lease token；续传由任意桌宠窗口触发，依赖服务端 operationId 幂等保证不产生重复 Turn。断网/休眠/关窗实机人工证据仍待确认。

交付：

- renderer 为新意图创建稳定 `clientMessageId`，`assistant:turn` 校验 lease 后把请求身份写入注册表；
- main 保存 operationId、最后 sequence、Conversation 和 owner window；
- 断线后调用 resume endpoint 继续同一 Operation，不产生第二个逻辑 Turn；
- 用户取消覆盖本地读取和远端取消，处理 accepted 前取消、超时和迟到终态竞态；
- `before-quit` 远端取消在途 Operation；renderer 隐藏/销毁沿用现有取消策略。

完成标准：网络中断和安全重试不产生重复消息或工具副作用（自动证据通过，实机待确认）；跨窗口续传依赖服务端 operationId 幂等，不再要求 owner 独占（见简化取舍）。

### DP05：真实流式消息与统一运行状态

- 依赖：DP04
- 状态：`PASS`
- 文件边界：assistant proxy/preload event bridge、renderer message projection

交付：

- main 将 accepted、message.started、delta、工具状态和终态以受限事件投影推送 renderer；
- 当前 Assistant Message 原位追加真实 delta，不使用假 typing 或完整文本切片；
- Stop 只在服务端接受后可用；失败、取消、中断与恢复状态明确；
- 小窗/大窗观察相同流，旧 operation 事件不能覆盖新会话或新 operation；
- 完成后用 canonical Message 校正本地内容和终态。

完成标准：首个 delta 即可见；切窗和折叠不丢流；读屏不逐 token 播报。

证据：PR #381 已实现 accepted、真实 delta、结构化事件广播、跨窗口同步和 canonical 终态校正；DP07 分支基于最新 `main` 重放该提交后，Desktop 42 个测试文件、214 个用例、类型检查与生产构建通过。

### DP06：Desktop capability manifest 与结构化事件投影

- 依赖：DP03
- 状态：`PASS`
- 文件边界：gateway-core/client/http、desktop shared/proxy

交付：

- Client Turn 显式携带版本化桌面 capability manifest，不再由网关硬编码为 TUI；
- 冻结桌面首版可输入、可渲染、可取消和可 handoff 能力；
- 代理保留 message/citation/tool/artifact/requiredAction 等结构化事件和稳定错误；
- 未知 capability、Part 或协议版本明确失败或进入可验证 handoff 降级。

完成标准：Gateway 按能力投影而非客户端名称分支；结构化资源身份不在代理层丢失。

证据：PR #381 已实现版本化 Desktop capability manifest、未知版本 fail closed 和结构化事件白名单投影；该 PR 的 GitHub CI 通过，DP07 分支回归未改变 Gateway 契约。

### DP07：Citation、图片、工具进度与 Artifact 结果卡

- 依赖：DP06
- 状态：`PASS`
- 文件边界：desktop message types、renderer components/styles、resource access client

交付：

- Citation 编号、来源标题和查看入口；
- 图片有界缩略图和打开入口；
- Artifact 类型、标题、生成状态、版本和 Web 打开动作；
- 工具进度使用稳定摘要，不显示内部调用参数；
- 未知 Part 显示诚实降级卡并保留 handoff target；
- 卡片支持键盘、主题、缩放和历史恢复。

完成标准：资源可追溯、不静默丢失、不伪装完成；复杂编辑能力不进入桌宠。

证据：Desktop canonical 历史现在保留 Citation 与受限 Message Part；renderer 显示引用编号/页码、受界图片结果、Artifact 类型/标题/状态/版本、稳定工具摘要和未知 Part 的 Web 降级卡。所有打开动作均由用户点击触发，经受限 IPC 使用现有一次性 Conversation handoff；资源精确定位仍由 DP08 承担。Desktop 42 个测试文件、214 个用例、类型检查、生产构建与差异检查通过。

### DP08：用户点击式精确 Web handoff

- 依赖：DP07
- 状态：`PASS`
- 文件边界：Gateway handoff contract/repository、Web open route、desktop main/renderer

证据：PR #389 已完成 Message、Artifact Version 与 CanvasResource 的精确目标契约、
服务端签发并原子消费短期一次性凭证、消费时用户与资源归属重验、Desktop 受限 IPC 与
系统浏览器打开，以及 Web `focus` 精确落点。非法目标、越权资源、过期、重放和跨用户消费
均有 core/client/server/repository/desktop/web 负向测试；打开动作只由用户点击触发，不会
重新执行 Turn 或 Tool。Windows 系统浏览器实机流程并入 DP11 验收。

交付：

- handoff target 可精确指向 Conversation、Message、Artifact Version 或 CanvasResource；
- 服务端签发短期一次性 token，并在消费时重验用户和资源；
- renderer 只发受限资源动作，main 生成受控 HTTPS URL 并调用系统浏览器；
- 默认不自动打开；失败显示再次打开；重复打开不重新执行 Turn/Tool；
- 任意 URL、资源 ID、已过期/已消费 token 和跨用户访问有负向测试。

完成标准：思维导图/Slides/Canvas 请求只生成一份结果，用户点击后打开 Web 精确资源。

### DP09：语音链路与 Canonical Message 对齐

- 依赖：DP03、DP05、DP08
- 状态：`PASS`
- 文件边界：desktop voice session/proxy、Web voice BFF、Turn request/message projection

证据：PR #389 已将 ASR transcript 通过稳定 `clientMessageId` 提交到同一 Turn/Operation，
并以服务端 canonical Message 校正历史；TTS 请求绑定 `assistantMessageId`，重播只调用语音
合成和播放，不会重新执行 Agent。录音、ASR、Turn、TTS 与播放共享取消边界，持续视觉态与
失败降级已有 Desktop 自动化覆盖。PR #455 进一步保留原模型音色并增加同音色预取、在途
请求合并与重播缓存；真人中文麦克风和真实服务延迟并入 DP11 实机验收。

交付：

- ASR transcript 作为同一 Turn 的 canonical User Message，不先写本地正式消息；
- voice Turn 使用稳定 `clientMessageId`、同一 Operation 流和结构化结果；
- TTS 绑定 Assistant messageId，重播只重做音频合成/播放，不重做 Agent；
- 语音取消覆盖录音、ASR、Turn、TTS和播放，各阶段不会互相覆盖终态；
- listening/speaking 为持续视觉态，其余结果/错误按 PRD 限时回 idle。

完成标准：一次语音意图只产生一对 canonical 消息；TTS 失败不损坏文字与结果卡。

### DP10：图片与 PDF 的统一 Asset 输入

- 依赖：DP09
- 状态：`PASS`
- 文件边界：desktop file picker/upload、Asset API、Turn MessagePart、能力探测

证据：PR #393 已完成用户显式选择 PNG/JPEG/WebP/PDF、25MB 上限与 magic-byte 类型校验、
Gateway 统一 Asset 上传、ready-wait、不可变 `assetId + versionId` 引用、Notebook 权限重验
和 `asset_ref` 物化；不支持能力会稳定返回 `CAPABILITY_UNAVAILABLE`，文件不会从 renderer
直传 Provider。大小、类型、取消、处理失败、超时、越权、Notebook 切换隔离与纯附件 Turn
均有跨 core/client/db/gateway/desktop 自动化覆盖。PR #455 修复可选附件 IPC 校验并重做上传
反馈与附件预览；真实图片/PDF主流程并入 DP11 实机验收。

交付：

- 用户明确选择图片/PDF，按服务端限制上传和创建不可变 Asset Version；
- 等待安全校验/派生表示 ready 后，Turn 引用受权 `assetId + versionId`；
- 文件不直接发送 Provider；大小、类型、取消、失败和权限边界有测试；
- Provider 或当前 Profile 不支持时明确说明，不假装已理解附件。

完成标准：Web 能看到同一 Asset 和消息 Part；切换 Notebook 后资源不串用。

### DP11：Windows 打包、性能基线与实机验收

- 依赖：DP00-DP10
- 状态：`PENDING`
- 文件边界：desktop build config、Windows launcher、质量证据和发布说明

交付：

- Windows 11 x64 安装/portable 产物、协议注册、单实例 deep link 和升级/卸载边界；
- 登录、会话切换、历史、文本、中文语音、真实流式、取消、结果卡和 handoff 实机流程；
- 多屏、缩放、休眠恢复、托盘、闪烁、透明穿透、折叠与拖动回归；
- 记录启动、首屏历史、首 delta、ASR/TTS 延迟和常驻资源基线，再冻结合理预算；
- Secret、Token、日志、权限和打包文件审计。

完成标准：自动化、可复现构建和人工验收三类证据齐全；未测项不得标为通过。

### DP12：macOS 同流程适配与验收

- 依赖：DP11
- 状态：`PENDING`
- 文件边界：desktop platform adapter、entitlements、build config、质量证据

交付：

- macOS deep link `open-url`、单实例、麦克风权限、透明窗口、托盘与多屏行为；
- 构建、签名、公证和分发身份准备；
- 完成与 Windows 相同的登录、Conversation、文本/语音、历史、取消、结果和 handoff 流程；
- 平台差异封装在 main/platform adapter，不改变业务契约。

完成标准：打包应用实机证据通过；开发态 Electron 命令不能替代 deep link/权限验收。

### DP13：事实回写、能力状态与阶段结论

- 依赖：DP12
- 状态：`PENDING`
- 文件边界：产品、架构、质量、ADR、路线图、计划和发布证据

交付：

- 更新产品定义、核心用户流程、Gateway 多入口和桌宠模块设计；
- 删除 P1 假时序、旧固定会话和“尚未实现语音/身份”等过期描述；
- 统一 available/partial/planned/degraded 状态，链接真实测试与实机证据；
- 记录未完成能力、风险、回滚和下一阶段，不用愿景掩盖缺口；
- 满足全部验收后把 DP 计划压缩移入 completed 并更新索引。

完成标准：代码事实、PRD、ADR、架构、质量与计划无相互矛盾；阶段结论可审计。

## 八、阶段验收条件

1. Web 与桌宠读取相同 Notebook、Conversation、Message ID、Citation 和 Artifact 引用；
2. 桌宠可新建/切换 Conversation，重启或删除 View Cache 后恢复完整历史；
3. 文本和语音产生真实流式投影，取消、断线和恢复遵守 Operation 唯一终态；
4. 复杂结果显示可追溯卡片，用户点击 handoff 打开精确 Web 资源且不重复执行；
5. renderer/preload 不获得 Token、Provider Secret 或任意资源访问能力；
6. Windows 打包应用先通过完整主流程，macOS 随后通过同等业务验收；
7. 桌宠没有第二 Runtime、本地消息数据库、Prompt 主链、RAG、Memory 或直接 Provider Adapter；
8. 所有稳定事实完成 canonical 文档回写，未验证能力准确标记。

## 九、验证矩阵

| 任务            | 自动化证据                                                                    | 人工/环境证据                      | 状态      |
| --------------- | ----------------------------------------------------------------------------- | ---------------------------------- | --------- |
| DP00 需求与决策 | 文档链接、矛盾扫描、Desktop/Gateway 基线                                      | 项目负责人已接受 ADR-0028          | `PASS`    |
| DP01 身份解耦   | 45 个 auth/session 定向用例、14 个 Gateway 权限/会话用例、171 个 Desktop 回归 | 旧会话自动升级、撤销边界已自动验证 | `PASS`    |
| DP02 目录切换   | Desktop 175、Core 28、Client 16、Gateway HTTP 11；Desktop build               | Web/桌宠交叉切换仍需人工实机确认   | `PASS`    |
| DP03 历史       | repository/API/UI tests                                                       | 重启、删缓存、长历史               | `PASS`    |
| DP04 恢复       | Desktop 187（registry/resume/interrupted/cancel/race）                        | 断网、休眠、关窗（待人工实机确认） | `PASS`    |
| DP05 流式       | event bridge/UI tests                                                         | 首 delta 与切窗观察                | `PENDING` |
| DP06 能力       | core/client/server conformance                                                | 版本降级                           | `PENDING` |
| DP07 结果卡     | component/accessibility tests                                                 | 真实 Citation/Artifact             | `PENDING` |
| DP08 handoff    | core/client/server/repository/desktop/web token 与授权测试                    | 系统浏览器精确打开并入 DP11        | `PASS`    |
| DP09 语音对齐   | Desktop fake ASR/TTS/Turn、取消、messageId 与重播缓存测试                     | 真人中文麦克风并入 DP11            | `PASS`    |
| DP10 附件       | core/client/db/gateway/desktop Asset、Part、权限与隔离测试                    | 真实图片/PDF 上传并入 DP11         | `PASS`    |
| DP11 Windows    | build + desktop regression                                                    | Windows 11 实机                    | `PENDING` |
| DP12 macOS      | build + platform tests                                                        | macOS 打包实机                     | `PENDING` |
| DP13 收口       | link/lint/diff checks                                                         | 能力声明复核                       | `PENDING` |

## 十、预期事实回写

| 稳定事实类型                           | 目标文档                                                              |
| -------------------------------------- | --------------------------------------------------------------------- |
| 桌宠产品定位与用户流程                 | `docs/01-product/01-产品定义.md`、`03-用户流程.md`、本 PRD            |
| Gateway、Message、Operation 与 handoff | `docs/02-architecture/02-网关与多入口.md`                             |
| Electron 模块与平台差异                | `docs/02-architecture/06-桌宠模块设计.md`                             |
| 重大取舍                               | `docs/09-decisions/0028-桌宠作为统一EduCanvas系统的第一方桌面外延.md` |
| 自动化与实机证据                       | `docs/06-quality/` 对应桌宠验收文档                                   |
| 阶段交付                               | 本计划及 `docs/plan/completed/`                                       |

## 十一、风险与回退

- 服务端历史契约可能暴露 Message 双轨迁移差异；先做只读分页和一致性测试，不在客户端补假事实；
- 身份解耦涉及旧 Session 兼容；迁移失败时安全退出登录，不回退到宽授权；
- Operation 恢复可能与取消竞态冲突；以服务端唯一终态为准，保留原请求身份和事件序列；
- 结构化输出范围可能快速扩大；未知 Part 一律诚实 handoff，不临时复制 Web Renderer；
- Windows/macOS透明窗口差异可能需要平台 adapter；不得把差异泄漏进 Turn/Voice 契约；
- 图片/PDF输入延误时可移出首个发布版本，但不能削弱统一历史、恢复和 handoff 核心闭环。

## 十二、收尾检查表

- [ ] DP00-DP13 均有可复现证据；
- [ ] Windows 与 macOS 的人工验收分别记录，未用一种平台替代另一种；
- [ ] 稳定事实已回写 canonical 文档；
- [ ] ADR-0028 的最终状态与 ADR 索引一致；
- [ ] 不存在第二 Runtime、本地业务消息账本或桌宠专属 Prompt；
- [ ] 未完成项明确进入后续计划，不被描述成已可用；
- [ ] 计划已压缩归档并更新 active/completed 索引。
