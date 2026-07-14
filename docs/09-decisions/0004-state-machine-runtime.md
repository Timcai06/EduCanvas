# ADR-0004：教学状态机运行时设计

- 状态：`accepted`
- 日期：2026-07-14

## 背景

`docs/03-ai/agent-orchestration.md`（draft）定义了线性教学状态机 DIAGNOSE→EXPLAIN→DEMONSTRATE→PRACTICE→ASSESS→REMEDIATE/ADVANCE，但遗留了三个未决问题：

1. 真实对话是非线性的——学生会随时提问、跳题、打断，线性状态序列没有说明如何容纳；
2. 状态转移的决定权归属不明确：如果模型可以自由宣布转移，"确定性状态机约束教学"就会退化成提示词建议；
3. `packages/db` 中 `lesson_sessions.state` 的默认值 `'EXPLAIN'` 与文档起点 DIAGNOSE 矛盾，暴露出初始状态语义从未被明确。

## 候选方案

- **A. 对话级状态机**：每轮对话都触发状态评估，学生提问也可能改变状态。粒度过细，自由问答会频繁打断脊柱流程，且转移逻辑复杂度不可控；
- **B. 脊柱状态机 + 横切问答（本决定）**：状态机只管理课程推进的脊柱，自由问答是任何状态内都允许的横切能力，不产生转移；
- **C. 分层状态机（HSM）**：完整的父子状态嵌套。表达力最强，但阶段一没有需要嵌套的场景，先不引入该复杂度。

## 决定

1. **脊柱状态只有五个**：DIAGNOSE、EXPLAIN、DEMONSTRATE、PRACTICE、ASSESS。REMEDIATE 和 ADVANCE 不是状态，而是 ASSESS 的两个出口决策：REMEDIATE 是"带着误区标签转回 EXPLAIN 或 PRACTICE"，ADVANCE 是"结束当前知识点、推荐下一个"；
2. **自由问答是横切能力**：学生在任何状态内提问，模型直接回答，脊柱状态不变。学生主动跳题时使用**深度为 1 的中断栈**：暂存当前状态处理岔路，结束后恢复；不支持多层嵌套；
3. **转移权在 runtime，不在模型**：模型只能通过受控工具请求转移，或由工具结果（如 `gradeAnswer`）自动触发；runtime 用 guard 校验每次转移（例如 PRACTICE→ASSESS 要求本状态内已产生足够练习事件，ASSESS→ADVANCE 要求掌握度过阈值）。模型无法凭对话内容跳过任何环节；
4. **每个状态绑定工具白名单**：runtime 按当前状态限制可调用的工具集合，越权调用直接拒绝并记录；
5. **每次转移写入 `learning_events`**（`event_type: state_transition`，payload 含 from、to、触发原因和触发工具），支持回放和审计；
6. **初始状态由 runtime 显式决定**：会话创建时查询 `mastery_states`——该学生在本课程无掌握记录则进入 DIAGNOSE，有记录可直接进入 EXPLAIN。`lesson_sessions.state` 删除数据库默认值，强制创建代码显式写入，让"跳过诊断"成为显式决策而非默认值副作用。

## 原因

- 脊柱与问答分离后，"确定性约束教学正确性、模型负责表达"的架构原则有了可执行的机制，而不只是提示词约定；
- 转移权收归 runtime 使所有教学决策可测试、可审计，符合"所有模型调用和教学决策可追踪"的架构原则；
- 中断栈限制深度为 1 是刻意取舍：覆盖"岔开问一个问题再回来"的主流场景，避免嵌套状态管理的复杂度；
- 掌握度阈值等 guard 参数依赖掌握度算法选型（研究进行中），本 ADR 只固定机制，不固定数值。

## 后果

- `packages/db` 需要一次迁移：删除 `lesson_sessions.state` 的默认值；
- teaching-runtime 实现时需要：状态定义、guard 函数、状态×工具白名单矩阵、中断栈字段（`lesson_sessions` 后续增加 `interrupted_state` 列或等价设计，实现时定）；
- 状态机核心为纯逻辑，按测试规则必须在实现 PR 内附带单元测试；
- guard 的具体阈值在掌握度算法 ADR（ADR-0005）确定后补充。

## 验证方式

- 单元测试覆盖：全部合法转移、全部非法转移被拒绝、中断栈压入弹出、初始状态两个分支；
- 回放测试：从 `learning_events` 的 state_transition 序列能完整重建会话状态历史；
- 对抗测试：构造诱导模型跳过 PRACTICE 的对话，确认 runtime guard 拦截。
