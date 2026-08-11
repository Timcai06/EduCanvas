# D03：开放 Vocabulary 与封闭状态机分离

- 任务：`D 数据架构与扩展性收敛` → `D03 开放 Vocabulary 与封闭状态机分离`
- 类型：Vocabulary 审计 + 1 个 CHECK-only Migration（`0052_damp_jigsaw`）
- 审计/实施日期：2026-08-08 至 2026-08-09（CST）
- 状态：`PASS`（Codex 修订并复核）
- 基线：HEAD = origin/main = `611082ed955d1a508529803c6843ef11a36f8f19`
- 前置：D00、D01、D02 已 PASS；历史 Migration `0000`–`0051` 未修改

## 1. 结论与边界

- TypeScript AST 完整解析 `packages/db/src/schema.ts` 与 `packages/db/src/schema/`：共 **231 个 CHECK**，与 D00 基线一致；注释、换行和混合 shape CHECK 不会被漏过。
- 本轮实际开放 **13 个 CHECK，分布于 11 张表**；均是扩展标识或派生类型，数据库只保留稳定格式，生产入口继续由应用层 Registry/validator 限定。
- 当前 Schema 中有 **109 个字面量成员闭集 CHECK**；全部命中 `CLOSED_VOCABULARY_CONSTRAINTS`。白名单共 110 个约束名，额外包含不以简单字面量成员闭集表达、但仍需保持封闭身份语义的 `mcp_tool_intents_identity_check`。
- 以下七类原方案放宽已撤销：教学学段、教学偏好、消息 part type、模型 finish reason、预算 breach reason、MCP 专用 intent capability。它们分别承担结构分支、平台归一化终态、低基数账本、安全兼容或当前应用可读性契约，不属于可直接开放的扩展标识。
- Migration 只替换 13 个 CHECK，无数据迁移、无 FK/INDEX/UNIQUE 变化，CHECK 总数保持 231。

## 2. Open Vocabulary Matrix（13 个约束）

| #   | 约束 / 字段                                              | 应用权威与生产入口                                                                       | 决策                                          |
| --- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------- |
| 1   | `gateway_node_invocations_capability_check` / capability | `gatewayCapabilityNames` + gateway request schema                                        | capability 是可扩展路由标识；DB 保留含点格式  |
| 2   | `assets_kind_check` / assets.kind                        | `assetKinds` / `assetKindSchema`；上传入口运行时 parse                                   | 资产类别扩展标识                              |
| 3   | `asset_versions_kind_check` / asset_versions.kind        | 同 `assetKinds`                                                                          | 与资产内容类型保持同一权威                    |
| 4   | `assets_origin_check` / assets.origin                    | `assetOrigins` / `assetOriginSchema`；上传入口运行时 parse                               | 来源类型扩展标识                              |
| 5   | `asset_representations_kind_check` / representation.kind | `assetRepresentationKinds`；transcription/video/derived/upload repositories 使用导出类型 | 派生表示类型，D04 的直接输入                  |
| 6   | `asset_processing_jobs_kind_check` / job.kind            | `assetProcessorKinds`；derived processing repository 的 job config 使用导出类型          | 处理器类型扩展标识                            |
| 7   | `knowledge_sources_type_check` / source_type             | knowledge source repository 的 `KnowledgeSourceType` 与写入校验                          | 知识来源类型扩展标识                          |
| 8   | `agent_operations_kind_check` / operation.kind           | gateway/platform operation writer 的应用类型                                             | 操作类型扩展标识；状态仍封闭                  |
| 9   | `object_deletion_outbox_kind_check` / object_kind        | deletion outbox repository 输入类型                                                      | 多态对象类型；状态/生命周期仍封闭             |
| 10  | `object_deletion_outbox_source_check` / source_type      | deletion outbox repository 输入类型                                                      | 可扩展对象来源类型                            |
| 11  | `operation_sources_kind_check` / kind                    | platform source repository                                                               | 渠道来源扩展标识                              |
| 12  | `agent_message_parts_shape_check` / artifact_kind 分支   | `agentArtifactPartSchema.kind` 格式校验；part_type 分支仍封闭                            | 只开放 artifact kind，不开放结构 discriminant |
| 13  | `tool_effect_reconciliations_source_check` / source      | reconciliation repository 输入校验                                                       | 对账生产者标识；resolution 仍封闭             |

