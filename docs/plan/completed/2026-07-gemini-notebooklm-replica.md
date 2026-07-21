# Gemini + NotebookLM 产品体验建设结档记录

- 状态：`completed`
- 负责人：项目负责人
- 完成时间：2026-07-19
- 结档原因：M1–M4 与 UI U1–U4 已交付；视频经成本闸门顺延；原 PR-U5 被新的统一 Runtime 决策取代，不再以“先合并页面”继续开发
- 后续计划：[Gateway-first 个人 Agent 架构收口](2026-07-gateway-first-personal-agent.md)（已完成）

## 原目标

建立 Gemini 式 Chat/Canvas 共创与 NotebookLM 式 Notebook、Sources、引用和 Studio 体验，并补齐持久 Artifact、轻产物、网页来源与音频概览。

## 实际交付

- graphile-worker 持久任务、Artifact/Version/Generation Job、对象存储 Port 与可恢复 Studio；
- 思维导图、Slides、闪卡和音频概览，结构化 Artifact 可跨轮追加版本并恢复历史；
- Notebook 聚合：一对一 `Space + Conversation` 整体拥有 Sources、Chat 和 Studio；
- 侧栏历史、常驻来源面板、行内引用、网页搜索与安全抓取；
- 通用 Chat 的有界多圈工具回路与 `AgentToolRegistry` 基线；
- Canvas 工具入口、确认卡、持久任务状态与共创分栏；
- 视频概览完成成本与能力闸门评估，没有为了完成清单接入高成本 Preview Provider。

## 关键偏差

- Asset 与 Representation/Chunk 仍未完全统一；
- 通用服务端判分测验的私有判分载荷仍待设计；
- 原生图片、音频和视频模型输入仍未接通；
- `/learn` 没有直接并入 `/`。进一步代码审计确认，两页背后是两套 Agent Loop；只合并 UI 会固化重复架构，因此 PR-U5 取消，后续转入 Gateway-first 与统一 Runtime 迁移；
- M5 外部生成式视频因最低可用成本、Preview 配额与来源失真风险顺延，决策摘要见[关键决策历史](../../09-decisions/decision-history.md)。

## 验收证据

- PR #42–#75 交付持久任务、Artifact 主干、轻产物、Notebook UI、网页来源与最小 Runtime；
- 后续音频、Notebook 聚合和 Canvas 共创分支完成对应集成与 E2E 验收；
- 阶段记录曾验证 `make check`、PostgreSQL integration、production build 与 Chromium E2E；具体数量以各 PR 和当时 CI 为准，不作为当前分支永久基线；
- M3 进行真实联网冒烟，模型通过搜索与读页工具基于当日网页形成带来源回答；
- M4 验证任务恢复不会重复调用 TTS，音频二进制只进入对象存储。

## 未完成项去向

| 未完成项                                          | 去向                                                    |
| ------------------------------------------------- | ------------------------------------------------------- |
| 唯一 Agent Loop、通用 Tool Policy、Context Engine | 新计划 A1–A4                                            |
| 原生多模态 Provider 输入                          | 新计划 A5                                               |
| K12 能力与 `/learn` 收口                          | 新计划 A6–A8                                            |
| Asset/Representation/Chunk 深度统一               | 在 Context Engine/摄取后续计划中按证据排期              |
| 通用私有判分载荷                                  | 后续 Artifact 信任模型 ADR，不在 Runtime 迁移中顺带实现 |
| 确定性视频概览                                    | 保持顺延，出现成本与质量证据后另立计划                  |

## 已回写事实

- [产品定义](../../01-product/product-definition.md)
- [系统架构现状](../../02-architecture/01-系统架构现状.md)
- [Agent 编排边界](../../03-ai/01-Agent编排边界.md)
- [当前架构决策](../../09-decisions/README.md)
- [关键决策历史](../../09-decisions/decision-history.md)
