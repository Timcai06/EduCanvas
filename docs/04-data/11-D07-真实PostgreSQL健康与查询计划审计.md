# D07：真实 PostgreSQL 健康与查询计划审计

- 任务：`D 数据架构与扩展性收敛` → `D07`
- 状态：`PASS`
- 审计时间：2026-08-09（CST）
- 代码基线：`HEAD = origin/main = 075cbbb5f221cba7e32c1497b4da16a044d37f2b`
- shared live 物理数据库变更：`0`（隔离克隆按 head 迁移后已删除）
- Migration：`0`

## 1. Evidence Boundary

本轮审计对象是本机 Docker `educanvas-db` 中的开发数据库，不是生产库：

| 项目                   | 实测值                          | 证据含义                                |
| ---------------------- | ------------------------------- | --------------------------------------- |
| PostgreSQL             | 16.14 / aarch64 / pgvector 镜像 | 真实本地运行态                          |
| 数据库 / 角色          | `educanvas` / `educanvas`       | 本地开发配置                            |
| 服务状态               | healthy，连续运行约 34 小时     | 本地容器健康，不代表生产可用性          |
| public 表              | 67                              | 与 D00 的业务表基线一致                 |
| live migration records | 51（0000–0050）                 | live 落后仓库 head 0051–0053            |
| repository head        | 0053，共 54 条记录              | 由 migration chain / disposable DB 验证 |
| `stats_reset`          | `NULL`                          | 本轮不能给统计计数指定独立 reset 起点   |

因此证据严格拆为两条：

1. **live health**：只读审计当前 0050 开发库；
2. **head correctness**：从 live 创建本轮专用隔离克隆，依次应用仓库原始
   0051–0053 SQL；另由 migration governance、drizzle drift、fresh→head 与
   N-1→head 的 disposable 数据库证明 journal 驱动路径。

本轮没有对共享开发库执行 migrate、ANALYZE、VACUUM、DDL、DML，也没有打印正文、Prompt、Credential、对象 key 或活动 SQL。live 落后 head 是 **Watch**；在该库升级前不能把它当成当前应用 schema 的运行证据。

隔离克隆最终实测为 127 FK、237 CHECK、238 indexes、0 invalid index；D02
三条 FK 的 delete action 为 restrict / restrict / cascade，且
`assets_space_fk_idx` 与 D04 两个 identity unique 均存在。隔离克隆只用于
审计，完成后精确删除；它不替代 fresh migrator 对 journal 的验证。

## 2. 数据库级健康

采样时数据库总大小 46 MiB，`pg_stat_database` 为：

| 指标                    |                              值 | 结论                               |
| ----------------------- | ------------------------------: | ---------------------------------- |
| commit / rollback       |                 5,201,649 / 282 | rollback 无异常激增证据            |
| block cache hit         |                          99.97% | 当前本地负载 Healthy；不能外推生产 |
| temp files / bytes      |                           0 / 0 | 未观察到磁盘临时文件               |
| deadlocks / conflicts   |                           0 / 0 | 采样窗口无死锁或冲突               |
| invalid / unready index |                               0 | 索引 catalog 完整                  |
| public indexes          | 236（btree 234、GIN 1、HNSW 1） | 与 live 0050 基线一致              |

`gateway_operation_events` 是唯一显著大表：约 68,516 live rows、36 dead rows、30 MiB total，已发生 autovacuum/autoanalyze，状态 Healthy。其余业务表均小于 0.5 MiB。

## 3. 67 表统计盘点

全量 catalog 查询覆盖 67/67 public 表，字段为 `n_live_tup`、`n_dead_tup`、table/index/total size、`seq_scan`、`idx_scan`、last vacuum/analyze。主要非空表如下：

