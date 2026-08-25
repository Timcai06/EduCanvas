# 对象删除 Outbox 恢复与并发安全

- 任务线：`O 删除队列`
- 状态：`completed`
- 负责人：sky-k111
- 完成时间：2026-08-25
- 主要交付：PR #276

## 目标

将业务已归档/删除与对象存储物理删除之间的 Outbox 闭环收口，保证重复投递、
多 Worker 并发和 Worker 崩溃恢复时都不会产生二次破坏或丢失删除意图。

## 实际交付

- `claimBatch` 通过 `FOR UPDATE SKIP LOCKED` 与有界租约恢复保持单写者语义；
- `complete` / `fail` 要求当前 attempt 匹配，旧 Worker 不能推进已重新领取的行；
- 删除失败按 attempt 指数退避，达到上限后进入可发现的 `failed` 终态；
- `object_not_found` 按删除目标已达成处理，保持重复投递幂等；
- asset/avatar 使用资产存储根，artifact 使用产物存储根，未知类型 fail closed；
- `asset_video_keyframe` 与完整 source type 联合保持一致；
- Worker 只记录稳定失败码和 claim 元数据，不记录对象 key、真实路径、原始异常或堆栈。

## 验收证据

2026-08-25 在 `55d5a7a27a17e58b5cc54a0ae70213dc94367ed8` 基线上由 Codex 独立终审：

- `packages/db/src/object-deletion-outbox-repository.integration.test.ts`：16/16 通过；
- `packages/db/src/platform-artifact.integration.test.ts` 与
  `packages/db/src/asset-repository.integration.test.ts`：42/42 通过；
- `apps/worker/src/delete-object-outbox.integration.test.ts`：13/13 通过；
- `pnpm --dir apps/worker test`：28 个测试文件、167 项用例通过；
- DB 与 Worker TypeScript 类型检查通过；
- 代码审查未发现 CRITICAL 或 HIGH 级问题，结论 `APPROVE`。

PostgreSQL 集成测试使用显式隔离的 `educanvas_integration` 数据库；首次在受限沙箱内
因 localhost `EPERM` 无法连接，在同一基线上放开本机数据库访问后定向测试全部
通过；该现象归类为执行环境限制，不是代码失败。

## 边界与未完成项

本计划没有修改 Canvas、Agent Runtime、Gateway、语音、数据库 schema 或 migration，
也没有建立第二套删除调度。没有遗留阻塞性 O 线任务；新的对象类型如需纳入删除
闭环，应以新计划显式扩展 object kind、存储根路由和端到端证据。
