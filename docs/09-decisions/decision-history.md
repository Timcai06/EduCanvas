# 关键决策历史

- 状态：`historical`
- 最后整理时间：2026-07-19

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
- K12 被重新定义为默认且最完整的教育能力，不再拥有独立循环；
- 随后进一步确定 EduCanvas 是“以教育能力为核心的通用个人 Agent 平台”；
- OpenClaw 的 Gateway、多渠道、客户端与 Node 模型成为产品架构参考，Claude Code 的循环、上下文和工具治理成为 Runtime 参考；
- Web 与 TUI 被定义为第一方客户端，社交媒体和语音通过 Channel Adapter 接入同一个 Gateway。
- 物理拓扑确定为云端 Gateway、每用户逻辑隔离与可选本地设备 Node，不建设每用户自托管 Gateway；
- 身份边界确定为一个自然人拥有一个个人 Agent，家庭与班级通过共享 Notebook 和显式角色授权协作，不共享 Agent 身份或私人记忆。