既有格式型开放先例未产生 Migration：`artifacts.kind`、`model_runs.model_alias/task_alias`、`turn_usage_budget_outcomes.profile_id`、`asset_video_keyframes.algorithm_version`。

## 3. 明确保留封闭的纠偏项

| 字段                                                               | 保留闭集的原因                                                                                                        |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `learner_profiles.default_grade_band`、`learning_goals.grade_band` | repository 使用 `learnerGradeBands` 解析；DB 接受应用无法读取的新值会形成不可消费数据                                 |
| `learner_profiles.preferences`                                     | `teachingPreferencesSchema` 是严格五键业务契约，不只是开放键值 Registry                                               |
| `agent_message_parts.part_type`                                    | discriminated union 与数据库 shape 分支只有 `text/asset_ref/artifact_ref`；单独开放 part_type 会制造无合法 shape 的值 |
| `model_runs.finish_reason`                                         | provider 原始原因已归一化到七个稳定平台终态；账本与读取端都按该闭集解释                                               |
| `turn_usage_budget_outcomes.breach_reason`                         | 低基数联合账本与指标维度，新增值需要 runtime/reader/metrics 同步评审                                                  |
| `mcp_tool_intents.capability`                                      | 该表专用于 `external.mcp.invoke`；等值约束是安全和兼容边界，不是通用 capability Registry                              |

其余 lifecycle status、terminal authority、security outcome、approval risk、consent purpose、tool effect、RBAC、协议版本、信任等级等继续由数据库 hard CHECK 强制。

## 4. Authority 与生产接线

- `packages/agent-core/src/asset-contracts.ts` 是 asset kind/origin/representation/processor 的共享权威；不新增 TypeScript enum。
- `assetRepresentationKinds` 和 `assetProcessorKinds` 不只是导出：asset repository、derived-processing、transcription、video repository 的生产写入类型/常量已接到它们。
- 上传入口对 `kind` 和 `origin` 使用 Zod parse，Provider 或外部请求不能直接把任意格式合法字符串写入数据库。
- message artifact kind 保持格式扩展，但 `partType` 与三条 shape 分支继续同步封闭。
- 开放意味着“扩展不再要求 DB Migration”，不意味着“未登记输入可以通过应用入口”。

## 5. Migration 与元数据

### 5.1 `0052_damp_jigsaw.sql`

- Drizzle 从修正后的临时 0051 元数据基线生成；最终 SQL、`0052_snapshot.json`、`_journal.json` 均为生成结果，未手工编辑 snapshot。
- 13 个旧 CHECK 被 DROP，并以格式 CHECK 重建；11 张表会取得短时 `ACCESS EXCLUSIVE` DDL 锁并扫描存量行。
- D02 的三条 FK 与 `assets_space_fk_idx` 已存在于 0051 SQL，但 0051 snapshot 未记录。生成时仅在临时元数据副本中补齐它们，避免 0052 重复 ADD；历史 `0051_snapshot.json` 保持不可变。该历史元数据漂移交给 D06 治理。
- Fresh DB 与 N-1（0051 → 0052）必须同时验证；live 开发库不由本任务迁移。

### 5.2 数据兼容

- 新格式约束是旧闭集的超集，现有值不需要 backfill。
- 回退前必须先回退应用写入，并确认不存在旧闭集外的新值；否则重建旧 CHECK 会被 PostgreSQL 拒绝。

## 6. 静态门禁

`tooling/quality/vocabulary-gate.mjs`：

- 使用 TypeScript AST 提取完整 `check(name, sql\`...\`)`调用；同时比较源码中的`check(` 语法计数，解析不完整时 fail closed。
- 同时识别字面量 `IN (...)` 和 `column = 'literal'`，包括 shape CHECK 内嵌闭集。
- 审计最新 journal 指向的 Migration `ADD CONSTRAINT ... CHECK`，防止手写 SQL 绕过 Schema 门禁。
- 白名单外新增成员闭集直接失败；新增真正 closed 约束必须同步登记并写明安全/生命周期理由。

`tooling/vocabulary-gate.test.mjs` 固化：231/231 提取、注释/换行防绕过、IN/等值识别、表达式不误判、当前 Schema 零违规、最新 0052 的 13 个 CHECK、正反白名单用例。

### 6.1 后继扩展：Live Voice 私人纸面语义（0054–0055）

