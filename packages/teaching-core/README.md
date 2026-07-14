# @educanvas/teaching-core

## 这个包是什么

这是EduCanvas阶段一的纯教学领域核心，负责确定性状态机、掌握度计算、可信领域事件和外部依赖Port。它不依赖Next.js、Drizzle、模型供应商SDK、pgvector或Agent框架；Web、数据库、模型和检索只通过适配器接入。

## 核心文件导读

- `src/state-machine.ts`：五状态脊柱、转移guard和深度为1的中断栈；
- `src/mastery.ts`：PFA风格掌握度公式、ASSESS出口决策、误区标签和复习间隔；
- `src/domain-events.ts`：服务端可信领域事件的版本化strict Schema；
- `src/tools.ts`：受控教学工具名称和状态白名单；
- `src/ports.ts`：会话、事件、掌握度、模型和检索的依赖倒置接口；
- `src/index.ts`：包的唯一公共出口。

## 依赖方向

```text
apps/web或未来core-api
→ teaching-core
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

- [智能体编排](../../docs/03-ai/agent-orchestration.md)
- [掌握度与误区规格](../../docs/03-ai/mastery-and-misconceptions.md)
- [学习事件契约](../../docs/04-data/learning-event-contract.md)
- [ADR-0004：教学状态机](../../docs/09-decisions/0004-state-machine-runtime.md)
- [ADR-0005：掌握度模型](../../docs/09-decisions/0005-mastery-modeling.md)
- [ADR-0006：可信学习事件](../../docs/09-decisions/0006-trusted-learning-events.md)
