# ADR-0027：Canvas 多形态输出与交互运行时边界

- 状态：`accepted`
- 日期：2026-08-11
- 负责人：@Timcai06
- 扩展：[ADR-0009](./0009-统一画布工作面与运行时分层.md)、[ADR-0019](./0019-持久Web%20Runtime隔离与安全边界.md)

## 背景

EduCanvas 的 Canvas 已能展示 Markdown 笔记、思维导图、闪卡、幻灯片、图片和轻量 HTML
预览，但不同输出形态的产品定位尚未统一。仅输出 Markdown 无法覆盖模拟器、教学游戏和
交互数据探索；让模型为所有结果自由生成 HTML/JavaScript 又会牺牲一致性、可编辑性、
无障碍、版本兼容和主应用安全。

浏览器中的交互最终会落到 DOM、SVG、Canvas/WebGL 和 JavaScript 运行时，但这不代表
Agent 必须始终输出任意 HTML。NotebookLM 式固定学习产物与 Gemini Canvas 式自由 Web
应用分别解决稳定交互和开放创造问题，EduCanvas 需要同时支持二者。

## 候选方案

### 方案一：全部输出 Markdown

- 优点：简单、可编辑、可导出、LLM 友好；
- 缺点：无法表达复杂状态、拖拽、模拟、运行逻辑和持续交互；
- 结论：只作为文档输出，不作为唯一 Canvas 形态。

### 方案二：全部输出自由 HTML/JavaScript

- 优点：表达能力最大；
- 缺点：视觉与交互不稳定，难以做结构化编辑和跨版本迁移，并扩大执行与供应链风险；
- 结论：只作为受隔离的自由应用输出，不作为默认 Artifact 契约。

### 方案三：Markdown、类型化 Artifact 与自由 Web App 三层并存

- 优点：稳定产物走可信 Renderer，开放需求进入隔离 Runtime；按任务选择复杂度和信任层；
- 代价：需要版本化 Artifact schema、Renderer Registry 与 Web Runtime 生命周期；
- 结论：采纳。

## 决定

### 1. 提供四种用户输出意图

Composer、Canvas 或 Agent 工具可表达以下输出偏好：

- `auto`：默认。Agent 根据任务选择聊天文本、Markdown 文档、类型化 Artifact 或 Web App；
- `markdown_document`：产生可编辑、可复制、可下载 `.md` 的文档 Artifact；
- `interactive_artifact`：产生受协议约束的教学互动 Artifact；
- `web_app`：产生自由 HTML/CSS/JavaScript 或 React 应用源码并进入隔离 Runtime。

该偏好只是 Turn 输入的一部分，不创建第二套 Agent Loop，也不允许浏览器指定模型、Provider、
存储 key 或服务端身份。

### 2. Markdown 文档是知识输出，不是任意运行时

- 报告、教案、笔记、学习总结和可导出文档使用 `document.markdown` Artifact。
- Markdown 原文是可编辑的 canonical content；Renderer 将其解析为受信任组件，不执行
  `rehype-raw`、内联脚本、事件属性或任意网络资源。
- Mermaid 等声明式图形必须经过预注册 Renderer 或服务端安全预渲染；不能借代码块降级
  主页面 CSP。

### 3. 稳定教学互动使用类型化 Artifact

思维导图、测验、闪卡、时间线、流程图、幻灯片和受控实验优先使用版本化 schema，例如：

- `mind_map.v2`：节点、边、分组、语义角色与布局提示；
- `quiz.v1`：题目、选项、答案引用与反馈；
- `flashcards.v1`：卡片、掌握状态和来源；
- `slides.v1`：页面、内容块、媒体引用和演示元数据。

Agent 输出结构化 Artifact Proposal，`packages/canvas-protocol` 严格验证后，由预注册的可信
React/SVG/Canvas Renderer 呈现。缩放、折叠、拖拽、答题、动画、键盘和无障碍行为由 Renderer
实现，而不是让模型每次重新编写 HTML。

思维导图是否美观主要由布局算法、节点密度、视觉 token、视口交互和动效状态决定；不能用
自由 HTML 掩盖 Renderer 质量问题。模型只负责语义结构和有限布局提示。

### 4. 开放创造使用自由 Web App Artifact

模拟器、教学游戏、交互仪表盘和无法被现有 schema 表达的界面使用 `web_app.v1` Artifact，
其不可变版本至少包含：

- 文件 manifest、入口文件与内容 hash；
- HTML/CSS/JavaScript 或受支持的 React 源码；
- 精确锁定的依赖和版本；
- 声明的 Runtime capability、资源预算与协议版本；
- 构建诊断和可审计终态，不包含服务端密钥或用户 Credential。

源码不是主页面 HTML。它必须经过校验、构建和发布成为不可变 Artifact Version，再交给
ADR-0019 定义的 Tier 2 Web Runtime Adapter。轻量一次性预览继续使用既有 `srcdoc` 边界，
不得承担持久 Runtime 生命周期。

