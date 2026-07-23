# 关键决策历史

- 状态：`historical`
- 最后整理时间：2026-07-23

本文件只保留解释当前架构所必需的演进记录。旧 ADR 已按项目负责人决定删除；其中仍有效的约束已重写进入 ADR-0015 至 ADR-0019。具体 PR、测试和阶段交付证据见 `docs/plan/completed/` 与 Git 历史。

## 2026-07-13：K12 纵切与模块化单体

- 项目以 K12 AI 通识课竞赛启动，选择 Next.js、TypeScript、PostgreSQL、Drizzle 和 Workspace Package，以最短路径验证真实闭环；
- Canvas 最初只允许严格 Schema 和预注册 React Renderer；
- 后续证明“模块化单体”可以包含 Web 与 Worker 多个进程，不等于把所有逻辑写入 Next.js。

## 2026-07-14：可信教学事实

- 浏览器交互与可信学习事件分离；答案和判分规则留在服务端；
- 五阶段课程状态、掌握度与误区模型被实现为确定性教育逻辑；
- 现方向保留可信判分与事件回放，但把五阶段流程缩为可选结构化课程。

## 2026-07-15：真实 Provider 与可恢复 Turn

- 接通真实流式 Provider，建立 Message、Model Run、Tool Call、安全决策、取消、幂等、租约和刷新恢复账本；
- 工具前导文本兼容、固定 answer/synthesis 两阶段和 DeepSeek 环境门控属于当时实现决策，不再作为长期顶层架构；
- 供应商类型不进入 Core、无 Provider 时诚实失败、测试 Gateway 不进入生产组合根等原则继续有效。

## 2026-07-16：通用平台与 Artifact 信任分层

- 通用消息、Asset、Provider 和 Artifact 从 K12 包中解耦；
- Canvas 扩展为两级信任：可判分的结构化 Artifact 与不产生学习事实的隔离沙箱 Artifact；
- 产品开始从单一教学页面转向 Chat、Sources、Studio 和 Canvas 组成的 Notebook 体验。

## 2026-07-17 至 2026-07-18：持久 Artifact 与 Notebook 体验

- 采用 graphile-worker、Artifact/Version/Job、对象存储与可恢复 Studio；
- 交付导图、Slides、闪卡、音频、网页来源、行内引用和 Canvas 共创；
- 外部生成式视频因成本、来源失真和年龄边界未通过闸门，保持未实现状态；
- 一对一 `Space + Conversation` 被投影为 Notebook，这是当前迁移基线而非永久数据限制。

## 2026-07-19：统一 Runtime 与 Gateway-first 转向

- 代码审计确认通用 Chat 与 K12 存在两套 Agent Loop，决定收敛为唯一 Runtime；
- 当时把 K12 阶段性表述为“默认且最完整的教育能力”，并决定它不再拥有独立循环；2026-07-23 进一步澄清为“教育是核心能力，结构化 K12 按需启用”；
- 随后进一步确定 EduCanvas 是“以教育能力为核心的通用个人 Agent 平台”；
- OpenClaw 的 Gateway、多渠道、客户端与 Node 模型成为产品架构参考，Claude Code 的循环、上下文和工具治理成为 Runtime 参考；
- Web 与 TUI 被定义为第一方客户端，社交媒体和语音通过 Channel Adapter 接入同一个 Gateway。
- 物理拓扑确定为云端 Gateway、每用户逻辑隔离与可选本地设备 Node，不建设每用户自托管 Gateway；
- 身份边界确定为一个自然人拥有一个个人 Agent，家庭与班级通过共享 Notebook 和显式角色授权协作，不共享 Agent 身份或私人记忆。

## 2026-07-21 至 2026-07-23：第二代内核与决策纠偏

- 第二代架构收敛到唯一 Turn Application、Agent Loop、Context Engine 与 Tool Kernel；教育保留确定性领域服务，不再拥有第二套模型或工具生命周期；
- Gateway 被明确为身份、路由、Operation、审批和投递的逻辑权威。Web 使用共进程 BFF/SSE Adapter，TUI、Channel 与 Node 使用远程协议；统一的是可信事实和运行语义，不是强制网络拓扑；
- “教育为核心”被明确为能力、安全和可信边界，默认对话不假定用户正在上课；结构化 K12 Profile 只在诊断、练习、测评和学习证据场景按需启用；
- 自动 effect verifier、完整 OpenTelemetry Collector、正式 IdP、Memory 和原生多模态不再被捆绑为第二代内核完成条件，分别进入有真实消费者的安全、生产或产品计划；
- Web 持续动效与 GPU 的具体库、Chunk 和性能约束曾以 ADR-0022 记录。复核后确认它们属于产品视觉与质量基线，稳定要求已迁入学生端规格和视觉回归文档，ADR-0022 删除。