- `resource_annotations` 的 resource kind、笔色、批注 kind/source 与 note body shape，
  以及 `notebook_surface_positions` 的 resource kind、zone/rest state 均是前后端协议
  判别联合；数据库接受应用不认识的新值会产生无法渲染或无法恢复的私人状态，因此登记为 closed。
- 两张新表另有 4 个坐标、长度与 JSON shape CHECK，继续按开放格式约束处理。
- 门禁现会解析最新 Migration 中 `CREATE TABLE ... CONSTRAINT ... CHECK` 和
  `ALTER TABLE ... ADD CONSTRAINT ... CHECK` 两种形态，避免新表内联 CHECK 绕过审计。
- 当前 Schema 共 249 个 CHECK；该数字用于 AST 提取完整性回归，不改变 D03 原始
  231 个 CHECK 的历史审计结论。

## 7. 可执行回退 SQL

以下 SQL 仅在应用写入已回退、且 13 个字段不存在旧闭集外值时执行：

```sql
ALTER TABLE agent_message_parts DROP CONSTRAINT agent_message_parts_shape_check;
ALTER TABLE agent_message_parts ADD CONSTRAINT agent_message_parts_shape_check CHECK ((part_type = 'text' AND text_content IS NOT NULL AND asset_id IS NULL AND asset_version_id IS NULL AND asset_usage IS NULL AND artifact_id IS NULL AND artifact_version_id IS NULL AND artifact_kind IS NULL) OR (part_type = 'asset_ref' AND text_content IS NULL AND asset_id IS NOT NULL AND asset_version_id IS NOT NULL AND asset_usage IN ('attachment', 'context') AND artifact_id IS NULL AND artifact_version_id IS NULL AND artifact_kind IS NULL) OR (part_type = 'artifact_ref' AND text_content IS NULL AND asset_id IS NULL AND asset_version_id IS NULL AND asset_usage IS NULL AND artifact_id IS NOT NULL AND artifact_version_id IS NOT NULL AND artifact_kind IN ('image', 'audio', 'video', 'slide', 'interactive', 'document')));
ALTER TABLE agent_operations DROP CONSTRAINT agent_operations_kind_check;
ALTER TABLE agent_operations ADD CONSTRAINT agent_operations_kind_check CHECK (kind IN ('turn', 'artifact_generation'));
ALTER TABLE asset_processing_jobs DROP CONSTRAINT asset_processing_jobs_kind_check;
ALTER TABLE asset_processing_jobs ADD CONSTRAINT asset_processing_jobs_kind_check CHECK (kind IN ('extract_text', 'render_preview', 'generate_thumbnail', 'transcribe_audio', 'process_video'));
ALTER TABLE asset_representations DROP CONSTRAINT asset_representations_kind_check;
ALTER TABLE asset_representations ADD CONSTRAINT asset_representations_kind_check CHECK (kind IN ('original', 'text', 'preview', 'thumbnail', 'transcription', 'keyframes'));
ALTER TABLE asset_versions DROP CONSTRAINT asset_versions_kind_check;
ALTER TABLE asset_versions ADD CONSTRAINT asset_versions_kind_check CHECK (kind IN ('image', 'audio', 'video', 'document', 'data', 'link', 'other'));
ALTER TABLE assets DROP CONSTRAINT assets_kind_check;
ALTER TABLE assets ADD CONSTRAINT assets_kind_check CHECK (kind IN ('image', 'audio', 'video', 'document', 'data', 'link', 'other'));
ALTER TABLE assets DROP CONSTRAINT assets_origin_check;
ALTER TABLE assets ADD CONSTRAINT assets_origin_check CHECK (origin IN ('upload', 'url_import', 'generated', 'library'));
ALTER TABLE gateway_node_invocations DROP CONSTRAINT gateway_node_invocations_capability_check;
ALTER TABLE gateway_node_invocations ADD CONSTRAINT gateway_node_invocations_capability_check CHECK (capability IN ('device.status', 'filesystem.read_allowlisted'));
ALTER TABLE knowledge_sources DROP CONSTRAINT knowledge_sources_type_check;
ALTER TABLE knowledge_sources ADD CONSTRAINT knowledge_sources_type_check CHECK (source_type IN ('text', 'pdf'));
ALTER TABLE object_deletion_outbox DROP CONSTRAINT object_deletion_outbox_kind_check;
ALTER TABLE object_deletion_outbox ADD CONSTRAINT object_deletion_outbox_kind_check CHECK (object_kind IN ('asset', 'artifact', 'avatar'));
ALTER TABLE object_deletion_outbox DROP CONSTRAINT object_deletion_outbox_source_check;
ALTER TABLE object_deletion_outbox ADD CONSTRAINT object_deletion_outbox_source_check CHECK (source_type IN ('asset_version', 'asset_representation', 'asset_video_keyframe', 'artifact_version', 'user_avatar'));
ALTER TABLE operation_sources DROP CONSTRAINT operation_sources_kind_check;
ALTER TABLE operation_sources ADD CONSTRAINT operation_sources_kind_check CHECK (kind = 'web');
ALTER TABLE tool_effect_reconciliations DROP CONSTRAINT tool_effect_reconciliations_source_check;
ALTER TABLE tool_effect_reconciliations ADD CONSTRAINT tool_effect_reconciliations_source_check CHECK (source IN ('manual', 'adapter'));
```

