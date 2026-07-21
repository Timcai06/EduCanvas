# @educanvas/worker

EduCanvas 的持久任务 worker 进程（[ADR-0019](../../docs/09-decisions/0019-modular-monolith-artifacts-and-durable-jobs.md)）。与 Web 共享同一个 PostgreSQL 与全部 workspace 包，但独立进程运行——分钟级产物生成（导图/Slides/音频等）不能占用 HTTP 请求生命周期。

## 包职责

- 运行 graphile-worker，消费 `graphile_worker` 队列中的任务；
- 注册并执行任务处理器（`src/tasks/`，周期任务使用crontab兼容的`域:动作`命名，编译期显式白名单）；
- 不定义业务表结构（唯一入口仍是 `packages/db`），不直接暴露任何 HTTP 接口。

## 核心文件

- `src/index.ts`：进程入口，读取 `DATABASE_URL`、注册任务、优雅停机；
- `src/tasks/index.ts`：任务注册表；
- `src/tasks/system-heartbeat.ts`：冒烟任务，验证入队→消费回路；
- `src/tasks/purge-anonymous-subjects.ts`：每日03:15 UTC清理超过保留窗口的匿名数据库主体；
- `src/tasks/ingest-knowledge-document.ts`：受控创建/复用Source并写入已解析资料版本；
- `src/tasks/generate-artifact.ts`：结构化产物与音频概览生成；音频在对象写入后
  先保存checkpoint，重投时校验已有对象并继续提交版本，不重复调用TTS；
- `src/tasks/audio-overview-generation.ts`：把1–8项已验证来源压成受限脚本；
- `src/worker.integration.test.ts`：队列回路与 SQL 事务性入队的集成测试。

## 常用命令

```bash
make dev                 # 仓库根:同时启动 Web 与 worker
pnpm dev                 # 亦可:worker 会自行加载根 .env/.env.local(不覆盖已有环境)
pnpm --filter @educanvas/worker dev    # 只启动 worker
pnpm --filter @educanvas/worker build  # esbuild打包内部workspace源码
make integration         # 含本包的 PostgreSQL 集成测试
```

## 入队方式

- 业务代码内(推荐):在 Drizzle 事务里执行 `select graphile_worker.add_job('任务名', payload)`,与业务写入原子提交;
- 任务 payload 是不可信输入,处理器内必须先过 Zod 校验。

## 改动前必读

- [ADR-0019：模块化单体、Artifact 与持久任务](../../docs/09-decisions/0019-modular-monolith-artifacts-and-durable-jobs.md)：部署形态、表职责与信任分层；
- [Gemini + NotebookLM 结档记录](../../docs/plan/completed/2026-07-gemini-notebooklm-replica.md)：持久 Artifact 与 Worker 的交付证据；
- [后端工程约定](../../docs/05-engineering/backend.md)。
