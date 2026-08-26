# @educanvas/worker

EduCanvas 的持久任务 worker 进程（[ADR-0005](../../docs/09-decisions/0005-模块化单体产物与持久任务.md)）。与 Web 共享同一个 PostgreSQL 与全部 workspace 包，但独立进程运行——分钟级产物生成（导图/Slides/音频等）不能占用 HTTP 请求生命周期。

## 包职责

- 运行 graphile-worker，消费 `graphile_worker` 队列中的任务；
- 注册并执行任务处理器（`src/tasks/`，周期任务使用crontab兼容的`域:动作`命名，编译期显式白名单）；
- 不定义业务表结构（唯一入口仍是 `packages/db`），不直接暴露任何 HTTP 接口。

## 核心文件

- `src/index.ts`：进程入口，启动Graphile并在退出前flush/shutdown telemetry；
- `src/bootstrap.ts`：先加载workspace环境，再惰性加载并构造Telemetry与任务注册表；
- `src/process-lifecycle.ts`：接管终止信号，先停止Graphile Runner，再由进程入口flush/shutdown telemetry；
- `src/tasks/index.ts`：惰性任务注册表；
- `src/tasks/system-heartbeat.ts`：冒烟任务，验证入队→消费回路；
- `src/tasks/purge-anonymous-subjects.ts`：每日03:15 UTC清理超过保留窗口的匿名数据库主体；
- `src/tasks/ingest-knowledge-document.ts`：受控创建/复用Source并写入已解析资料版本；
  文档进入`ready`后按`job_key`入队一次向量化，摄取本身不因向量化失败而失败；
- `src/tasks/embed-knowledge-document.ts`：教材切块向量化。分批推进使进度单调向前，
  确定性Provider错误写终态失败、可重试错误交给队列；向量缺失只会让检索退回纯FTS
  （[ADR-0015](../../docs/09-decisions/0015-混合语义检索与向量身份边界.md)）；
- `src/tasks/process-video.ts`：视频来源派生。探测失败是整体失败，音轨转录与关键帧
  抽取各自独立成败——只要元数据拿到，版本就进入ready，两路各留自己的状态。ffmpeg /
  ffprobe只在本进程以固定argv数组spawn，带硬超时，临时目录无论成败都回收
  （[ADR-0016](../../docs/09-decisions/0016-视频来源派生与部分成功边界.md)）；
- `src/tasks/generate-artifact.ts`：结构化产物与媒体产物的任务路由入口；
- `src/tasks/audio-artifact-generation.ts`：音频对象写入、checkpoint 与版本提交；
- `src/tasks/image-artifact-generation.ts`：图像产物版本追加；只接受闭集尺寸与已裁剪
  提示词，Provider原始响应止步于Adapter，落库元数据不含objectKey、checksum与Prompt全文
  （[ADR-0014](../../docs/09-decisions/0014-图像生成能力与产物信任边界.md)）；
- `src/tasks/picturebook-generation.ts`：结构化模型编排 6–8 页，再复用图片 Gateway 逐页生成，最终只提交一个可完整回收的私有 bundle；
- `src/tasks/continue-operation.ts`：消费只含continuation UUID的审批续跑任务，重算当前Agent/Notebook/approval范围，在恢复的W3C active子span内维护generation lease、调用Adapter并提交continuation与Operation终态；
- `src/approval-continuation.integration.test.ts`：覆盖批准原子入队、队列隐私、Worker跨进程领取、终态原子性与Membership撤销后fail closed；
- `src/tasks/audio-overview-generation.ts`：把1–8项已验证来源压成受限脚本；
- `src/worker.integration.test.ts`：队列回路与 SQL 事务性入队的集成测试。

## 常用命令

```bash
make dev                 # 仓库根:同时启动 Web 与 worker
pnpm dev                 # 亦可:worker 会自行加载根 .env/.env.local(不覆盖已有环境)
pnpm --filter @educanvas/worker dev    # 只启动 worker
pnpm --filter @educanvas/worker build  # esbuild打包内部workspace源码，E2E会直接启动该bundle
make integration         # 含本包的 PostgreSQL 集成测试
```

## 入队方式

- 业务代码内(推荐):在 Drizzle 事务里执行 `select graphile_worker.add_job('任务名', payload)`,与业务写入原子提交;
- 任务 payload 是不可信输入,处理器内必须先过 Zod 校验。
- continuation任务不得携带正文、Prompt、工具参数、Credential、Secret或effect结果；真实恢复内容只允许由Adapter通过`resumeRef`读取自己拥有的耐久业务意图。
- continuation task遇到未过期lease必须抛出稳定重试错误，不能把Graphile job标成成功；取消请求由PostgreSQL传播，等待点立即取消，运行点在heartbeat或终态结算边界收敛为唯一`operation.cancelled`。

## 改动前必读

- [ADR-0005：模块化单体、Artifact 与持久任务](../../docs/09-decisions/0005-模块化单体产物与持久任务.md)：部署形态、表职责与信任分层；
- [Gemini + NotebookLM 结档记录](../../docs/plan/completed/2026-07-GeminiNotebookLM复刻.md)：持久 Artifact 与 Worker 的交付证据；
- [后端工程约定](../../docs/05-engineering/02-后端工程.md)。
