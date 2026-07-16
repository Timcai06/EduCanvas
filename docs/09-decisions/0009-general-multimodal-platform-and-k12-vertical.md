# ADR-0009：通用全模态 AI 平台与 K12 垂直能力分层

- 状态：`accepted`
- 日期：2026-07-16
- 决策人：项目负责人

## 背景

EduCanvas 最初以 K12 AI 通识课竞赛纵切建立真实对话、Provider、受控 Canvas、知识资料、教学状态机和可信判分能力。随着产品方向明确，如果继续让通用消息、模型、资产和 Artifact 基础设施从属于教学领域，平台会被误解为单一 AI 教师，也会迫使未来研究、创作等 Agent 依赖课程、掌握度和教学状态。

产品北星已经调整为：一个以对话为核心、可以理解和生成文本、图片、音频、视频、Slide、文档与可交互内容的全模态 AI；K12 全模态教学是首个附属垂直产品，而不是产品本体。

## 决定

1. EduCanvas 平台能力分为 Chat、Assets、Agent Runtime、Artifact Runtime、Studio 与 Provider/Data 基础设施；这些能力不依赖 K12 教学概念。
2. K12 AI 教师作为首个 Vertical Agent，拥有课程、知识节点、教学状态机、掌握度、误区、服务端判分和学习进度；这些领域事实不得进入通用平台契约。
3. `teaching-core`与`teaching-runtime`继续保留为 K12 垂直领域包。当前位于其中的通用模型、消息、工具和运行契约按小步迁移抽取到`agent-core`与后续`agent-runtime`，迁移期允许兼容导出，禁止一次性重写。
4. `model-gateway`最终只依赖通用 Agent 契约，不依赖`teaching-core`。Provider供应商、模型ID和原始流事件继续被限制在Adapter内部。
5. `canvas-protocol`演进为通用 Artifact 协议基础；教学测验、分类游戏和流程动画是注册的K12 Artifact类型。模型生成的任意HTML、JavaScript或GSAP源码仍不在主页面直接执行。
6. 文件、图片、音频、视频和网页统一建模为Asset；Asset可以仅绑定当前Turn，也可以显式升级为长期Workspace资产。课程资料是K12对通用Asset/检索能力的受控适配。
7. Web默认产品形态为Chat-first通用入口。Canvas、Assets、Studio和Vertical Agent按用户意图出现；进入K12 Agent后才启用年龄策略、课程上下文、教学状态和Progress。
8. 当前仍保持模块化单体。平台/垂直分层通过workspace包和Port/Adapter实现，不因产品定位调整立即拆微服务。

## 原因

- 保持Gemini式通用对话入口，同时吸收NotebookLM式持久资产和来源能力；
- 让K12教学成为可复用平台上的专业能力，而不是限制整个平台的数据模型和UX；
- 复用已经验证的Turn、SSE、Provider、账本和受控Artifact能力，避免定位调整演变为高风险重写；
- 为后续研究、创作和其他全模态Agent提供稳定接入边界。

## 后果

- 当前`model-gateway -> teaching-core`依赖需要逐步消除；
- Web与数据库中带教学语义的现有对象继续服务K12纵切，通用Workspace/Asset/Artifact对象按真实功能到来增量引入；
- canonical文档必须区分平台北星、K12垂直产品和竞赛交付，不再把三者混写；
- K1/T1仍是K12纵切的重要工作，但不能阻塞通用Agent与Artifact基础契约的抽取；
- 安全策略分为平台通用基线与K12增强策略，未成年人规则不能被其他Agent绕过，也不要求所有Agent都持有学习状态。

## 验证方式

- 依赖图证明`agent-core`不依赖`teaching-*`、Web、数据库或供应商SDK；
- `model-gateway`迁移后不再依赖`teaching-core`，现有Provider Fixture与Turn测试保持通过；
- K12状态机、掌握度和判分测试继续只位于教学边界；
- 新增一个不加载课程/掌握度的通用Agent契约测试，证明通用Turn可以独立成立；
- 生产依赖边界测试禁止通用平台包反向导入`teaching-core`或`teaching-runtime`。
