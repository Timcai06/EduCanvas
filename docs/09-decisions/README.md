# 架构决策记录

ADR 只保存当前仍约束系统的少量重大决定。失效实现细节不继续以 `accepted` ADR 堆叠；影响当前理解的演进结论压缩进入[关键决策历史](decision-history.md)，完整证据由 Git 与已完成计划保留。

## 状态

- `proposed`：仍需项目负责人确认；
- `accepted`：当前实现与文档必须遵守；
- `historical`：只解释演进，不约束新实现。

## 当前决策

- [0015：以教育能力为核心的通用个人 Agent 平台](0015-education-centered-personal-agent-platform.md)
- [0016：Gateway、客户端、渠道与能力节点](0016-gateway-clients-channels-and-nodes.md)
- [0017：统一 Agent Runtime 与 Notebook 上下文](0017-unified-runtime-and-notebook-context.md)
- [0018：能力授权、Artifact 信任与学习证据](0018-capability-trust-and-learning-evidence.md)
- [0019：模块化单体、Artifact 与持久任务](0019-modular-monolith-artifacts-and-durable-jobs.md)

## 历史

- [关键决策历史](decision-history.md)

新增 ADR 从[模板](../templates/adr-template.md)开始。当前决定改变时，先把仍有效的约束写入替代 ADR，再把旧文件压缩进历史并删除，避免旧结论继续被误读为现状。
