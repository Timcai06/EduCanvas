# @educanvas/teaching-runtime

## 这个包是什么

EduCanvas 的教学应用层：在 `@educanvas/canvas-protocol` 与 `@educanvas/teaching-core` 领域规则之间编排用例，并通过 Port 访问外部能力。它不依赖 Drizzle、Next.js 或模型供应商 SDK；Web 组合根负责认证、会话归属校验、HTTP/SSE、持久化适配器和真实 Provider 注入。

## 当前实现

- `src/grade-submission.ts`：`GradeCanvasSubmissionService` 将不可信 Canvas 提交经私有判分键验证后提升为 `assessment_graded`，并在同一事务更新掌握度；
- `src/state-transition.ts`：`ProgressTeachingStateService` 从可信候选信号、事件历史、课程策略和掌握度决定合法状态转移或 ASSESS 出口，并以幂等可信事件提交；
- `src/tool-executor.ts`：`TeachingToolExecutor` 按“权威状态策略 ∩ 已注册能力 ∩ 模型暴露级别”筛选工具，执行 Schema、超时、幂等、写批次隔离和脱敏审计；
- `src/turn-orchestrator.ts`：`TeachingTurnOrchestrator` 执行两阶段 `answer -> tools -> synthesis` 流式轮次；无工具时单次回答，有工具时只使用服务端验证结果进行第二次合成；
- `src/teaching-safety.ts`：K12 系统策略与流式输出安全 Gate；
- `src/observability.ts`：稳定教学指标名称与观测 Port；
- `src/testing/scripted-model-gateway.ts`：仅供单元测试和开发 Harness 使用的确定性替身，不是生产 Provider；
- `src/index.ts`：包公共出口；
- `src/*.test.ts`：内存 Fake 和契约测试，不替代 PostgreSQL 集成测试或真实 Provider smoke。

## 已接线与未接线

`apps/web` 已将 `TeachingTurnOrchestrator` 接入真实 OpenAI-compatible Gateway、EduCanvas SSE、消息/Model Run/Tool Call/Safety 账本和生产 `getStudentState` 工具。因此旧的“没有真实供应商、二次合成或浏览器 SSE”描述已经失效；这些基础设施由 Web 和 DB 包提供，而不是本包自己实现。

仍需保持以下边界：

- 当前生产工具只有 `getStudentState`；K1 检索仓储虽已完成，但 `retrieveKnowledge` 尚未注册到 Web 生产工具集合；
- `ProgressTeachingStateService` 已实现并有测试，但尚未接到 Web 的 Canvas 判分后流程；Turn Orchestrator 本身仍显式返回 `STAY`，不允许模型直接推进状态；
- Artifact 提议、确认和独立生成用例尚未实现；
- 本包不直接写数据库，也不代表真实 Provider 已完成 live smoke 或整节课闭环 E2E。

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
