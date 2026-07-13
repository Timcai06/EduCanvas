# ADR-0003：阶段一单应用交付与Drizzle选型

- 状态：`accepted`
- 日期：2026-07-13

## 背景

ADR-0001确定核心后端与Next.js分离（主选NestJS + Fastify），同时指出"可以从同一Monorepo逐步拆分"。竞赛阶段一的首要风险是闭环无法按时跑通，而不是扩容能力不足。`doc/05-engineering/backend.md`还遗留了数据访问层在Kysely与Drizzle之间的待定项。

## 决定

1. 阶段一采用pnpm + Turborepo Monorepo，只有一个应用`apps/web`（Next.js），业务逻辑放在独立的workspace包中（`packages/canvas-protocol`、`packages/db`），不通过Next.js私有目录耦合；
2. NestJS core-api推迟到阶段二再引入。届时`packages/*`直接被新服务复用，Next.js回归Web与BFF职责；
3. 数据访问层确定为Drizzle：Schema用TypeScript定义、迁移工具内置、pgvector支持完善、与Zod协作顺畅；
4. Redis、Temporal、Python Worker、Kafka等基础设施按ADR-0001保留在架构中，但都不在阶段一引入。

## 原因

三人团队在竞赛周期内，先用最短路径验证受控Canvas协议与教学闭环。包边界从第一天保持干净，后续拆分服务是搬移而非重写，不违背ADR-0001的最终架构。

## 后果

- 阶段一的API暂由Next.js Route Handler承载，`/api/v1`约定与错误结构仍按`doc/05-engineering/api-conventions.md`执行；
- 阶段二拆分core-api时需要一次接口迁移，届时补充新的ADR记录拆分边界；
- `doc/05-engineering/backend.md`的数据访问待定项由本ADR关闭。
