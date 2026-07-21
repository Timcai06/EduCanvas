# @educanvas/teaching-core

## 这个包是什么

这是EduCanvas阶段一的纯教学领域核心，负责确定性状态机、掌握度计算、可信领域事件和外部依赖Port。它不依赖Next.js、Drizzle、模型供应商SDK、pgvector或Agent框架；Web、数据库、模型和检索只通过适配器接入。

## 核心文件导读

- `src/state-machine.ts`：五状态脊柱、转移guard和深度为1的中断栈；
- `src/mastery.ts`：PFA风格掌握度公式、ASSESS出口决策、误区标签和复习间隔；
- `src/domain-events.ts`：服务端可信领域事件的版本化strict Schema；
- `src/learning-projection.ts`：从可信事件回放学习投影，并按课程配置推荐下一知识节点；
- `src/tools.ts`：受控教学工具名称和状态白名单；
- `src/model-contracts.ts`：迁移期兼容出口；通用模型、流式事件与Gateway契约已归属`@educanvas/agent-core`；
- `src/safety-policy.ts`：K12输入/输出安全策略、稳定分类和公开拦截响应；
- `src/ports.ts`：会话、事件、掌握度、模型和检索的依赖倒置接口；
- `src/index.ts`：包的唯一公共出口。

## 当前实现边界

- 状态机、ASSESS出口、掌握度、误区、可信事件、回放和下一节点推荐已经实现为纯领域逻辑；
- `KnowledgeRetriever`与`TeachingUnitOfWork`是K12 Port；`TurnModelGateway`来自`@educanvas/agent-core`并由本包兼容导出；具体Drizzle、Provider和检索实现位于外层包；
- T1 状态推进应用服务已在 `@educanvas/teaching-runtime` 实现，并由 Web 在可信 `ASSESS` Canvas 判分后调用；其余节点事件仍需外层逐项接线；
- K1 PostgreSQL FTS 仓储已由 Web 注入生产 `retrieveKnowledge` 工具，引用仍由外层候选白名单和数据库约束验证；
- 本包不会自动运行 Agent、写数据库、发送 SSE 或渲染 Canvas，也不允许模型文本直接成为可信状态事实。

## 依赖方向

```text
apps/web或未来core-api
→ agent-core
→ teaching-core（K12垂直领域）
→ Port接口
← Drizzle / 模型供应商 / RAG适配器
```

适配器可以依赖本包，本包不能反向依赖适配器。状态转移、判分、掌握度和事件提升规则不得复制到Route Handler或数据库查询中。状态或掌握度投影与对应可信事件必须通过`TeachingUnitOfWork`在同一事务中提交。

## 常用命令

从仓库根目录执行：

```bash
pnpm --filter @educanvas/teaching-core test
pnpm --filter @educanvas/teaching-core typecheck
pnpm test
pnpm typecheck
```

## 改动前必读

- [Agent 编排边界](../../docs/03-ai/01-Agent编排边界.md)
- [掌握度与误区规格](../../docs/03-ai/mastery-and-misconceptions.md)
- [学习事件契约](../../docs/04-data/learning-event-contract.md)
- [ADR-0017：统一 Agent Runtime 与 Notebook 上下文](../../docs/09-decisions/0017-unified-runtime-and-notebook-context.md)
- [ADR-0018：能力授权、Artifact 信任与学习证据](../../docs/09-decisions/0018-capability-trust-and-learning-evidence.md)
- [关键决策历史](../../docs/09-decisions/decision-history.md)
