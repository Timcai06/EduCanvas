# 智能体编排

- 状态：`draft`

## 原则

不让框架替代领域设计。教学正确性由显式状态和规则保证，大模型负责自然语言、内容组织和受控工具选择。

## 三层结构

### 教学状态机

```text
DIAGNOSE
→ EXPLAIN
→ DEMONSTRATE
→ PRACTICE
→ ASSESS
→ REMEDIATE或ADVANCE
```

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

工具必须有Schema校验、权限、超时、幂等、限流和审计。

### 持久工作流

Temporal负责教材处理、批量生成、学习报告、定时任务和Embedding迁移等长流程。

## 框架边界

- LangChain不作为核心依赖；
- LangGraph只在复杂内容生产、人工审核或多分支工作流中按需使用；
- AI SDK可用于Web流式消息和类型化工具；
- 领域状态保存在自己的数据库和代码中，不保存在第三方Agent框架内部。

