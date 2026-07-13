# @educanvas/db

## 这个包是什么

这是EduCanvas共享的PostgreSQL数据访问包，使用Drizzle定义阶段一表结构、生成迁移并提供惰性数据库客户端。PostgreSQL是业务事实源；这里的Schema必须与`doc/04-data`和迁移文件保持一致，不能为了页面方便复制一套临时数据结构。

## 核心文件导读

- `src/index.ts`：包的公共出口，统一导出数据库客户端与表定义。
- `src/client.ts`：读取`DATABASE_URL`并惰性创建Drizzle客户端，避免构建阶段连接数据库。
- `src/schema.ts`：阶段一学习会话、Canvas产物、学习事件和掌握度表。
- `drizzle.config.ts`：Drizzle Kit读取Schema、连接本地数据库和输出迁移的位置。
- `drizzle/0000_careless_lady_bullseye.sql`：当前基线迁移；禁止手工改写已经共享的历史迁移。
- `drizzle/meta/`：Drizzle Kit的迁移快照与日志，生成迁移时同步更新。
- `tsconfig.json`：数据库包和Drizzle配置的TypeScript检查范围。

## 常用命令

以下命令都从仓库根目录执行：

```bash
pnpm db:up                              # 启动本地PostgreSQL + pgvector
pnpm --filter @educanvas/db typecheck   # 检查Schema和客户端类型
pnpm db:generate                        # 根据src/schema.ts生成新迁移
pnpm db:migrate                         # 将待执行迁移应用到DATABASE_URL
pnpm build                              # 由Web生产构建验证数据库包可被消费
pnpm lint                               # 运行仓库现有lint任务
```

本包当前没有独立`dev`、`lint`或`build`脚本；数据库开发以`pnpm db:up`启动依赖，`pnpm lint`目前不会单独扫描本包源码。不要手改数据库后再反向猜Schema，应先修改`src/schema.ts`，再生成和检查迁移。

## 改动前必读的doc/文档

- [数据设计](../../doc/04-data/data-design.md)：业务事实源、实体、事件和掌握度约束。
- [后端工程](../../doc/05-engineering/backend.md)：数据库在阶段架构中的服务边界。
- [API约定](../../doc/05-engineering/api-conventions.md)：写入幂等、版本和错误返回要求。
- [安全与隐私](../../doc/06-quality/security-and-privacy.md)：未成年人数据最小化与审计要求。
- [ADR-0003](../../doc/09-decisions/0003-phase1-monorepo-and-drizzle.md)：阶段一选用Drizzle和Monorepo的原因。
