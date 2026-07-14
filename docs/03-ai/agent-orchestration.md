# 智能体编排

- 状态：`accepted`
- 相关决策：[ADR-0004](../09-decisions/0004-state-machine-runtime.md)

## 原则

不让框架替代领域设计。教学正确性由显式状态和规则保证，大模型负责自然语言、内容组织和受控工具选择。

## 三层结构

### 教学状态机（设计定稿见 ADR-0004）

**脊柱状态**只有五个，管理课程推进：

```text
DIAGNOSE → EXPLAIN → DEMONSTRATE → PRACTICE → ASSESS
```

- REMEDIATE 和 ADVANCE 不是状态，是 ASSESS 的出口决策：REMEDIATE 带着误区标签转回 EXPLAIN 或 PRACTICE；ADVANCE 结束当前知识点并推荐下一个；
- **自由问答是横切能力**：任何状态内学生提问，模型直接回答，脊柱状态不变；学生跳题使用深度为 1 的中断栈，处理完恢复原状态；
- **转移权在 runtime**：模型只能请求转移或由工具结果触发，runtime 用 guard 校验（练习量、掌握度阈值等）；
- **初始状态由 runtime 显式决定**：新学生进 DIAGNOSE，有掌握记录的学生可直接进 EXPLAIN，数据库不设默认值；
- 每次转移写入 `learning_events`（`event_type: state_transition`），可回放可审计。

### Agent Tool Loop

初始工具：

- `retrieveKnowledge`
- `getStudentState`
- `renderCanvas`
- `generateQuiz`
- `gradeAnswer`
- `requestHint`
- `updateMisconception`
- `recommendNextNode`

工具必须有Schema校验、权限、超时、幂等、限流和审计。**每个脊柱状态绑定工具白名单**，runtime 按当前状态限制可调用集合，越权调用直接拒绝并记录。

阶段一白名单由`packages/teaching-core/src/tools.ts`维护：

| 状态 | 允许工具 |
|---|---|
| `DIAGNOSE` | `retrieveKnowledge`、`getStudentState`、`generateQuiz`、`gradeAnswer`、`requestHint`、`updateMisconception` |
| `EXPLAIN` | `retrieveKnowledge`、`getStudentState`、`renderCanvas`、`requestHint` |
| `DEMONSTRATE` | `retrieveKnowledge`、`getStudentState`、`renderCanvas`、`requestHint` |
| `PRACTICE` | `retrieveKnowledge`、`getStudentState`、`renderCanvas`、`generateQuiz`、`gradeAnswer`、`requestHint`、`updateMisconception` |
| `ASSESS` | `getStudentState`、`generateQuiz`、`gradeAnswer`、`requestHint`、`updateMisconception`、`recommendNextNode` |

工具获准不等于结果自动可信：`gradeAnswer`仍需服务端答案判定，状态转移仍需guard，掌握度仍只消费可信领域事件。

### 持久工作流

Temporal负责教材处理、批量生成、学习报告、定时任务和Embedding迁移等长流程。按 ADR-0003，阶段一不引入。

## 框架边界

- LangChain不作为核心依赖；
- LangGraph只在复杂内容生产、人工审核或多分支工作流中按需使用；
- AI SDK可用于Web流式消息和类型化工具；
- 领域状态保存在自己的数据库和代码中，不保存在第三方Agent框架内部。

## 开放问题

- PRACTICE进入ASSESS所需的最少练习证据量由课程配置提供，待猫狗课程规格确定；
- 中断栈的持久化字段设计（`lesson_sessions` 增列或独立表），随数据库适配器实现定。