| 表                       | live / dead |   total |      seq / index scans | 结论                                 |
| ------------------------ | ----------: | ------: | ---------------------: | ------------------------------------ |
| gateway_operation_events | 68,516 / 36 |  30 MiB |            113 / 3,919 | Healthy                              |
| conversation_messages    |    390 / 63 | 488 KiB |          6,870 / 3,866 | Healthy；历史索引实际命中            |
| asset_versions           |      36 / 9 | 432 KiB |            590 / 3,043 | Healthy，样本很小                    |
| agent_operations         |    196 / 26 | 336 KiB | 1,277,978 / 11,491,284 | 计数受长期本地测试影响，不是生产负载 |
| model_runs               |    237 / 75 | 328 KiB |            583 / 1,201 | Healthy                              |
| turn_context_snapshots   |    194 / 12 | 296 KiB |              212 / 154 | Healthy                              |
| tool_calls               |     87 / 42 | 200 KiB |              479 / 410 | Healthy                              |
| artifact_versions        |      16 / 0 | 184 KiB |              150 / 527 | Healthy                              |
| conversations            |     65 / 47 | 136 KiB |  4,240,859 / 7,489,389 | Watch：dead 比例高但仅 56 KiB heap   |
| artifact_generation_jobs |     24 / 48 | 128 KiB |              911 / 304 | Watch：dead 比例高但仅 48 KiB heap   |
| operation_continuations  |       1 / 5 | 128 KiB |          4,253 / 8,236 | Watch：比例无规模意义                |
| spaces                   |     65 / 34 | 104 KiB |            5,988 / 193 | Watch：小表，当前无需手工 vacuum     |
| lesson_sessions          |      4 / 19 |  96 KiB |          1,797 / 4,920 | Watch：比例高但 heap 16 KiB          |
| assets                   |     36 / 44 |  64 KiB |          2,177 / 1,061 | Watch：live 尚无 0051 space FK/index |
| asset_processing_jobs    |     14 / 29 |  64 KiB |              269 / 131 | Watch：小表队列 churn                |
| object_deletion_outbox   |       2 / 4 |  64 KiB |              9 / 3,292 | Healthy；claim index 有实际命中      |
| notebook_memberships     |     65 / 10 |  48 KiB |          8,297 / 4,497 | Healthy，权限索引有实际命中          |

另外 50 张表从未触发 manual/auto analyze。它们绝大多数为空或只有个位数行；这是 PostgreSQL 阈值与开发库规模共同造成的 **Watch**，不是立即执行全库 `ANALYZE` 的理由。9 张表出现 `dead > live`，但 heap 均为 16–56 KiB，当前不存在可量化膨胀风险。

可复核全量查询：

```bash
rtk docker exec educanvas-db psql -X -U educanvas -d educanvas -c \
  "SELECT relname,n_live_tup,n_dead_tup,seq_scan,idx_scan,last_autovacuum,last_autoanalyze FROM pg_stat_user_tables WHERE schemaname='public' ORDER BY relname"
```

## 4. 连接与锁的三次采样

三次只读采样均只看聚合，不输出 query 文本：

| UTC 时间 | connections | active | idle in transaction | waiting | blocked | longest transaction |
| -------- | ----------: | -----: | ------------------: | ------: | ------: | ------------------: |
| 14:46:59 |           1 |      1 |                   0 |       0 |       0 |                 0 s |
| 14:50:47 |           1 |      1 |                   0 |       0 |       0 |                 0 s |
| 14:51:45 |           1 |      1 |                   0 |       0 |       0 |                 0 s |

`max_connections=100`；只观察到审计连接自身。锁仅为本次 catalog SELECT 的 AccessShare/virtual transaction lock，无 blocker。结论是短采样窗口 **Healthy**，但没有负载峰值或生产连接池证据，不能据此给生产容量结论。

## 5. Critical Query Inventory

| 域                  | 真实入口                                                                                | 关键 SQL 形状                                            | 现有索引                                                |
| ------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------- |
| Conversation recent | `conversation-platform-repository.ts#listAccessibleRecentPage`；Web conversations route | membership join；active；keyset `(last_activity_at,id)`  | membership user-active；conversation space/owner recent |
| Message history     | `platform-turn-repository.ts#listMessages`；general conversation restore                | conversation + operation；history order + role tie-break | `conversation_messages_history_idx` + operation PK      |
| Current turn        | `platform-turn-repository.ts#createOrGetTurn`                                           | conversation + kind + active status                      | conversation-created index                              |
| Operations          | gateway operation access / platform turn repository                                     | conversation-scoped ordered operations                   | `agent_operations_conversation_created_idx`             |
| Model runs          | `agent-model-run-repository.ts#listByOperation`                                         | operation identity + chronological order                 | `model_runs_agent_operation_idx`                        |
| Tool calls          | `agent-tool-call-repository.ts#listByOperation`                                         | operation identity + chronological order                 | `tool_calls_agent_operation_idx`                        |
| Reconciliation      | `tool-effect-reconciliation-repository.ts#get`                                          | effect + operation ownership + reconciliation            | effect/reconciliation PKs                               |
| Assets              | `asset-repository.ts#listAccessibleSpacePage`；Web/Gateway Canvas                       | space + non-tombstoned + keyset                          | head 有 `assets_space_fk_idx`；live 尚未应用            |
| Artifacts           | `platform-artifact-repository.ts#listSpaceArtifactsPage`                                | space + non-archived + optional kind + keyset            | space/status/updated index                              |
| Membership          | `notebook-access.ts#resolveNotebookAccess`                                              | `(notebook_id,user_id)` + active window                  | composite PK                                            |
| FTS                 | `knowledge-hybrid-retrieval.ts#lexicalRanking`                                          | frozen turn sources + document + tsquery                 | turn-source + document + GIN FTS                        |
| Hybrid/vector       | `knowledge-hybrid-retrieval.ts#vectorRanking`                                           | frozen sources + exact embedding identity/hash + cosine  | HNSW + document/identity btree                          |
| Processing jobs     | Graphile job → asset processing `beginAttempt`                                          | job PK claim；运维 backlog by status/time                | PK + status/created index                               |
| Deletion outbox     | `object-deletion-outbox-repository.ts#claimBatch`                                       | due pending or expired lease + ordered claim             | status/available/created/id                             |

