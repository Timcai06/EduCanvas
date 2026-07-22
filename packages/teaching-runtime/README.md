# @educanvas/teaching-runtime

## 这个包是什么

EduCanvas 的 K12 教学应用层：在 `@educanvas/agent-core` 通用模型契约、`@educanvas/canvas-protocol` Artifact 协议与 `@educanvas/teaching-core` 教学领域规则之间编排用例。它不依赖 Drizzle、Next.js 或模型供应商 SDK；Web 组合根负责认证、会话归属校验、HTTP/SSE、持久化适配器和真实 Provider 注入。

## 当前实现

- `src/grade-submission.ts`：`GradeCanvasSubmissionService` 将不可信 Canvas 提交经私有判分键验证后提升为 `assessment_graded`，并在同一事务更新掌握度；
- `src/state-transition.ts`：`ProgressTeachingStateService` 从可信候选信号、事件历史、课程策略和掌握度决定合法状态转移或 ASSESS 出口，并以幂等可信事件提交；
- `src/teaching-tool.ts`：只定义教学 Tool 的 Schema、handler 与可信上下文契约，不执行生命周期；
- `src/tool-kernel-adapter.ts`：把Teaching Tool适配到统一`ToolKernel`；教学Profile上下文必须先通过Schema，状态白名单由Kernel的Profile能力集表达；
- `src/teaching-prompt.ts`：为统一 Turn Application 提供教育 Profile 的纯 Prompt，不创建模型循环；
- `src/teaching-safety.ts`：K12 系统策略与流式输出安全 Gate；
- `src/observability.ts`：稳定教学指标名称与观测 Port；
- `src/testing/scripted-model-gateway.ts`：仅供单元测试和开发 Harness 使用的确定性替身，不是生产 Provider；
- `src/index.ts`：包公共出口；
- `src/*.test.ts`：内存 Fake 和契约测试，不替代 PostgreSQL 集成测试或真实 Provider smoke。

## 已接线与未接线

`apps/web` 已把教学Profile接入唯一`TurnApplicationService`、真实 OpenAI-compatible Gateway、EduCanvas SSE、统一Operation/Model Run/Tool Call/Context账本、K12消息与安全账本，以及生产`getStudentState`/`retrieveKnowledge`工具。真实DeepSeek的answer、两项工具与synthesis纵切已经通过；这些基础设施由`agent-runtime`、Web和DB包提供，而不是本包自己实现。

仍需保持以下边界：

- 当前生产工具包括 `getStudentState` 与只读 `retrieveKnowledge`；后者由Web组合根注入PostgreSQL FTS，并只返回本轮持久化候选；
- `ProgressTeachingStateService` 已接到 Web 的 Canvas 判分后流程，但仅在可信当前状态为 `ASSESS` 时消费服务端判分事件；教学Profile不允许模型直接推进状态；
- Artifact 提议、确认和独立生成用例尚未实现；
- 历史消息、Asset/Source上下文与候选引用已接通，但摘要与引用 claim/span 对齐尚未实现；
- 本包不直接写数据库；真实Provider smoke只证明基础纵切，不代表整节课教育质量已经验收；
- 旧 `TeachingToolExecutor` 和 `TeachingTurnOrchestrator` 已删除；模型循环、Tool 生命周期和失败语义只有统一 Runtime 一份实现。

## 常用命令

从仓库根目录执行：

```bash
pnpm --filter @educanvas/teaching-runtime test
pnpm --filter @educanvas/teaching-runtime typecheck
pnpm test
pnpm typecheck
```

## 改动边界

- 领域公式、状态机、学习投影和事件 Schema 留在 `@educanvas/teaching-core`；
- Artifact 输入、公开投影和私有判分协议留在 `@educanvas/canvas-protocol`；
- Drizzle 实现与账本留在 `@educanvas/db`；
- 认证、HTTP/SSE、真实 Provider 配置和依赖注入留在 `apps/web` 服务端边界。
