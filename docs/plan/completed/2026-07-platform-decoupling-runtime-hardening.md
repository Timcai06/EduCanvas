# 通用平台解耦与 Agent Runtime 强化计划（结档）

- 状态：`completed`
- 负责人：项目负责人
- 完成时间：2026-07-17
- 结档原因：P0/P1 主体交付后，阶段目标重排为“复刻 Gemini + NotebookLM”，P2–P5 的实施顺序不再适用；未完成项移交[后续计划](2026-07-gemini-notebooklm-replica.md)，按新关键路径重新排队

## 目标与实际范围

把 K12 纵切验证过的对话、Provider、资产与账本能力解耦为通用平台底座。实际交付止于 P0（连续对话与诚实终态）主体与 P1（通用 Space/Conversation 数据骨架）主体；P2（通用 Agent Runtime）、P3（全模态 Asset/Source）、P4（Artifact Runtime）、P5（Platform Shell）未开工即结档。

## 关键结果

- 有界 `ConversationContextBuilder` 跨轮历史与 Context Snapshot；Retry 保留完整 `AgentMessagePart[]`；`length` 终态进入 `output_limit`，未知 finish reason 进入协议失败；
- `spaces` / `conversations` / `agent_operations` 与通用消息骨架落库，旧数据回填、新 Session 原子双写；通用 Conversation 可脱离课程/掌握度持久化与恢复；
- 默认入口切换为通用 AI 对话，通用 Turn 取消生命周期补齐（PR #31–#34）；
- `model-gateway` 只依赖 `agent-core` 的依赖图验证完成。

## 验证证据

随 PR #31–#34 合并时的完整基线（单元/集成/E2E/typecheck/build 全绿）；生产依赖边界测试确认平台包不反向依赖 `teaching-*`。

## 未完成项去向

| 事项                                                            | 去向                                                                                                    |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| P0 余项：统一预算策略、synthesis 实际引用子集                   | 新计划 M3                                                                                               |
| P1 余项：生产 Turn/Model Run 迁通用 Operation、Asset 归属 Space | 新计划 M1 前置/并行                                                                                     |
| P2 通用 Agent Runtime                                           | 最小集（maxToolRounds 策略 + Tool Registry）进新计划 M3 前置；完整 AgentProfile/Policy 体系留给下一阶段 |
| P3 全模态 Asset/Source 统一                                     | 新计划 M3                                                                                               |
| P4 Artifact Runtime                                             | 提前为新计划 M1（关键路径第一站）                                                                       |
| P5 Platform Shell                                               | 新计划 UI 蓝图线（侧栏/来源常驻/工具芯片/`/learn` 并入）                                                |

## 事实回写

当时的平台、Canvas、流协议和 Artifact 决策已验收；当前仍有效的约束见[决策历史](../../09-decisions/decision-history.md)与现行 ADR。架构边界、数据骨架与协议事实已回写 README、技术报告与 `docs/02-architecture/`、`docs/04-data/`。
