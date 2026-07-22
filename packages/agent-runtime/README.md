# @educanvas/agent-runtime

EduCanvas 的通用 Agent 运行时。它把已验证的 Asset 版本转换成供应商可消费的上下文，并在能力不足时明确失败；不包含课程、学生、掌握度、教学状态机、数据库或 Provider SDK。

当前已落地的通用能力：

- `buildAssetContext`：对已提取文本的文档建立有字符上限、带不可信边界声明的上下文；
- 不静默丢弃图片、音频或视频；当前模型不支持时返回稳定的模态错误；
- 为未来原生视觉、音频和视频 Provider 保留不可变 Asset 引用，而不暴露私有存储地址。
- `buildConversationContext`：从按时间排序的持久化消息中选择最新完整消息，执行消息数/字符双预算，并返回版本、消息 ID、遗漏数和字符计数供审计账本保存。
- `buildAgentContext`：统一选择Profile、Conversation、Source/Asset与Memory Segment，必需Profile超预算会失败，Tool Call/Result只成对保留，Memory未实现时显式返回unavailable；输出可直接交给Context Snapshot Ledger。
- `ToolKernel`：统一四类Adapter的五维能力交集、审批门、Schema、timeout/cancel、幂等和effect ledger；公开契约、策略、审批、执行控制、副作用结算和生命周期位于独立模块，顶层文件只保留兼容导出，避免安全边界重新长成单体。
- `TurnApplicationService`：唯一编排Context Snapshot、脱敏Model Run、`AgentLoopEngine`、Tool Kernel、Profile finalize、取消和消息终态；Model Run只在供应商流通过Runtime校验后结算，replay不会再次调用Provider。Gateway/Web入口仍按计划逐条迁移，不能把“服务已存在”解释为生产收敛完成。

Web 组合根已把 `buildConversationContext` 接入真实教学 Turn；选择结果以
`turn_context_snapshots` 原子写入 Turn 账本。摘要、Artifact 上下文、通用
Context的可信加载Adapter、三个生产入口和旧工具调用者替换仍会在现有K12纵切保持可用的前提下继续小步迁入本包。

运行时模块遵循语义拆分而非机械分片：单个 Tool Kernel 生产或测试模块超过
250 行会触发架构门禁；通用阈值是接近 400 行必须评审、超过 600 行必须给出不可拆理由
或先完成职责拆分。新的能力应进入拥有该不变量的模块，不应回填到兼容导出文件。
