# 通用平台解耦与 Agent Runtime 强化计划

- 状态：`active`
- 负责人：项目负责人
- 最后验证时间：2026-07-16
- 对应路线图阶段：[阶段一：通用 Agent 基座与首个 K12 纵切](../../10-planning/roadmap.md#阶段一通用agent基座与首个k12纵切)
- 决策依据：[ADR-0009](../../09-decisions/0009-general-multimodal-platform-and-k12-vertical.md)

## 目标

在保留现有真实 Provider、SSE、消息账本、受控工具、可信学习事件和安全 Canvas 的前提下，将 EduCanvas 从“K12 纵切承载通用能力”的迁移态，推进为“通用 Chat/Space/Agent/Artifact 平台承载 K12 插件”的模块化单体。

本计划优先解决架构健康检查确认的正确性与扩展性问题，再进入 Notebook/Studio/更多 Canvas 类型和大规模视觉定稿。

## 当前事实

已验证的基础：

- 生产依赖图无环，`agent-core`与`model-gateway`不依赖 K12；
- 真实 Turn 经过 Provider、两阶段工具循环、数据库账本与 EduCanvas SSE，不回落到脚本回复；
- Asset 有匿名所有权、不可变版本和消息 Part；
- Canvas 使用严格 Schema、本地 Renderer 和服务端可信判分；
- 单元、PostgreSQL 集成、Chromium E2E、typecheck 与 production build 已建立 CI 基线。

必须修复的结构性缺口：

1. 模型跨轮历史已完成首个有界窗口与快照增量，摘要和Artifact上下文仍缺失；
2. `ModelMessage`仍是纯文本，原生图片/音频/视频引用无法进入 Provider；
3. Message、Model Run、Asset Space 仍依附 `lesson_sessions`；
4. `agent-runtime`尚未承载通用 Turn/Tool/Context 编排；
5. 上传 Asset 与可检索 Source/Chunk 是两套数据链路；
6. 中文 `simple` FTS、引用实际使用证明、附件重试、输出截断终态存在正确性缺口；
7. Artifact 仍是 K12 编译期闭集，缺提议、确认、生成、版本与 Studio 生命周期；
8. 上传配额、异步解析、匿名清理调度和对象删除尚未形成生产闭环。

## 架构约束

- 继续使用模块化单体；当前不拆独立微服务；
- K12 可以依赖通用平台能力，通用平台包不得反向依赖教学状态、掌握度或课程；
- 不执行模型生成的任意 HTML、JavaScript 或 GSAP；
- Provider SDK、模型 ID、原始事件和 Secret 只存在于 Adapter/组合根；
- PostgreSQL 继续作为事实源，数据迁移采用 additive migration、回填和双读/双写；
- 每项迁移必须保持现有 K12 纵切可回放、可验证和可回滚。

## 实施顺序

### PR-P0：连续对话与诚实终态

- [x] 增加有界`ConversationContextBuilder`，装配最近完整消息；
- [x] 持久化本轮实际使用的消息与Asset版本清单；
- [x] Retry 保留完整 `AgentMessagePart[]`，不丢附件；
- [x] `length`进入`output_limit`，未知 finish reason 进入协议失败；
- [ ] 增加摘要、Sources、Artifact 与 Vertical Context 的统一预算策略；
- Synthesis 显式返回实际使用的候选引用子集。

验收：跨轮上下文、附件失败重试、截断回答和引用子集均有 unit/integration/E2E。

### PR-P1：通用 Space / Conversation 数据骨架

- [x] 新增 `spaces`、`conversations`、`agent_operations`和通用消息骨架；
- [x] `lesson_sessions`通过`conversation_id`关联Conversation，旧数据完成回填，新Session原子双写；
- [x] 通用Conversation可脱离课程/掌握度持久化和恢复消息；
- [ ] 将生产Turn、Message Parts和Model Run双写/迁移到通用Operation；
- Asset 真正归属 Space，`turn`范围绑定创建它的 Turn；
- `model_runs.operationKind/phase`支持通用 Turn 与 Artifact Generation；
- 通过 additive migration、回填和兼容读取迁移既有匿名数据。

验收：一个不加载课程/掌握度的通用 Conversation 可以独立持久化、恢复和运行。

### PR-P2：通用 Agent Runtime 与插件边界

- 将可复用 Turn Engine、Context Builder、Tool Registry、Lease 与 Trace Port 迁入`agent-runtime`；
- 定义`AgentProfile`、`ToolProvider`、`SafetyPolicy`、`DomainEventSink`；
- K12 注册首个 Vertical Agent Profile；
- 将`learning-turn.ts`拆为 Start/Run/Replay 应用服务，传输契约移出 UI feature 目录；
- CI 增加源码 import graph 和禁止路径检查。

验收：通用 Agent 与 K12 Agent 复用同一 Turn Engine，K12 状态仍只能由可信领域事件更新。

### PR-P3：全模态 Asset / Source / Provider 统一

- 引入 `ModelInputPart` 与 Provider capability matrix；
- Provider Router决定原生输入、文本提取、转码或明确拒绝；
- 统一 AssetVersion、Representation、Chunk、Embedding 与 Citation Anchor；
- 上传进入异步解析/扫描 Worker，设置主体与 Space 配额；
- 建立中文 hybrid retrieval 冻结评测集；
- 增加 Provider attempt、健康度、熔断与受控 fallback。

验收：图片或音视频可由声明能力的 Provider原生消费；上传 PDF 可跨对话检索并跳转到原文引用。

### PR-P4：Artifact Runtime 与 Studio

- 建立`ArtifactProposal / Artifact / ArtifactVersion / GenerationJob`；
- 接通`proposed → confirmed → generating → ready|failed`事件；
- 使用受信`ArtifactPlugin`统一 Schema、公开投影、Renderer 与可选 Grader；
- 消息保存`artifact_ref`，Studio从服务端读取真实版本；
- Canvas Sidecar支持刷新恢复、深链接和版本切换。

验收：用户或 AI 可发起受控产物，未经确认/校验的内容不能挂载 Canvas。

### PR-P5：Platform Shell 与视觉定稿

- 根入口回归通用全模态 Chat；
- Rail承载 New Chat、Search、Conversations、Spaces/Notebooks、Studio 与 Agents；
- Sources Drawer、Conversation Surface、Artifact Sidecar和Vertical Agent Host解耦；
- K12课程标题、Progress、判分和专用Artifact通过Slot注入；
- 统一 Motion、Surface、Typography Token，并补完整视觉/无障碍回归。

验收：不加载 K12 时界面没有课程、掌握度或“AI老师”必选概念；进入 K12 Agent 后教学能力完整出现。

## 并行边界

- 数据迁移和 Agent Runtime 可以并行，但共同契约只由对应主 PR 修改；
- UI 可以先拆 PlatformShell/Vertical Slot，不提前伪造 Notebook、Studio 或生成态数据；
- K12 纵切继续维护回归和竞赛闭环，不在平台包复制教学状态；
- 大规模 UI 美化等待 P1/P2 的对象和装配边界稳定后进行。

## 质量门禁

- `make check`、`make build`、`make integration`和`make e2e`；
- dependency/import graph 无环且通用包无`teaching-*`反向依赖；
- 中文检索、引用对齐、上下文快照和Provider终态冻结集；
- 上传限流/配额/解析超时/恶意文件/对象删除残留测试；
- Stop、刷新、实例终止、Provider 429/5xx 和工具超时故障注入；
- Chat-empty、长对话、Sources、Canvas Sidecar、Studio、移动端和reduced-motion视觉回归。

## 完成条件

本计划完成时必须同时满足：

1. 通用 Conversation 可脱离 K12 独立运行；
2. K12 作为注册插件复用通用 Runtime；
3. 原生多模态、长期 Sources 和真实 Artifact 生命周期至少各有一条生产纵切；
4. 旧匿名 K12 数据完成兼容迁移与回放验证；
5. 稳定事实回写产品、架构、数据、API、质量和运维 canonical 文档；
6. 未完成的生产认证、多租户和学校治理进入独立 production-hardening 计划。