这一清单区分了真实热路径与仅供审计的 ledger list port；“存在 Repository 方法”不自动等于已有产品调用量。

## 6. EXPLAIN (ANALYZE, BUFFERS)

14 个安全 SELECT 计划全部执行成功；总执行时间均低于 1 ms，RAG 两条为空语料计划不具备延迟代表性。

| 查询                       | 实际主要 plan                           | execution | buffers / sort   | 分类                                                                    |
| -------------------------- | --------------------------------------- | --------: | ---------------- | ----------------------------------------------------------------------- |
| recent conversations       | seq/hash join + 25 KiB quicksort        |  0.065 ms | 10 hits          | Watch：65 行小表选择合理；共享 membership 的全局 recent 未来需规模验证  |
| message history            | history bitmap index + 25 KiB sort      |  0.100 ms | 3 hits + 1 read  | Healthy                                                                 |
| current turn by id         | operation PK + small conversation join  |  0.050 ms | 4 hits           | Healthy for point lookup；active-turn scan 另列 Watch                   |
| operations by conversation | conversation index + 25 KiB sort        |  0.021 ms | 4 hits           | Healthy                                                                 |
| model runs by operation    | `model_runs_agent_operation_idx`        |  0.250 ms | 4 hits           | Healthy                                                                 |
| tool calls by operation    | operation index + 25 KiB sort           |  0.764 ms | 2 hits + 1 read  | Healthy                                                                 |
| effect reconciliation      | two PK index-only scans                 |  0.438 ms | 3 hits + 2 reads | Healthy                                                                 |
| assets by space            | seq scan + 25 KiB sort                  |  0.016 ms | 2 hits           | Watch：live 0050 缺 head 的 space index；36 行不能评价 head 大规模计划  |
| artifacts by space         | seq scan + 25 KiB sort                  |  0.019 ms | 2 hits           | Watch：24 行下合理；`status <>` 不能完全利用排序键                      |
| membership                 | seq scan + 25 KiB sort                  |  0.010 ms | 2 hits           | 实测模板不同于 point permission query；真实 point query 有 composite PK |
| FTS                        | turn-source index；后续 document bitmap |  0.023 ms | 8 hits           | Watch：空语料，不能证明 GIN/排名规模                                    |
| vector identity            | turn-source + document/identity indexes |  0.030 ms | 5 hits           | Watch：空语料，不能证明 HNSW post-filter 成本                           |
| processing backlog         | seq scan + 25 KiB sort                  |  0.013 ms | 1 hit            | Healthy at 14 rows；真实 worker 用 job PK claim                         |
| deletion candidates        | claim index BitmapOr + 25 KiB sort      |  0.027 ms | 3 hits           | Watch：expired lease 分支和 ORDER 未完全覆盖                            |

没有发生 external sort、temp spill、大估算偏差、长循环或明显 buffer amplification。顺序扫描均发生在 14–65 行的小表，不能据此新增索引。

在物理 0053 隔离克隆上又复跑四个最可能受 migration/索引影响的 Watch
查询：assets by space 0.028 ms、active current turn 0.019 ms、artifacts by
space 0.011 ms、deletion candidates 0.018 ms。planner 仍因 24–35 行规模选择
seq/bitmap + 25 KiB quicksort；这证明 head 没有计划退化，却仍不足以裁定生产
partial index。

