# @educanvas/agent-core

EduCanvas 通用 Agent 领域契约包。它定义供应商无关的全模态资产、消息 Part、模型消息、流式事件、运行元数据和 Gateway Port，不包含 K12 课程、教学状态、掌握度、数据库、Web 或供应商 SDK。

## 当前边界

- `agent.turn` 是通用对话任务别名；`teaching.turn` 作为 K12 垂直任务别名在迁移期继续受支持；
- `artifact.generate` 与 `retrieval.query_rewrite` 只能走结构化生成入口；
- 图片、音频、视频、文档、数据和链接统一建模为带不可变版本的 Asset；
- 文本、Asset 引用和生成 Artifact 可以组合为一条多 Part 对话消息；
- Provider 原始 chunk、错误正文、API Key 与推理内容不能进入本包契约；
- `@educanvas/teaching-core` 暂时兼容导出这些类型，调用方应逐步直接依赖本包；
- 工具注册、Artifact 运行时和 Agent Profile 将按真实应用纵切增量加入，不一次性复制未来数据模型。

公共资产契约不携带对象存储地址、供应商文件 ID 或课程字段。当前Web/DB/`@educanvas/agent-runtime`已经接通匿名PDF/图片上传、所有权、不可变版本、PDF解析与文本上下文物化；图片原生输入仍取决于Provider能力，不支持时必须明确失败，不能仅凭Asset引用宣称模型已经理解媒体内容。

## 验证

```bash
pnpm --filter @educanvas/agent-core test
pnpm --filter @educanvas/agent-core typecheck
```
