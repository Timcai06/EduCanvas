# 真实 Agent 学习纵切与体验优化计划（结档）

- 状态：`completed`
- 负责人：项目负责人
- 完成时间：2026-07-17
- 对应路线图阶段：阶段一产品纵切 → 真实 Agent 纵切

## 目标与实际范围

把 K12 学习页从静态原型推进为真实 Agent 纵切：真实 Provider 流式 Turn、可审计账本、两阶段工具循环、可信检索引用、可信状态推进与受控 Artifact 模板。实际交付覆盖 G0、UX1/UX2/UX3/UX4、A1/A2/A3/A4、D1、S1、K1、T1（`ASSESS` 接线）与 C2，另交付通用 Asset 纵切（PDF/图片上传、不可变版本、消息 Part）。

## 关键结果

- EduCanvas SSE v1 自有流式协议；真实 DeepSeek Provider 原生 SSE Adapter，无 Provider 时诚实失败；
- Turn/Message/Model Run/Tool Call 账本、promptHash 审计、取消/租约/幂等与刷新恢复；
- 两阶段工具循环（answer → tools → synthesis），后续修正为容忍工具前导文本；
- 审核课程资料 + FTS 检索 + 服务端引用防伪（K1）；`ASSESS` 出口的可信状态推进与回放（T1 部分）；
- `pipeline_flow` 受控动画模板、AnimationShell 与统一控制协议（C2）；
- 深色 Chat-first UI、Ambient Halo、真实流式对话体验与会话型 Learning Rail。

## 验证证据

2026-07-16 基线：289 项单元测试、46 项 PostgreSQL integration、23 项 Chromium E2E、typecheck 与 production build 全部通过；桌面/移动深色视觉基线、reduced-motion 与键盘焦点验收通过。

## 未完成项去向

| 事项                                                           | 去向                                                                                                             |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| PR-C1（Artifact 提议/确认/生成/真实 Studio）                   | 升格为通用 Artifact Runtime，由[后续计划](2026-07-gemini-notebooklm-replica.md) M1 吸收，不再按 K12 专用路径开发 |
| 非 `ASSESS` 状态事件接线、整节课 E2E、受控 live Provider smoke | 新计划"承接债务清单 · K12 收尾"，竞赛节点前独立小批执行                                                          |
| PR-K2（pgvector/重排/评测）                                    | 维持"指标触发"条件，未触发不执行                                                                                 |
| production hardening                                           | 继续保持独立非目标                                                                                               |

## 事实回写

当时的 Provider/账本决策已验收；当前仍有效的约束见[决策历史](../../09-decisions/decision-history.md)与现行 ADR。协议、数据、架构事实已回写 `docs/02-architecture/`、`docs/04-data/`、`docs/05-engineering/` 与 README/技术报告。
