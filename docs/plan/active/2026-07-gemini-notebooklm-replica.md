# Gemini + NotebookLM 产品复刻计划

- 状态：`active`
- 负责人：项目负责人
- 最后验证时间：2026-07-17
- 取代：[`2026-07-platform-decoupling-runtime-hardening.md`](../completed/2026-07-platform-decoupling-runtime-hardening.md) 与 [`2026-07-real-agent-learning-vertical-slice.md`](../completed/2026-07-real-agent-learning-vertical-slice.md) 的未完成部分
- 关键决策：[ADR-0009](../../09-decisions/0009-general-multimodal-platform-and-k12-vertical.md)、[ADR-0010](../../09-decisions/0010-canvas-trust-tiers.md)、[ADR-0011](../../09-decisions/0011-answer-phase-tool-preamble.md)、[ADR-0012](../../09-decisions/0012-artifact-runtime-durable-jobs.md)

## 目标

阶段目标是复刻 Gemini + NotebookLM 的产品体验：产品第一身份是多模态输入输出的 AI Agent（AI 老师是按需激活的第二身份），一个界面承载 Gemini 式对话与 Canvas 共创、NotebookLM 式来源管理与 Studio 产物输出。Agent 编排优化与各类创新属于下一阶段，不进入本计划。

体验基准（2026-07 拆解结论，写入 [student-ui-spec](../../01-product/student-ui-spec.md)）：

- Gemini：侧栏历史对话；落地渐变问候；输入框工具芯片（Canvas 可被用户显式选择，也可被模型建议）；Canvas 是持久、可跨轮迭代、有版本的共创分栏；
- NotebookLM：来源常驻面板（文档/网页/搜索结果，逐条勾选）；回答带行内数字引用可跳转原文；Studio 面板一键生成导图/Slides/测验/闪卡/音频概览/视频等产物。

## 当前事实（2026-07-17）

- 已具备：真实 Provider SSE Turn（含工具前导文本容忍）、Space/Conversation/Operation 数据骨架、PDF/图片 Asset、FTS 检索与引用、统一分栏 CanvasHost（Tier 1 判分 + Tier 2 沙箱预览共用）、Markdown 渲染、深色 Gemini 式视觉;
- 结构性缺口：无持久异步任务与 worker、Artifact 非一等公民、SSE 无产物事件、无对象存储 Port、Turn 硬限两跑、Asset 与 Source/Chunk 双链路、无网页搜索来源、来源藏在抽屉、无侧栏历史、引用是尾部胶囊。

## 里程碑

### M1 产物主干（关键路径第一站，依 ADR-0012）

- [ ] PostgreSQL 任务队列选型（graphile-worker vs pg-boss 对比记录回写 ADR-0012）与 worker 进程接入 `make dev`/CI；
- [ ] `artifacts` / `artifact_versions` / `artifact_generation_jobs` 表与仓储（additive migration）；
- [ ] SSE 协议新增 `artifact.*` 事件族并递增版本；断连后经 Conversation 恢复产物状态；
- [ ] `ObjectStoragePort`（本地实现起步）；
- [ ] 吸收原纵切 PR-C1：产物提议 → 用户确认 → 生成任务 → Studio 真实列表。

验收：一个"生成思维导图"全链路（对话 → 确认 → 任务 → 产物卡 → Canvas 打开 → 版本可查）在 E2E 中可复现；worker 杀进程重启后任务恢复。

### M2 轻产物三连（零重基建，紧随 M1 数据模型）

- [ ] 思维导图 Artifact（结构化 JSON Schema + 客户端渲染）；
- [ ] Slides Schema Artifact（大纲 → 分页渲染，导出后置）；
- [ ] 泛化 K12 测验/闪卡为通用 Artifact 类型（判分机制复用，脱离课程绑定）。

### M3 来源统一与网页搜索

- [ ] Asset 与 Source/Chunk 合并为单链路（承接旧平台计划缺口 5）；
- [ ] 最小 Agent Runtime 前置：`maxToolRounds` 从硬编码两跑降级为 Agent Profile 策略 + Tool Registry（完整 AgentProfile/Policy 体系仍属下一阶段）；
- [ ] 搜索 Provider Adapter 与 URL 抓取器，结果进入统一 Source 管道并可被勾选、引用。

### M4 音频概览

- [ ] `speech.generate` Provider Adapter（复用别名治理）；
- [ ] 脚本生成 → TTS → 对象存储 → 音频产物卡与播放器。

### M5 视频概览（最重，最后）

- [ ] Provider 选型与成本评估先行，未评估前不开工。

### UI 蓝图线（与 M1 起并行推进）

- [ ] 侧栏历史对话（Conversation 列表接口 + 左侧栏）；
- [ ] 来源常驻面板替代 Sheet 抽屉；行内数字引用跳转原文（数据已有，展示层改造）；
- [ ] 输入框工具芯片（Canvas / 来源），Canvas 芯片选中后本轮产物进分栏；
- [ ] Canvas 共创化：产物持久挂接 Conversation，模型跨轮迭代同一产物（依赖 M1）；
- [ ] `/learn` 并入 `/` 统一界面（教学 Turn 接入 + learning-flow E2E 重写，与最小 Agent Runtime 协同排期）。

## 承接债务清单（旧计划未完成项，不丢）

| 来源 | 事项 | 归属 |
| --- | --- | --- |
| 平台计划 P0 | 摘要/Sources/Artifact/Vertical Context 统一预算策略；synthesis 返回实际引用子集 | M3 |
| 平台计划 P1 | 生产 Turn/Message Parts/Model Run 迁移通用 Operation；Asset 归属 Space | M1 前置或并行 |
| 纵切计划 | 非 `ASSESS` 状态事件接线、整节课 E2E、受控 live Provider smoke | K12 收尾，竞赛节点前独立小批执行 |
| 纵切计划 | 沙箱预览 E2E 覆盖（需 Scripted 流回放输出 ```html） | M1 验收一并补 |

## 非目标

- production hardening（正式认证、多租户、法务/DPA、备份、分布式限流、SLO 与灰度）；
- Agent 编排优化、多 Agent、记忆系统等创新（下一阶段）；
- 微服务拆分：worker 进程是单体内的第二进程，不是服务边界。

## 质量门禁

- 每个里程碑内的核心纯逻辑（任务状态机、产物 Schema、来源合并）在实现 PR 附单元测试；
- 迁移全部 additive + 回填 + 兼容读取，K12 纵切回归（现有 E2E）在每次合并前保持通过；
- 行为/协议/数据变化在同 PR 更新 canonical 文档；重大取舍先 ADR。

## 完成条件

- M1–M4 验收全部有可复现证据（M5 允许顺延为独立计划）；
- UI 蓝图线五项落地且视觉基线更新；
- 承接债务清单清零或显式移交下一计划；
- 稳定事实回写 canonical 文档，本计划压缩移入 `completed/`。
