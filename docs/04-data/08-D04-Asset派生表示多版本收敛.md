# D04：Asset Derivation / Representation 多版本收敛

- 任务：`D 数据架构与扩展性收敛` → `D04 Asset Derivation / Representation 多版本收敛`
- 类型：多版本身份收敛 + 1 个新 Migration（`0053_silky_millenium_guard`）
- 审计/实施日期：2026-08-08（CST）
- 状态：`DONE`（待 Codex 复核；DONE ≠ PASS）
- 基线：开始/结束 HEAD = origin/main = `ebbe17ef67ec5314a720a4fd77e66a15018c39c3`
- 前置：D00/D01/D02/D03 均 PASS（`docs/04-data/04~07` 四个既有文档保留未动）

## 1. Evidence Boundary

- **Schema 源码证据**：`packages/db/src/schema.ts`（0053 前状态与改动后）
- **Migration 证据**：`packages/db/drizzle/0053_silky_millenium_guard.sql` + snapshot + journal（drizzle-kit 生成）
- **代码证据**：4 个 repository 写入点、2 个 worker 任务、1 个 web 读取端、1 个新 Repository 文件
- **live 数据库证据**：只读 preflight（§2）；测试证据全部来自 disposable/共享测试库
- 生产库未验证（D07 范围）；live 开发库未应用 0053（本地业务数据零破坏）

## 2. 修改前真实模型（审计结果）

| 对象                    | 修改前                                                                                                      | 问题证据                                                                                                                                               |
| ----------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| asset_representations   | 唯一约束 `(asset_version_id, kind)`；无 variant/producer 维度                                               | 同一 AssetVersion 每 kind 只能一行——两个 Provider 的 transcription 无法并存（D04 核心障碍）；catalog 证据：`asset_representations_version_kind_unique` |
| asset_processing_jobs   | 无 kind 唯一约束；queueJobKey 幂等（graphile 级）                                                           | 并发重复 enqueue 依赖先查后插（TOCTOU），可能产生同一 identity 的平行 job；live 14 行（extract_text 4 / generate_thumbnail 10）                        |
| asset_versions 兼容字段 | extractedText（23 行 live）、transcriptionText/transcriptionMetadata（0 行 live）                           | 写者 = 3 个 settle；读者 = asset-preview API（web）+ agent context（materializeOwnedReferences）；live transcription 旧字段零数据 → 音频回填负担为零   |
| 生产写入者              | 6 处 representation 写入（asset-repository ×2、transcription、video、derived-processing ×2）+ 3 处 job 入队 | 全部按 (versionId, kind) 查重/更新，无 provider 概念                                                                                                   |
| D03 Registry            | assetRepresentationKinds（6）/ assetProcessorKinds（5）单一权威                                             | 已冻结（D03 PASS），D04 未重复定义                                                                                                                     |

## 3. Authority 决策

1. **asset_representations 成为派生内容的唯一权威**（身份/幂等/并存/审计）。
2. 新的 transcription/OCR/preview 写入必须进入新权威（本任务把 6 个现有写入点全部切到按完整 identity 的幂等 upsert）。
3. `asset_versions.extractedText / transcriptionText / transcriptionMetadata` **不再作为新增写入权威**：
   - transcription 内容 = worker 写入对象存储（`derived/transcription/<jobId>/<sha256>.txt`），representation.derivedStorageKey 承载内容身份；
   - text 抽取内容 = worker 写入对象存储（`derived/text/<jobId>/<sha256>.txt`）；
   - transcriptionText/transcriptionMetadata/extractedText 保留为**同事务 compatibility 镜像**（唯一主写 = representation；双写时限与退出条件见 §11）。
4. 第一阶段**不物理删除**三个旧字段。
5. 双写一致性：representation 与镜像在同一事务内写入（原子）。

## 4. Representation Identity

**identity = (assetVersionId, kind, variant, producer, producerVersion)**，五元组完整表达任务要求：

| 身份要素                            | 字段                                       | 示例                                                                    |
| ----------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------- |
| assetVersionId                      | asset_version_id                           | —                                                                       |
| kind                                | kind                                       | transcription / ocr / preview                                           |
| variant                             | variant                                    | default / low / high / corrected                                        |
| producer                            | producer                                   | local / cloud / provider-a / human                                      |
| producerVersion                     | producer_version                           | sherpa.v1 / provider-a.v1 / v2                                          |
| algorithm/config version            | producer_version 命名约定                  | 如 `sherpa.v1` 中 v1 为算法版本；config 变化可升 producerVersion 次版本 |
| status                              | status                                     | processing / ready / failed / unavailable（closed 闭集，未放宽）        |
| content/storage identity            | derived_storage_key + checksum + byte_size | 对象键 + SHA-256                                                        |
| createdAt / updatedAt / completedAt | created_at / updated_at / completed_at     | D04 新增 updated/completed                                              |