## 8. 对 D04 / D05 / D06 的输入

- **D04**：以 `asset_representations` 和 `asset_processing_jobs` 为现有权威，补足多 Provider/多版本 identity、并存读取与兼容迁移；复用已接入生产路径的 representation/processor Registry，不建第二套资产派生账本。
- **D05**：Schema 模块化必须保持约束名和导出 API 稳定；vocabulary gate 按 AST 与约束名工作，不依赖 Schema 文件路径。
- **D06**：治理 0051 SQL 与 snapshot 的元数据漂移，并把 fresh、N-1、schema/migration drift 变成独立 CI 证据；D03 不修改历史 snapshot。

## 9. 修改文件职责

| 范围                                        | 单一职责                                                                |
| ------------------------------------------- | ----------------------------------------------------------------------- |
| Schema / repositories                       | 13 个 CHECK 开放；封闭项恢复；asset Registry 接到生产写入类型与入口校验 |
| `0052_damp_jigsaw.sql` + snapshot + journal | 生成的 CHECK-only Migration 三件套                                      |
| integration tests                           | 开放值、非法格式、应用 Registry、closed 类别、fresh/N-1 回归            |
| vocabulary gate + tooling test              | AST 全量审计、最新 Migration 审计、正反门禁                             |
| `MIGRATIONS.md`                             | 0052 语义、锁、回退、N-1/Fresh 与 D02 元数据边界                        |

## 10. 验证记录

| 命令                                                                                               | 结果                                                                           |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `rtk pnpm --dir packages/db exec drizzle-kit check`                                                | PASS，`Everything's fine`                                                      |
| `rtk pnpm --dir packages/db typecheck`                                                             | PASS                                                                           |
| `rtk pnpm --dir packages/db test`                                                                  | PASS，9 files / 70 tests                                                       |
| `rtk pnpm --dir packages/agent-core test`                                                          | PASS，25 files / 287 tests                                                     |
| `rtk env TEST_DATABASE_URL=...:5434/educanvas_integration pnpm --dir packages/db test:integration` | PASS，49 files / 312 tests；覆盖 fresh DB 与 0051→0052                         |
| `rtk pnpm test:tooling`                                                                            | PASS，135/135；vocabulary gate 8/8                                             |
| `rtk pnpm exec turbo run typecheck --force`                                                        | PASS，25/25 workspace packages                                                 |
| `rtk pnpm typecheck:e2e`                                                                           | PASS                                                                           |
| `rtk pnpm file:check`                                                                              | PASS，1637 tracked files；6 个新文件另以 `auditTrackedFiles` 检查，0 violation |
| targeted Prettier + package lint                                                                   | PASS                                                                           |
| `rtk git diff --check`                                                                             | PASS                                                                           |

首次 DB integration 在沙箱内以 `connect EPERM localhost:5434` 失败；允许访问本机隔离测试库后同一命令 312/312 通过，故属于执行环境边界而非代码失败。根 `pnpm lint` 的 Turbo/package lint 均通过，最后的全仓格式扫描只命中 Git 已忽略的 `apps/desktop/out/**` 三个既有构建产物；D03 文件的 targeted Prettier 与 DB lint 均通过，未修改生成目录。

本地 Node 为 v24.18.0，而仓库声明 Node 22；所有命令均打印 engine warning，但没有由此产生的验证失败。

## 11. 未提交声明

本任务未创建分支、未提交、未推送、未合并、未开始 D04；未修改历史 Migration/snapshot；live 开发库未应用 0052。
