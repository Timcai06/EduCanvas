# 架构决策记录

ADR用于记录影响多个模块、难以轻易撤销或需要团队统一遵守的决定。

## 状态

- `proposed`：提议中；
- `accepted`：已接受；
- `superseded`：被新ADR替代；
- `rejected`：已拒绝但保留原因。

## 当前ADR

- [0001：核心技术栈](0001-core-stack.md)
- [0002：受控教学Canvas](0002-controlled-canvas.md)
- [0003：阶段一单应用交付与Drizzle选型](0003-phase1-monorepo-and-drizzle.md)
- [0004：教学状态机运行时设计](0004-state-machine-runtime.md)
- [0005：掌握度建模与误区标注](0005-mastery-modeling.md)
- [0006：可信学习事件与服务端判分边界](0006-trusted-learning-events.md)
- [0007：真实教学Turn与Provider治理](0007-real-turn-and-provider-governance.md)
- [0008：消息、模型Trace与刷新恢复](0008-message-trace-and-refresh-recovery.md)
- [0009：通用全模态AI平台与K12垂直能力分层](0009-general-multimodal-platform-and-k12-vertical.md)
- [0010：Canvas分层信任模型](0010-canvas-trust-tiers.md)
- [0011：Answer阶段允许工具调用前导文本](0011-answer-phase-tool-preamble.md)

新ADR从[ADR模板](../templates/adr-template.md)复制，编号递增。已接受的ADR不直接改写结论；若决定改变，新增ADR并把旧ADR标记为`superseded`。
