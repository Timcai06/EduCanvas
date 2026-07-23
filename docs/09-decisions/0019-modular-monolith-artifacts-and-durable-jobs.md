# ADR-0019：模块化单体、Artifact 与持久任务

- 状态：`accepted`
- 日期：2026-07-19
- 决策人：项目负责人

## 背景

现有代码已经验证 Next.js Web、PostgreSQL、Drizzle、graphile-worker、对象存储 Port 和 Workspace Package。Gateway-first 方向会增加新的逻辑边界，但没有负载或团队发布证据要求立即改成微服务。

## 决定

1. 当前继续采用 pnpm/Turborepo 模块化单体，PostgreSQL 是业务事实源，Drizzle 管理 Schema 与迁移。
2. Web、Gateway、Worker 可以是同一 Monorepo 中的不同进程或部署入口；“模块化单体”不再等同于只有一个 `apps/web` 进程。
3. 只有连接规模、故障隔离、独立扩容、权限隔离或团队发布边界形成可测需求时才拆服务。
4. Artifact 是一等公民，拥有归属、类型、信任层、不可变版本、生成来源和任务状态；Studio 是其用户投影。
5. 分钟级 Artifact、解析、OCR、音频和维护工作进入 PostgreSQL 背书的 graphile-worker；业务写入与入队保持事务一致。
6. 二进制进入对象存储，PostgreSQL 只保存引用、校验和和可审计元数据。
7. Provider SDK 与供应商原始事件限制在 Adapter；业务使用稳定 Task/Model Alias 和归一化错误。

## 后果

- Gateway 可以先以新进程或现有部署中的独立模块落地，物理形态由后续部署决策决定；
- 不引入 Redis、Temporal、Kafka 或 Kubernetes 作为架构完成度指标；
- 长任务不绑定 Web、TUI 或渠道连接的生命周期；
- Artifact 与 Worker 的现有实现继续作为有效基线。

## 验证方式

- 依赖测试保证 Core/Runtime 不导入 Web 或具体 Provider SDK；
- 事务回滚时任务不入队，提交时 Worker 可恢复消费；
- Worker 重启不重复产生已提交 Artifact 版本；
- 对象存储引用与校验和一致，浏览器和渠道拿不到私有存储键。
