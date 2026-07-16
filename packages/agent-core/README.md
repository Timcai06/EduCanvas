# @educanvas/agent-core

EduCanvas 通用 Agent 领域契约包。它定义供应商无关的模型消息、流式事件、运行元数据和 Gateway Port，不包含 K12 课程、教学状态、掌握度、数据库、Web 或供应商 SDK。

## 当前边界

- `agent.turn` 是通用对话任务别名；`teaching.turn` 作为 K12 垂直任务别名在迁移期继续受支持；
- `artifact.generate` 与 `retrieval.query_rewrite` 只能走结构化生成入口；
- Provider 原始 chunk、错误正文、API Key 与推理内容不能进入本包契约；
- `@educanvas/teaching-core` 暂时兼容导出这些类型，调用方应逐步直接依赖本包；
- 工具注册、Asset、Artifact 和 Agent Profile 将在真实应用纵切到来时增量加入，不一次性复制未来数据模型。

## 验证

```bash
pnpm --filter @educanvas/agent-core test
pnpm --filter @educanvas/agent-core typecheck
```