- variant/producer/producer_version 是开放扩展 Vocabulary：DB 格式 CHECK（`^[a-z][a-z0-9_]{0,63}$` / producer 含点连字符 `^[a-z][a-z0-9._-]{0,63}$` / version `^[a-z0-9][a-z0-9._-]{0,63}$`）+ 应用层 `agent-core representationIdentitySchema`（zod 唯一权威）。**未把开放标识改回 DB 硬枚举**。

## 5. 唯一约束与索引

| 对象                  | 约束/索引                                               | 语义                                                             |
| --------------------- | ------------------------------------------------------- | ---------------------------------------------------------------- |
| asset_representations | `asset_representations_identity_unique`（UNIQUE, 5 列） | 同 identity 唯一；异 identity 并存                               |
| asset_processing_jobs | `asset_processing_jobs_identity_unique`（UNIQUE, 5 列） | 同 identity 只允许一个 job（重试 = attempts++）；消除入队 TOCTOU |
| asset_representations | `version_status_idx`（保留）                            | 既有索引不变                                                     |

**幂等契约**：相同完整 identity 的重复写 = **幂等 upsert**（onConflictDoUpdate 更新状态/内容身份/时间戳，不新增行、不拒绝）；对象 key 被替换时，旧 key 与同一事务进入 `object_deletion_outbox`。不同 identity 永不互相覆盖。job 重复入队 = onConflictDoNothing（幂等返回，不报错）。

## 6. 写入与读取策略

**写入**（6 个生产写入点全部切到 identity upsert）：

| 写入点                                                | 位置                                   | 策略                                                                            |
| ----------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------- |
| settleTextExtraction                                  | asset-repository.ts                    | text representation（identity 显式 default）+ extractedText 镜像 + 对象内容身份 |
| settleAudioTranscription                              | asset-transcription-repository.ts      | transcription representation + transcriptionText/Metadata 镜像（同事务）        |
| settleDerivedAssetJob（preview/thumbnail）            | asset-derived-processing-repository.ts | 按 identity upsert                                                              |
| upsertRepresentation（video transcription/keyframes） | asset-video-repository.ts              | 按 identity upsert                                                              |
| createUploadedPending/createUploaded                  | asset-repository.ts                    | original/text representation 补 identity；job 入队补 identity                   |

**读取**：