## 7. Index Audit

| 类别             | 证据                                                                                          | 结论                                   |
| ---------------- | --------------------------------------------------------------------------------------------- | -------------------------------------- |
| FK protection    | D02 的 `assets_space_fk_idx` 在 head schema/0051 SQL；其它核心 FK 支撑索引由 D00/D02 台账覆盖 | head 完整；live 待升级                 |
| business query   | conversation/message/runtime/workspace/worker 索引均与主要过滤前缀对齐                        | Healthy + 4 个 Watch 候选              |
| unique invariant | live 67 PK + 82 非 PK unique，0 invalid/unready                                               | Healthy；head 另有 D04 identity unique |
| search           | GIN FTS + HNSW cosine 均存在且 valid                                                          | 结构 Healthy；真实语料计划 Watch       |
| infrastructure   | outbox claim、processing status、Graphile Worker 自有索引                                     | 当前小规模 Healthy                     |

117/236 live indexes 的 `idx_scan=0` 不构成删除证据。它们包含 PK、FK、unique、安全审计、搜索与低频恢复索引；本轮删除索引为 0。

需在生产级规模重新 EXPLAIN 的候选，不在 D07 直接实现：

1. membership-scoped recent conversation 的跨 space 全局排序；
2. active current turn 的 `conversation_id + kind/status` partial index；
3. active assets 的 `(space_id,created_at,id)` partial index；
4. non-archived artifacts 的稳定排序；
5. outbox pending/expired 两分支的 partial indexes；
6. turn-scoped embedding identity 对全局 HNSW 的 post-filter 选择性。

任何候选实施前仍需 production query inventory、代表性参数、write amplification、锁窗口和 rollback。

## 8. D06 输入处置

### 8.1 0051–0053 Estimated scale

| Migration | 本地证据复核                                                                    | 生产发布结论                                                                                                |
| --------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 0051      | live 仍有 36 assets、4 sessions、1 budget；记录的 1 个已审计 orphan 与 SQL 一致 | **Action Required before production rollout**：先跑三类 orphan preflight、表规模与索引/FK validation 锁窗口 |
| 0052      | data migration = 0；13 对 CHECK 作用于 11 表                                    | **Action Required before production rollout**：0 行改写不等于 0 scan/0 lock，需生产表规模与维护窗口         |
| 0053      | live 有 28 representations、14 jobs，和记录一致                                 | Watch：兼容 backfill 风险低，仍需生产两表规模与 unique build 窗口                                           |

这些是部署门禁，不伪装为已经采集的生产数字，也不阻塞本地 D 架构冻结。

### 8.2 0051 snapshot 元数据异常

- 0051 SQL 确实创建 `assets_space_fk_idx` 和三条 FK，并 validate；
- 0051 snapshot 漏记这些对象；
- 0052/0053 snapshot、当前 schema 与 0051 SQL 均包含正确对象及 delete action；
- 0050→0051 测试精确证明两条 restrict、一条 cascade 与索引；
- 历史 snapshot 已进入 main，按 D06 不可变纪律禁止回写。

最终处置是 **accepted immutable metadata anomaly**：

1. 不修改 0051 snapshot；
2. 不创建重复 ADD FK migration；
3. 以 0052+ snapshot 作为后续 metadata baseline；
4. fresh→head 测试新增 PostgreSQL catalog 显式断言，防止 anomaly 被错误继承为最终运行态。

## 9. Healthy / Watch / Action Required

### Healthy

- 67 public 表可访问，数据库 46 MiB，无 invalid/unready index；
- 三次采样无 blocker、idle-in-transaction、deadlock、temp spill；
- gateway event 大表已自动 vacuum/analyze，dead tuple 低；
- runtime ledger、message history、membership point access、effect reconciliation 与 worker status 索引存在且计划合理；
- 当前 head 的 fresh/N-1、drift 与历史不可变门禁可独立复现。

### Watch

- live 开发库落后 0051–0053，不能用于当前 head 的端到端运行证明；
- 多张小表 dead/live 比例高、50 张表从未 analyze，但绝对规模极小；
- recent conversation、active assets/artifacts、outbox expired lease 与 Hybrid post-filter 在生产级数据上可能出现排序或过滤放大；
- RAG live 语料为空，本轮只能证明 SQL/索引结构与空计划，不能证明召回延迟。

### Action Required

