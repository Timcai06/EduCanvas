# ADR-0009：统一 Canvas 工作面与运行时分层

- 状态：`accepted`
- 日期：2026-07-25
- 负责人：项目负责人

## 背景

EduCanvas 已有 Source、Studio、持久 Artifact、受控教学 Renderer 和轻量 HTML 沙箱，但产品与架构文档仍把 Canvas 主要描述为“教学组件与 GSAP”。这会产生三个问题：

1. 来源被理解为历史记录的一部分，产物被理解为 Studio 的私有内容，无法形成同一 Notebook 工作面；
2. 文档、媒体、交互应用、代码和机器学习被错误地压成一种 Artifact 或一个前端组件；
3. “都能在 Canvas 打开”容易被误读为允许模型代码进入主页面，或由浏览器直接写入学习事实。

下一阶段需要支持更多多模态输入输出和可运行环境，因此必须先固定归属、渲染、执行和信任边界。

## 候选方案

### 方案一：Canvas 只渲染结构化教学 Artifact

边界最简单，但来源预览、通用创作和探索型应用会继续分裂到其他页面，无法支撑通用个人 Agent。

### 方案二：Canvas 成为所有内容和运行状态的持久化聚合根

表面统一，但会复制 Notebook、Source、Artifact 和 Operation 事实，形成新的巨型领域对象。

### 方案三：Canvas 是统一工作面，存储与执行保持分层

Notebook 继续拥有事实；Studio 管理输入与输出；Canvas 依据统一资源描述选择 Renderer 或 Runtime。结构化、沙箱和计算环境使用不同信任层。

## 决定

选择方案三，并接受以下约束：

1. Notebook 继续作为 Source、Conversation、Artifact、Membership、Notebook Memory 和运行记录的归属边界；Canvas 不成为新的数据库聚合根。
2. Studio 是同一 Notebook 中“输入”和“输出”的目录与操作入口，不复制 Source 或 Artifact。
3. Canvas 是客户端统一工作面。Source 可按引用预览，Artifact 可编辑和对比版本，Runtime 可展示运行状态，但事实仍由各自 Repository 保存。
4. 引入稳定的 `CanvasResource`/Renderer Registry 边界。资源必须携带 Notebook 归属、表示类型、版本、信任层、允许动作、Provenance 和所需 Runtime；不能靠前端扩展名判断权限。
5. 结构化 Artifact 使用严格 Schema 和预注册 Renderer；影响学习事实的交互必须由服务端领域服务验证。
6. HTML、未来 React/GSAP/Motion/Three.js 应用只能在隔离 Web Runtime 中运行。依赖使用平台审计、固定版本的包，不允许模型从任意网络地址加载代码。
7. 代码与机器学习由 `ExperimentRuntimePort` 后的受控 Compute Runtime 执行；Canvas 只负责编辑、控制和呈现，不直接获得宿主机执行权。
8. Runtime 必须提供资源配额、取消、超时、结果未知、日志和审计。输入、代码、依赖、随机种子和输出需要可追溯版本。
9. Source、Artifact 和 Runtime Record 保持独立事实源；二进制进入对象存储，PostgreSQL 保存引用、校验和和可审计元数据。
10. 不支持的 Renderer、Provider 或 Runtime 明确返回 unavailable，不生成假的预览、媒体或执行结果。

## 原因

这个方案同时满足 NotebookLM 式来源归属、Gemini Canvas 式创作工作面和飞桨式计算环境的产品方向，又不把高风险执行能力塞进浏览器或通用 Agent Loop。它延续现有模块化单体、Artifact 不可变版本、Tool Kernel、Operation 和分层信任设计，可用小型纵切逐步落地。

## 后果

- Source 与 Artifact 可以在同一 Canvas 打开，但 UI 统一不等于数据模型合并；
- Studio 的信息架构需要按输入与输出组织，Canvas 负责实际阅读和共创；
- `packages/canvas-protocol` 后续需要拆出资源描述、Renderer manifest 和 Runtime capability，保持无 React、数据库和 Provider 依赖；
- Web Renderer、沙箱 Adapter、Compute Adapter 和 Worker 必须是独立模块，禁止形成单个超大 Canvas 分发文件；
- 引入 React、GSAP、Motion、Three.js 或计算镜像都需要单独的供应链、资源和安全复核；
- TUI 和渠道可以管理、创建和交接 Canvas 资源，但不需要复制完整视觉 Renderer。

## 验证方式

- 同一 Notebook 中，来源与产物可从 Studio 打开到同一 Canvas，切换 Notebook 后不会串读；
- 新增类型只需注册协议、Renderer 或 Runtime Adapter，不修改 Notebook 归属模型或复制 Agent Loop；
- 跨用户、跨 Notebook、未知 Renderer、未知依赖和越权 Runtime 请求均 fail closed；
- Tier 2/3 无法访问主页面 DOM、Cookie、Credential、宿主文件系统或可信学习事件写入口；
- 每个持久产物和运行输出均能追溯来源、输入版本、生成或执行记录；
- 取消、超时、失败和结果未知在 Web、TUI 与恢复路径上保持一致。

## 实施状态（2026-07-27）

`CanvasResource` 协议以及 Source/Artifact 服务端 Adapter 已定义并接入有界读取组合层；
资源投影仍以 Source、Artifact 和 Operation 的既有事实为准，没有新增 Canvas 数据库
聚合根。现有 Asset Preview、Artifact Detail、消息末尾 Artifact 和 Studio 兼容行为
继续保留。Web Renderer Registry 尚未迁移到统一 Registry，隔离 Web Runtime 与
`ExperimentRuntimePort` 也尚未完成，不能把协议和 Adapter 落地描述成整个 Canvas
运行时已经完成。
