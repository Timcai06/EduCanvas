# @educanvas/db

## 这个包是什么

这是EduCanvas共享的PostgreSQL数据访问包，使用Drizzle定义阶段一表结构、生成迁移并提供惰性数据库客户端、仓储和领域Port适配器。PostgreSQL是业务事实源；这里的Schema必须与`docs/04-data`和迁移文件保持一致，不能为了页面方便复制一套临时数据结构。

## 核心文件导读

- `src/index.ts`：包的公共出口，统一导出数据库客户端、表定义、仓储和Drizzle适配器。
- `src/client.ts`：读取`DATABASE_URL`并惰性创建Drizzle客户端，避免构建阶段连接数据库。
- `src/schema.ts`：阶段一学习会话、对话/Model Run账本、Canvas产物、学习事件和掌握度表。
- `src/chat-repository.ts`与`src/model-run-repository.ts`：发送幂等、消息生命周期、历史cursor与Provider运行审计。
- `src/turn-ledger-repository.ts`与`src/turn-lease-repository.ts`：原子创建Turn账本、PostgreSQL窗口限流、heartbeat和过期收敛。
- `src/tool-call-repository.ts`：Provider tool call的双唯一幂等键、状态机和不含原值的脱敏摘要。
- `src/turn-safety-decision-repository.ts`：只保存稳定分类与版本的Turn安全决策审计；写入和读取都校验可信学生、Session与Turn归属。
- `src/asset-repository.ts`与`src/message-parts.ts`：通用Asset所有权、不可变版本、可物化内容和多Part消息的原子持久化。
- `src/anonymous-data-lifecycle.ts`：匿名合成主体7天保留期、中央subject-owned表注册表与逐主体幂等事务清理。
- `src/knowledge-source-repository.ts`：受控审核资料创建、hash幂等摄取、解析失败状态、不可变版本与chunk。
- `src/knowledge-retrieval-repository.ts`：课程范围绑定、Turn source版本冻结、PostgreSQL FTS候选白名单与服务端引用校验。
- `src/teaching-adapters.ts`：会话、掌握度、可信事件与事务Unit of Work的Drizzle实现。
- `src/artifact-repository.ts`：公开Artifact与私有判分键的原子保存和分级读取。
- `drizzle.config.ts`：Drizzle Kit读取Schema、连接本地数据库和输出迁移的位置。
- `drizzle/0000_careless_lady_bullseye.sql`：基线迁移；禁止手工改写已经共享的历史迁移。
- `drizzle/0001_light_the_initiative.sql`：Canvas公开题面与私有判分键分表迁移。
- `drizzle/0002_common_cerebro.sql`与`0003_wealthy_wildside.sql`：可信事件信封、答案分表、乐观锁和原子事件序号迁移。
- `drizzle/0004_nifty_spyke.sql`：最小对话/Model Run账本与历史session收敛。
- `drizzle/0005_exotic_starhawk.sql`：active Turn互斥、streaming lease和tool call脱敏审计。
- `drizzle/0006_windy_silver_sable.sql`：不含正文的Turn安全决策表、严格值域与审计索引。
- `drizzle/0007_ambiguous_silver_surfer.sql`：审核资料、generated `tsvector`/GIN、Turn检索快照、候选与引用审计。
- `drizzle/0008_k1_snapshot_integrity.sql`：强化K1快照与版本归属约束，保证快照完成后不可变并拒绝跨快照候选。
- `drizzle/0009_slow_shinobi_shaw.sql`：新增通用`assets / asset_versions / agent_message_parts`及其所有权、版本和消息引用约束。
- `drizzle/meta/`：Drizzle Kit的迁移快照与日志，生成迁移时同步更新。
- `tsconfig.json`：数据库包和Drizzle配置的TypeScript检查范围。

## 常用命令

以下命令都从仓库根目录执行：