- 0051/0052/0053 上生产前必须在目标库执行只读规模/orphan/catalog preflight，并安排锁窗口；owner 为 release/operator；
- 生产或代表性预发数据可用后，必须重跑六个 Watch query plan，再决定是否新增索引；
- 共享开发库若要运行当前 head，必须走标准 `pnpm db:migrate` 流程升级，不允许手改；本轮未执行。

Action Required 均是明确的外部发布条件，不是已观察到的生产故障。

## 10. 对 D08 / UV / KM / PET / O 的输入

- D08：以本报告的 Evidence Boundary 和生产 rollout gate 冻结 Operations 结论；运行 fresh-head catalog 回归。
- UV：复用 Asset/Representation/Consent；上线前遵守 0051/0053 规模门禁。
- KM：新 Memory 表必须填写 Feature Data Contract；Hybrid 真实规模继续做 query-plan 验证。
- PET：继续优先 Preference，不新增 runtime ledger。
- O：outbox 双分支索引只保留 Watch，O03 的并发/恢复证据优先于猜测式加索引。

## 11. 验证命令

所有最终命令退出码为 0。健康、锁和 catalog 查询使用以下可复制的只读形状；
`pg_stat_activity` 只取计数，不输出活动 SQL：

```bash
rtk pnpm env:check
rtk docker compose ps
rtk docker exec educanvas-db psql -X -U educanvas -d educanvas -c \
  "SELECT datname,xact_commit,xact_rollback,blks_hit,blks_read,temp_files,temp_bytes,deadlocks,conflicts FROM pg_stat_database WHERE datname=current_database()"
rtk docker exec educanvas-db psql -X -U educanvas -d educanvas -c \
  "SELECT relname,n_live_tup,n_dead_tup,seq_scan,idx_scan,last_autovacuum,last_autoanalyze FROM pg_stat_user_tables WHERE schemaname='public' ORDER BY relname"
rtk docker exec educanvas-db psql -X -U educanvas -d educanvas -c \
  "SELECT state,count(*) FROM pg_stat_activity WHERE datname=current_database() GROUP BY state ORDER BY state"
rtk docker exec educanvas-db psql -X -U educanvas -d educanvas -c \
  "SELECT count(*) AS invalid_indexes FROM pg_index WHERE NOT indisvalid OR NOT indisready"
rtk pnpm --dir packages/db exec drizzle-kit check
rtk node tooling/quality/migration-records.mjs
rtk node tooling/quality/migration-governance.mjs origin/main HEAD
```

14 个 `EXPLAIN (ANALYZE, BUFFERS)` 均只执行 §5 对应 Repository 的 SELECT 形状，删除
`FOR UPDATE SKIP LOCKED` 等会写锁的子句；参数取本地已存在 ID，但不把 ID 或 SQL 正文写入
仓库。复跑者应从 §5 所列真实入口重新提取当前 SQL，以免复制一份会漂移的审计查询。

head 物理复核使用专用克隆，实际生命周期如下；仅允许对这个精确命名的临时库执行：

```bash
rtk docker exec educanvas-db createdb -U educanvas -T educanvas educanvas_d07_audit_20260809
rtk docker cp packages/db/drizzle/0051_blushing_legion.sql educanvas-db:/tmp/0051_blushing_legion.sql
rtk docker cp packages/db/drizzle/0052_illegal_iron_patriot.sql educanvas-db:/tmp/0052_illegal_iron_patriot.sql
rtk docker cp packages/db/drizzle/0053_silky_millenium_guard.sql educanvas-db:/tmp/0053_silky_millenium_guard.sql
rtk docker exec educanvas-db psql -X -v ON_ERROR_STOP=1 -U educanvas -d educanvas_d07_audit_20260809 -f /tmp/0051_blushing_legion.sql
rtk docker exec educanvas-db psql -X -v ON_ERROR_STOP=1 -U educanvas -d educanvas_d07_audit_20260809 -f /tmp/0052_illegal_iron_patriot.sql
rtk docker exec educanvas-db psql -X -v ON_ERROR_STOP=1 -U educanvas -d educanvas_d07_audit_20260809 -f /tmp/0053_silky_millenium_guard.sql
rtk docker exec educanvas-db dropdb -U educanvas educanvas_d07_audit_20260809
```

共享 live 数据库操作：Schema = 0、Migration = 0、业务数据写入 = 0；隔离克隆应用
0051–0053 后已删除；仓库历史 snapshot 修改 = 0。