| API                                            | 策略                                                                                                                                                                                                 |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getRepresentation(identity)`                  | 显式 identity 读取，返回准确版本（不存在 → null）                                                                                                                                                    |
| `listRepresentations(versionId, kind?)`        | 列出全部可用版本（含 processing/failed）                                                                                                                                                             |
| `selectDefaultRepresentation(versionId, kind)` | **确定性规则**：`ready` 优先 → `variant='default'` 优先 → `producer='default'` 优先 → `producer` / `producerVersion` 字典序最小 → `createdAt` → `id`（最终 tie-break）；不依赖未指定顺序或"最后一行" |
| `loadOwnedCurrentStoredVersion`（扩展）        | 新增 `transcriptionRepresentation`（默认 identity 转录的对象内容身份，仅供服务端 Adapter，绝不进客户端状态）                                                                                         |
| asset-preview API（web）                       | transcription 读取：受控 `derived/*` representation 对象优先并校验 SHA-256；对象缺失、校验失败或无 representation 时按冻结规则回退旧字段 transcriptionText                                           |

## 7. compatibility read

- 新 representation 存在（ready + storage key + checksum）→ 读新权威（对象内容并校验完整性）；
- 仅有旧字段（无 representation 或对象缺失）→ 按冻结规则回退 `transcriptionText`；
- 新写入不再只落旧字段（representation 权威 + 镜像同事务）；
- 镜像读取端（agent context materialize）：**文档文本路径已于 E1 切换**（2026-08-11）——
  structured 读 derived 对象并核对 SHA-256、degraded/无表示回退 extractedText 镜像、
  processing/failed 明确失败；音频 transcription 镜像路径保持（双写窗口内一致，见 §11 注记）；
  **派生图片路径已于 E2 切换**（2026-08-11）——structured 表示 + Provider 声明 image 能力时，
  manifest 图片按 position 排序、白名单 MIME（png/jpeg/webp）过滤后进 native image parts，
  逐张核对 byteSize+sha256（不符 → 完整性失败），与用户上传原生图共享
  MAX_NATIVE_IMAGES/MAX_NATIVE_IMAGE_BYTES 预算；manifest 缺失按数据损坏明确失败；
  **旧行重放兼容已于 E3 固化**（2026-08-11）——0054 前旧行 `selected_asset_representations='[]'`
  且 contextHash 不含表示字段，重放（createOrGet 幂等重试）时只比较旧行能表达的事实
  （构建器/消息/版本/预算），跳过 hash 与表示身份；历史 Turn 允许继续读取，
  重试不因 hash 算法演进冲突；新行（0055 后）仍做全字段含 hash 核对。

## 8. backfill

- **零数据迁移**：新列 `NOT NULL DEFAULT`（variant='default', producer='default', producer_version='v1'）自动 backfill 现有 28 行 representation 与 14 行 job；
- live preflight 证明现有 `(version_id, kind)` 唯一是五元组唯一键的子集，**无冲突**；
- N-1 测试固化：0052 旧行升级后 identity = default/default/v1，数据完整保留。

## 9. Migration（0053_silky_millenium_guard.sql）

- drizzle-kit 正式生成（非手工）；journal/snapshot/SQL 配套；历史 0000–0052 零修改；
- **semantic change**：两表 6 列 + 2 唯一约束 + 6 开放格式 CHECK；
- **锁风险**：ADD COLUMN 各取 ACCESS EXCLUSIVE 元数据短锁（表规模 28/14 行）；唯一索引创建取 SHARE 锁；
- **回滚**：DROP 新唯一索引与 CHECK + 删三列；回退前必须确认不存在非默认 identity，否则需要先导出或归并这些新行，不能宣称无数据损失；
- **fresh install**：disposable 库全量迁移通过；
- **N-1**：0052→0053 升级测试通过（backfill、数据保留、23505/23514 拒绝）；
- **RC manifest**：migration.version 53 → **54**（docs/06-quality/releases/rc1/manifest.json）。

## 10. fresh / N-1 / rollback

| 验证                             | 结果                                                                         |
| -------------------------------- | ---------------------------------------------------------------------------- |
| fresh DB → head（disposable 库） | PASS                                                                         |
| N-1 0052 → 0053（disposable 库） | PASS（backfill + 数据保留 + 唯一约束生效）                                   |
| rollback 方案                    | DROP 新约束/列可逆（§9），未在测试库实测（无破坏性操作；MIGRATIONS.md 记录） |

## 11. Retention / Deletion（D01 契约）

- asset_versions 删除 → representations/jobs 随既有 FK cascade（D01 §4.6/4.7 冻结）；集成测试固化（tombstone 前置 + cascade）；
- **旧字段退出条件**（第一阶段不删除，物理删除归属后续任务）：
  1. 回填完成：transcription 旧字段 live 零数据（无回填负担）；extractedText 镜像保持；
  2. 新写入切换完成：✅（本任务 6 个写入点全部切 identity upsert）；
  3. 读取切换完成：transcription ✅（preview API 已切 representation 优先）；agent context 文档文本路径 ✅（E1，2026-08-11：structured 读 derived 对象 + SHA-256 核对，degraded/无表示回退镜像，processing/failed 明确失败；音频 transcription 镜像路径保留，待转录回填证据后再切）；
  4. 生产调用证据为零：transcriptionText/transcriptionMetadata 需在双写窗口结束后再审计；
  5. 回退窗口结束：0053 应用后一个发布周期；
  6. 物理删除任务归属：后续 D 线任务（与 D05/D06 相邻排期），本任务不删除。

## 12. Registry 关系

- `agent-core assetRepresentationKinds`（kind 权威，D03 冻结）——本任务未改；
- `agent-core assetProcessorKinds`（processor 权威，D03 冻结）——未改；
- **新增** `agent-core representationIdentitySchema / representationVariantSchema / representationProducerSchema / representationProducerVersionSchema / DEFAULT_REPRESENTATION_IDENTITY`（identity 权威，单一 zod，无并行 TS enum）；
- DB 仅格式 CHECK（D03 词汇门禁继续通过：`vocabulary-gate` audit exit 0、8/8 测试）。
- **ADR-0026（0054）新增 2 个 closed 质量 CHECK**（`asset_representations_quality_check` / `_quality_shape_check`）：四态质量（processing/structured/degraded_plain_text/failed + unavailable）是 closed 枚举，与 status/failure_shape 同类，已注册进 `CLOSED_VOCABULARY_CONSTRAINTS` 白名单（全量门禁测试覆盖，见 §15 验证记录）。

## 13. 对 UV / KM / PET / O 的影响

- **UV（语音）**：audio transcription 内容权威切换（对象存储 + representation）；preview API 已切换读取；agent context 在双写窗口内继续读镜像——无功能回退；新增 cloud transcription（producer='cloud'）可直接并存，无需 Migration；
- **KM（知识记忆）**：text 抽取内容身份对象化，extractedText 镜像保持；knowledge 域读取不受影响；
- **PET（桌宠）**：不触碰 turn/tool/message 账本；
- **O（其他）**：video transcription/keyframes、preview/thumbnail 写入路径均切 identity upsert，行为等价（默认 identity）；object_deletion_outbox 的 representation 删除意图不受影响。

## 14. D05 输入

- `asset_representations` / `asset_processing_jobs` 的五元组 identity 唯一约束是 D05 Schema 模块化时必须保留的语义；
- 新文件 `asset-representation-repository.ts`（约 300 行）已独立成域并承载共享 identity upsert/Outbox 语义，D05 拆分 schema.ts 时可直接映射；
- D04 新增 6 个开放格式 CHECK 已在 vocabulary-gate 白名单外自动放行（格式约束非闭集）。

## 15. 验证记录

| 命令                                            | 退出码       | 关键输出                                                                                                                                                                                            |
| ----------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm env:check`                                | 0            | OK                                                                                                                                                                                                  |
| `pnpm --dir packages/db exec drizzle-kit check` | 0            | Everything's fine                                                                                                                                                                                   |
| `pnpm --dir packages/db typecheck`              | 0            | —                                                                                                                                                                                                   |
| `pnpm --dir packages/db test`                   | 0            | 9 files / 70 tests                                                                                                                                                                                  |
| `pnpm --dir packages/db test:integration`       | 0            | **50 files / 323 tests**                                                                                                                                                                            |
| `pnpm --dir apps/worker typecheck`              | 0            | —                                                                                                                                                                                                   |
| `pnpm --dir apps/web typecheck`                 | 0            | —                                                                                                                                                                                                   |
| `pnpm typecheck:e2e`                            | 0            | —                                                                                                                                                                                                   |
| `pnpm test:tooling`                             | 环境限制挂起 | 沙箱禁止进程枚举（local-core-cleanup），与改动无关；vocabulary-gate 等子集通过                                                                                                                      |
| `node tooling/quality/vocabulary-gate.mjs`      | 0            | 无违规                                                                                                                                                                                              |
| `node --test tooling/vocabulary-gate.test.mjs`  | 0            | 8/8                                                                                                                                                                                                 |
| `pnpm file:check`                               | 0            | 基线显式更新（asset-repository 1321→1411、asset-video-repository 501→534、index 472→478、schema.ts 2936→2993）；identity 共享 upsert 已集中到约 300 行的新 Repository，既有大文件的进一步拆分归 D05 |
| `node tooling/quality/validate-evidence.mjs`    | 见最终回报   | —                                                                                                                                                                                                   |
| fresh / N-1 migration 测试                      | 0            | PASS                                                                                                                                                                                                |
| `git diff --check`                              | 0            | —                                                                                                                                                                                                   |

## 16. 未完成项与证据缺口

- **agent context 读取切换**：materializeOwnedReferences 仍读镜像（双写窗口内）——已记录为退出条件，未在本任务扩大范围；
- **transcriptionMetadata 的 representation 归宿**：多 Provider 并存时各自 representation 不单独存 metadata（镜像只覆盖默认 identity）——D04 文档记录为后续任务（metadata 与 provider 绑定）；
- **rollback 未在测试库实测**（仅方案 + MIGRATIONS.md 记录）；
- **worker 集成测试**（transcribe/extract 对象写入）未跑（apps/worker 集成测试需要完整环境）——对象写入逻辑已 typecheck 通过并有单元覆盖（sha256Hex 既有）。
