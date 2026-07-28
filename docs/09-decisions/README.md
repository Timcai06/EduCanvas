# 架构决策记录

ADR 只保存当前仍约束系统的少量重大决定。失效实现细节不继续以 `accepted` ADR 堆叠；影响当前理解的演进结论压缩进入[关键决策历史](decision-history.md)，完整证据由 Git 与已完成计划保留。

## 状态

- `proposed`：仍需项目负责人确认；
- `accepted`：当前实现与文档必须遵守；
- `historical`：只解释演进，不约束新实现。

## 当前决策

- [0001：以教育能力为核心的通用个人 Agent 平台](0001-education-centered-personal-agent-platform.md)
- [0002：Gateway、客户端、渠道与能力节点](0002-gateway-clients-channels-and-nodes.md)
- [0003：统一 Agent Runtime 与 Notebook 上下文](0003-unified-runtime-and-notebook-context.md)
- [0004：能力授权、Artifact 信任与学习证据](0004-capability-trust-and-learning-evidence.md)
- [0005：模块化单体、Artifact 与持久任务](0005-modular-monolith-artifacts-and-durable-jobs.md)
- [0006：MCP 高风险意图与恢复边界](0006-MCP高风险意图与恢复边界.md)
- [0007：学习者画像与学习计划可信边界](0007-学习者画像与学习计划可信边界.md)
- [0008：Web 账号身份与会话边界](0008-Web账号身份与会话边界.md)
- [0009：统一 Canvas 工作面与运行时分层](0009-统一Canvas工作面与运行时分层.md)
- [0010：资产解析异步化与解析器归位](0010-资产解析异步化与解析器归位.md)
- [0011：K12 学习产物与平台长期 Artifact 桥接](0011-k12-learning-artifact-platform-bridge.md)
- [0012：个人 Agent 基数与模板市场边界](0012-个人Agent基数与模板市场边界.md)
- [0013：K12 消息渐进迁移与双轨退役边界](0013-K12消息渐进迁移与双轨退役边界.md)
- [0014：图像生成能力与产物信任边界](0014-图像生成能力与产物信任边界.md)
- [0015：混合语义检索与向量身份边界](0015-混合语义检索与向量身份边界.md)
- [0016：视频来源派生与部分成功边界](0016-视频来源派生与部分成功边界.md)
- [0017：文本与视觉 Provider 分离与图片输入路由](0017-文本与视觉Provider分离与图片输入路由.md)
- [0018：实时语音输入选型与流式识别边界](0018-实时语音输入选型与流式识别边界.md)（提案，尚未 accepted）

## 历史

- [关键决策历史](decision-history.md)

新增 ADR 从[模板](../templates/adr-template.md)开始。当前决定改变时，先把仍有效的约束写入替代 ADR，再把旧文件压缩进历史并删除，避免旧结论继续被误读为现状。

2026-07-27 起，现行 ADR 从 `0001` 连续编号；此前 Git 历史中的编号不再作为
canonical 引用。后续编号只递增、不复用。