### 5. Web Runtime 不继承主应用信任

自由 Web App 必须遵守 ADR-0019 的全部安全不变量，尤其是：

- iframe 不使用 `allow-same-origin`，默认无网络、Cookie、Credential 与宿主 Storage；
- 禁止任意 CDN、运行时安装依赖、弹窗、表单、顶层导航和跨 Notebook 读取；
- Host 与 Runtime 只通过版本化闭集消息、实例 nonce、Artifact Version 和顺序校验通信；
- 运行、取消、超时、崩溃和配额超限产生稳定终态；浏览器不是权限或审计事实源；
- Runtime 事件不能直接写 mastery、learning events 或其他可信学习事实，必须经服务端授权工具。

本 ADR 不复制 ADR-0019 的 Runtime 实现任务；它只决定什么输出可以进入该 Runtime。

### 6. 输出仍由唯一 Agent Runtime 和 Canvas 工具产生

- General/Teaching Turn 继续进入 `TurnApplicationService` 与唯一 Agent Runtime。
- Agent 通过现有 Canvas/Artifact Tool 提交闭集 Proposal；服务端注入用户、Notebook、
  Conversation 和 Artifact 身份，重新鉴权并持久化版本。
- Provider 原始响应、Prompt、密钥、堆栈和未验证代码不得进入浏览器协议。
- 输入来源只以 `assetId + versionId` 和实际 materialized representation 进入 provenance；
  Artifact 不复制或获得 Source 权限。

### 7. Canvas 负责编辑、版本、导出与连续体验

- 每次生成或修改产生新的不可变 Artifact Version；用户可查看差异、回退或继续要求 Agent 修改。
- Markdown 文档支持 `.md` 导出；类型化 Artifact 支持由 Renderer 定义的安全导出；Web App
  支持源码/发布包导出时必须去除运行凭证和私有 Source。
- Live Voice 只投影 Artifact 状态与预览；打开或编辑时回到同一 Canvas，不复制 Renderer 或
  Runtime。
- 生成中、失败、不支持和降级状态必须诚实展示，不能以空白 Canvas 伪装成功。

## 所有权与交付边界

ADR-0027 及其实现由 `@Timcai06` 负责，范围包括：

- Canvas 输出模式与 Composer/Tool 意图；
- `canvas-protocol` Artifact schema、Renderer manifest 与兼容策略；
- Markdown 文档、思维导图等类型化 Renderer 的视觉和交互品质；
- `web_app.v1` 构建、预览、持久 Runtime 接线与安全门禁；
- Artifact 编辑、版本、导出、分享和端到端验收。

原文件上传、MinerU、派生 Markdown/图片、Source 预览和 Agent 输入 materialization 由
[ADR-0026](./0026-多模态输入原件与派生表示边界.md)及 `@hzlgou` 负责。两条线共享小型、
版本化的 context part / artifact proposal 契约，不跨越对方模块建立旁路。

## 后果

- 常见教学互动获得稳定、一致、可测试的产品体验；开放任务仍可生成真正可运行的网页应用。
- Renderer 质量成为产品能力，需要独立的布局、视觉、动效、无障碍和性能门禁。
- 自由 Web App 引入构建、依赖治理和 Runtime 成本；任何无法证明隔离的能力默认关闭。
- Artifact schema 演进必须版本化并保留旧 Renderer 或明确迁移，不能让历史 Canvas 静默失效。
- Markdown、类型化 Artifact 和 Web App 是输出契约，不改变 Source 原件及其派生表示主权。

## 验证方式

1. 用户分别选择 Markdown、教学互动和自由网页，均经过同一 Turn/Agent Runtime 产生正确 Artifact。
2. Markdown Artifact 可编辑、版本化并导出 `.md`，原始 HTML 和脚本不在主页面执行。
3. `mind_map.v2` 在大图、窄屏和键盘环境下支持缩放、折叠、聚焦、节点提问和稳定布局；
   视觉回归不依赖模型随机生成 CSS。
4. `web_app.v1` 可运行真实 HTML/React 交互，并提供代码、预览、构建诊断和可取消生命周期。
5. 恶意脚本无法读取宿主 Cookie/Storage、私有 Source、非白名单网络或跨 Notebook Artifact。
6. 未知 Artifact kind/schema/version、未锁依赖、超限输出和重复终态全部 fail-closed。
7. Artifact provenance 能追溯实际输入版本，但不能凭浏览器声明绕过 Source 权限。
8. CI 使用固定 Artifact fixture 和 fake Runtime 验证契约、Renderer、消息桥与失败状态；非合作负载
   和真实浏览器隔离验收按 ADR-0019 单独执行，不在普通文档 PR 重复运行全量门禁。