```bash
pnpm db:up                              # 启动本地PostgreSQL + pgvector
pnpm --filter @educanvas/db lint        # 独立检查数据库包格式
pnpm --filter @educanvas/db typecheck   # 检查Schema和客户端类型
TEST_DATABASE_URL=postgresql://educanvas:educanvas@localhost:5432/educanvas_integration pnpm --filter @educanvas/db test:integration
pnpm db:generate                        # 根据src/schema.ts生成新迁移
pnpm db:migrate                         # 将待执行迁移应用到DATABASE_URL
pnpm build                              # 由Web生产构建验证数据库包可被消费
pnpm lint                               # 运行仓库现有lint任务
```

本包当前没有独立`dev`或`build`脚本；数据库开发以`pnpm db:up`启动依赖，真实集成测试必须显式提供隔离的`TEST_DATABASE_URL`，并会清空该数据库中的阶段一业务表，禁止指向开发共享库或生产库。不要手改数据库后再反向猜Schema，应先修改`src/schema.ts`，再生成和检查迁移。

匿名生命周期以整个规范`anon:v1:<sha256>`主体为删除单位：仅当其所有Session的`last_activity_at`都严格早于7天cutoff时，才在单个可串行化事务内按注册顺序删除；任何近期Session都会保留整个主体。PR-K1、PR-T1、PR-C1或后续工作一旦新增`student_id/session_id/turn_id/artifact_record_id`关联表，必须同时扩展`ANONYMOUS_DATA_LIFECYCLE_REGISTRY`和`assertAnonymousDataLifecycleRegistryCoverage`测试清单。共享课程/知识数据不得加入该注册表。

K1只支持服务端受控任务交付的纯文本/可解析PDF结果：数据库保存私有`object_key`而非公开URL；FTS使用PostgreSQL `simple`配置的generated `tsvector`与GIN，不引入pgvector。`knowledge_sources/documents/chunks`是共享课程资料，不随匿名学生清理；`session_source_bindings/turn_source_snapshots/turn_source_versions/retrieval_candidates/message_citations`属于匿名主体闭包。每个Turn都会先写入不可变的快照完成事实，即使结果为空也不会在后续绑定资料后改变；候选通过复合外键证明snapshot与chunk属于同一document。引用写入口只接受本轮持久化的`candidateId`，不接受浏览器声明的source/document/chunk。

## 当前接线状态

- 对话消息、Model Run、Turn ledger/lease、Tool Call和安全决策账本已由Web真实Turn链路使用；
- 通用Asset、不可变版本和消息Part已由Web上传、Turn请求与刷新恢复链路使用；私有存储键只在服务端物化；
- `DrizzleArtifactRepository`与`DrizzleTeachingUnitOfWork`已接入预置Canvas判分、可信事件和掌握度更新；
- K1审核资料、FTS、Turn快照、候选与引用防伪仓储已经接入Web生产工具、SSE引用事件和引用UI；
- T1数据Port与事务适配器已接入Web组合根；Canvas判分后仅在可信状态为`ASSESS`时调用状态推进服务，其他状态事件仍待接线；
- Artifact仓储支持公开投影与私有判分键分级持久化，当前产品纵切仍使用课程bootstrap预置Artifact，不代表Agent提议/生成链路已经完成。

> 验证状态：全部迁移已在真实PostgreSQL完成全新安装和含历史事件的升级验证；CI集成测试覆盖事务写入/回滚、乐观锁与并发幂等。执行迁移前仍应备份目标数据库；历史迁移不承诺自动向下回滚，回退与恢复方案必须在发布前单独演练。

## 改动前必读的 docs/ 文档

- [数据设计](../../docs/04-data/data-design.md)：业务事实源、实体、事件和掌握度约束。
- [后端工程](../../docs/05-engineering/backend.md)：数据库在阶段架构中的服务边界。
- [API约定](../../docs/05-engineering/api-conventions.md)：写入幂等、版本和错误返回要求。
- [安全与隐私](../../docs/06-quality/security-and-privacy.md)：未成年人数据最小化与审计要求。
- [ADR-0003](../../docs/09-decisions/0003-phase1-monorepo-and-drizzle.md)：阶段一选用Drizzle和Monorepo的原因。
