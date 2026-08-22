# 数据库迁移记录（Q06）

- 审计日期：2026-08-07
- 覆盖范围：`packages/db/drizzle/*.sql`（drizzle-kit 生成）
- 门禁：`tooling/quality/migration-records.mjs`（CI checks job）

每个迁移必须有本文件中的记录段，字段：**语义 / 锁表 / 回滚 / N-1 / Fresh
install / 风险**。

**归档基线**（`0000`–`0050`）：2026-08-07 审计时由 SQL 推导的记录，非原
作者手写。语义按语句类型推断（`CREATE TABLE` 不锁用户表、`ALTER TABLE`
为 ACCESS EXCLUSIVE 元数据锁、`CREATE INDEX` 为 SHARE 锁等）。改动归档
迁移时，作者必须把对应记录段升级为显式作者记录（去掉「归档基线」状态）。

**新迁移**（`0051` 起）：作者必须手写完整记录段，状态为 `active`，不
允许使用「归档基线」占位；缺失任一字段或使用占位，CI 门禁失败。

---

## 0000_careless_lady_bullseye.sql

- 状态: 归档基线（2026-08-07 审计，语义由 SQL 推导）
- 语义: 初始 schema：`lesson_sessions` / `learning_events` /
  `canvas_artifacts` / `mastery_states` 四表 + 会话外键。
- 锁表: 无用户表锁（CREATE TABLE）。
- 回滚: DROP TABLE 四表（含级联依赖）。
- N-1: 全新表，无兼容性问题。
- Fresh install: 可重放；CI 空库 `db:migrate` 覆盖。
- 风险: 基线表结构，改动前评估既有数据。

## 0001_light_the_initiative.sql

- 状态: 归档基线（2026-08-07 审计，语义由 SQL 推导）
- 语义: `lesson_sessions.state` 移除 DEFAULT。
- 锁表: ACCESS EXCLUSIVE（元数据短锁）。
- 回滚: `ALTER COLUMN state SET DEFAULT 'EXPLAIN'`。
- N-1: 老代码依赖 DB 默认值写行会缺少该值；应用层必须显式赋值。
- Fresh install: 可重放。
- 风险: 低。

## 0002_common_cerebro.sql

- 状态: 归档基线（2026-08-07 审计，语义由 SQL 推导）
- 语义: `learning_events` 加 causation_id/idempotency_key/recorded_at/
  sequence/source 五列并去 id、schema_version 默认值；`lesson_sessions`
  加 interrupted_state/knowledge_node_id/version；新增
  `canvas_artifact_grading_keys` + 3 唯一索引。
- 锁表: ACCESS EXCLUSIVE（ALTER TABLE 元数据短锁）。
- 回滚: 删新增列/表/索引；恢复被删默认值。
- N-1: 新增列均可空/带默认，老代码兼容；索引为追加操作。
- Fresh install: 可重放。
- 风险: 中——事件溯源语义（idempotency_key/sequence）后续强依赖，
  勿删列。

## 0003_wealthy_wildside.sql

- 状态: 归档基线（2026-08-07 审计，语义由 SQL 推导）
- 语义: `lesson_sessions` 加 `event_sequence`。
- 锁表: ACCESS EXCLUSIVE（元数据短锁）。
- 回滚: DROP COLUMN event_sequence。
- N-1: 可空新列，兼容。
- Fresh install: 可重放。
- 风险: 低。

## 0004_nifty_spyke.sql

- 状态: 归档基线（2026-08-07 审计，语义由 SQL 推导）
- 语义: `lesson_sessions` 加 status/title/last_activity_at/archived_at +
  状态 CHECK + 活跃会话唯一约束；新增 `chat_messages` / `model_runs` +
  会话/轮次索引。
- 锁表: ACCESS EXCLUSIVE（加列/CHECK 校验存量行）。
- 回滚: 删列/约束/索引/表。
- N-1: 新列有默认值，兼容；唯一约束可能拒绝老数据中的重复行。
- Fresh install: 可重放。
- 风险: 中——`lesson_sessions_active_scope_unique` 会拒绝重复活跃会话。

## 0005_exotic_starhawk.sql

- 状态: 归档基线（2026-08-07 审计，语义由 SQL 推导）
- 语义: `chat_messages` 加 lease_id/lease_expires_at/heartbeat_at 租赁
  三列 + 形状 CHECK + 单活跃 assistant 唯一约束；新增 `tool_calls` +
  执行幂等索引。
- 锁表: ACCESS EXCLUSIVE（ALTER TABLE）。
- 回滚: 删列/约束/索引/表。
- N-1: 租赁列可空，兼容；唯一约束拒绝老数据重复行。
- Fresh install: 可重放。
- 风险: 中——租赁并发语义，改约束前确认消息处理流程。

## 0006_windy_silver_sable.sql

- 状态: 归档基线（2026-08-07 审计，语义由 SQL 推导）
- 语义: 新增 `turn_safety_decisions`（轮次安全决策审计）+ 2 索引。
- 锁表: 无用户表锁（CREATE TABLE/INDEX）。
- 回滚: DROP TABLE + DROP INDEX。
- N-1: 全新表，兼容。
- Fresh install: 可重放。
- 风险: 低。

## 0007_ambiguous_silver_surfer.sql

- 状态: 归档基线（2026-08-07 审计，语义由 SQL 推导）
- 语义: 知识库 append-only：`knowledge_sources/documents/chunks`、
  `retrieval_candidates`、`message_citations`、`session_source_bindings`、
  `turn_source_versions` 七表 + 8 个不可变/追加触发器 + FTS/检索索引。
- 锁表: 无用户表锁（CREATE）；触发器运行期锁命中行。
- 回滚: DROP TRIGGER ×8 + DROP FUNCTION ×4 + DROP TABLE/INDEX。
- N-1: 全新表，兼容。
- Fresh install: 可重放。
- 风险: 中——不可变触发器会拒绝老代码对知识表的 UPDATE/DELETE。

## 0008_k1_snapshot_integrity.sql

- 状态: 归档基线（2026-08-07 审计，语义由 SQL 推导）
- 语义: K1 快照完整性：新增 `turn_source_snapshots` + 追加触发器；
  `retrieval_candidates` 加 document_id；重排 chunk/版本外键与唯一约束
  （删旧 FK 换新）。CHECK 先删后加（page 校验形状调整）。
- 锁表: ACCESS EXCLUSIVE（约束重建，校验存量行）。
- 回滚: 反向删/加（重建被删约束需确认形状）。
- N-1: 新增列可空兼容；FK 重排期间老代码引用约束名会失败——
  本迁移与引用代码同批发布。
- Fresh install: 可重放。
- 风险: 中——跨 0008 依赖的旧引用需同批更新。

## 0009_slow_shinobi_shaw.sql

- 状态: 归档基线（2026-08-07 审计，语义由 SQL 推导）
- 语义: 新增 `assets` / `asset_versions`（内容寻址，hash 唯一）/
  `agent_message_parts` + 3 索引。
- 锁表: 无用户表锁（CREATE TABLE/INDEX）。
- 回滚: DROP TABLE/INDEX。
- N-1: 全新表，兼容。
- Fresh install: 可重放。
- 风险: 低。

## 0010_tricky_impossible_man.sql

- 状态: 归档基线（2026-08-07 审计，语义由 SQL 推导）
- 语义: 新增 `turn_context_snapshots`（轮次上下文快照）+ 会话/轮次唯一。
- 锁表: 无用户表锁（CREATE）。
- 回滚: DROP TABLE。
- N-1: 全新表，兼容。
- Fresh install: 可重放。
- 风险: 低。

## 0011_legal_nocturne.sql

- 状态: 归档基线（2026-08-07 审计，语义由 SQL 推导）
- 语义: 空间/会话重构：新增 `spaces`、`conversations`、
  `conversation_messages`、`agent_operations` + 幂等/历史索引；
  `lesson_sessions` 加 conversation_id。
- 锁表: ACCESS EXCLUSIVE（加列，元数据短锁）。
- 回滚: DROP TABLE/INDEX + DROP COLUMN。
- N-1: 新列可空，兼容；新表为追加。
- Fresh install: 可重放。
- 风险: 中——conversation_id 为会话多租户化的前置字段。

## 0012_wandering_black_queen.sql

- 状态: 归档基线（2026-08-07 审计，语义由 SQL 推导）
- 语义: `spaces`/`conversations`/`conversation_messages`/
  `agent_operations` 加文本形状与终态 CHECK。
- 锁表: ACCESS EXCLUSIVE（CHECK 校验存量行）。
- 回滚: DROP CONSTRAINT ×4。
- N-1: 存量数据不满足新 CHECK 时会失败（迁移前需清洗）。
- Fresh install: 可重放。
- 风险: 中——文本形状校验与消息体 schema 强耦合。

## 0013_nice_cargill.sql

- 状态: 归档基线（2026-08-07 审计，语义由 SQL 推导）
- 语义: `conversation_messages` 加 `parts`（富文本分段）。
- 锁表: ACCESS EXCLUSIVE（元数据短锁）。
- 回滚: DROP COLUMN parts。
- N-1: 可空新列，兼容。
- Fresh install: 可重放。
- 风险: 低。

## 0014_lonely_zaran.sql

- 状态: 归档基线（2026-08-07 审计，语义由 SQL 推导）
- 语义: `agent_operations` 加 `cancel_requested_at`（取消语义）。
- 锁表: ACCESS EXCLUSIVE（元数据短锁）。
- 回滚: DROP COLUMN cancel_requested_at。
- N-1: 可空新列，兼容。
- Fresh install: 可重放。
- 风险: 低。

## 0015_public_stardust.sql

- 状态: 归档基线（2026-08-07 审计，语义由 SQL 推导）
- 语义: 新增 `artifacts` / `artifact_versions` / `artifact_generation_jobs`
  - 5 索引。
- 锁表: 无用户表锁（CREATE）。
- 回滚: DROP TABLE/INDEX。
- N-1: 全新表，兼容。
- Fresh install: 可重放。
- 风险: 低。

## 0016_daffy_squirrel_girl.sql

- 状态: 归档基线（2026-08-07 审计，语义由 SQL 推导）
- 语义: `artifact_versions` 加 `generated_by` + 生成来源 CHECK。
- 锁表: ACCESS EXCLUSIVE（CHECK 校验存量行）。
- 回滚: DROP COLUMN + DROP CONSTRAINT。
- N-1: 新列可空，兼容；CHECK 只约束新写入。
- Fresh install: 可重放。
- 风险: 低。

## 0017_new_scourge.sql

- 状态: 归档基线（2026-08-07 审计，语义由 SQL 推导）
- 语义: 新增 `conversation_message_citations` / `operation_sources`
  （操作来源溯源）+ 3 唯一/索引。
- 锁表: 无用户表锁（CREATE）。
- 回滚: DROP TABLE/INDEX。
- N-1: 全新表，兼容。
- Fresh install: 可重放。
- 风险: 低。

## 0018_married_deathstrike.sql

- 状态: 归档基线（2026-08-07 审计，语义由 SQL 推导）
- 语义: `artifact_generation_jobs` 加 checkpoint；
  `artifact_versions` 加 metadata + 形状 CHECK + 生成任务唯一。
- 锁表: ACCESS EXCLUSIVE（加列 + CHECK 校验）。
- 回滚: DROP COLUMN/CONSTRAINT/INDEX。
- N-1: 新列可空，兼容。
- Fresh install: 可重放。
- 风险: 中——metadata 形状 CHECK 与生成产物 schema 强耦合。

## 0019_good_rattler.sql

- 状态: 归档基线（2026-08-07 审计，语义由 SQL 推导）
- 语义: 用户/网关体系：新增 `platform_users`、`personal_agents`、
  `notebook_memberships`、`delegated_grants`、`gateway_channel_account_bindings`、
  `gateway_channel_thread_bindings`、`gateway_deliveries`、
  `gateway_operation_events` 八表；`agent_operations` 加 actor/agent/
  gateway_envelope/notebook/request_fingerprint 五列；幂等约束换为主键域
  （旧单列幂等索引删除）。
- 锁表: ACCESS EXCLUSIVE（ALTER TABLE）。
- 回滚: DROP TABLE/COLUMN/INDEX；恢复旧幂等索引。
- N-1: 新列可空兼容；`agent_operations_conversation_idempotency_unique`
  被删后旧写路径幂等性由应用层保证。
- Fresh install: 可重放。
- 风险: 高——大规模多表迁移，回滚面大；delegated_grants 与
  gateway_* 之间引用关系复杂。

## 0020_giant_legion.sql

- 状态: 归档基线（2026-08-07 审计，语义由 SQL 推导）
- 语义: 新增 `gateway_node_invocations`（节点调用轮询）+ nonce 唯一。
- 锁表: 无用户表锁（CREATE）。
- 回滚: DROP TABLE/INDEX。
- N-1: 全新表，兼容。
- Fresh install: 可重放。
- 风险: 低。

## 0021_brief_red_wolf.sql

- 状态: 归档基线（2026-08-07 审计，语义由 SQL 推导）
- 语义: 新增 `gateway_approvals`（审批流）。
- 锁表: 无用户表锁（CREATE）。
- 回滚: DROP TABLE/INDEX。
- N-1: 全新表，兼容。
- Fresh install: 可重放。
- 风险: 低。

## 0022_red_tusk.sql

- 状态: 归档基线（2026-08-07 审计，语义由 SQL 推导）
- 语义: 新增 `gateway_handoff_tokens`（握手令牌，digest 唯一）。
- 锁表: 无用户表锁（CREATE）。
- 回滚: DROP TABLE/INDEX。
- N-1: 全新表，兼容。
- Fresh install: 可重放。
- 风险: 低——令牌 digest 而非明文存储，勿回退到明文。

## 0023_furry_microbe.sql

- 状态: 归档基线（2026-08-07 审计，语义由 SQL 推导）
- 语义: `gateway_channel_account_bindings` 加 activation_expires_at +
  激活 CHECK。
- 锁表: ACCESS EXCLUSIVE（CHECK 校验存量行）。
- 回滚: DROP COLUMN + DROP CONSTRAINT。
- N-1: 新列可空，兼容。
- Fresh install: 可重放。
- 风险: 低。

## 0024_light_viper.sql

- 状态: 归档基线（2026-08-07 审计，语义由 SQL 推导）
- 语义: `model_runs` 多租户化：session_id 改为可空 + 加
  agent_operation_id/conversation_message_id + 形状/阶段 CHECK 重排
  （删旧 CHECK 加新 CHECK）。
- 锁表: ACCESS EXCLUSIVE（约束重建 + 校验存量行）。
- 回滚: 反向 drop/add 约束，恢复 NOT NULL。
- N-1: session_id 放宽为可空，兼容；新 CHECK 形状与旧写入不兼容时
  迁移会失败（存量行需满足新形状）。
- Fresh install: 可重放。
- 风险: 中——CHECK 形状为模型运行时契约，改契约需同批改写入方。

## 0025_perfect_zemo.sql

- 状态: 归档基线（2026-08-07 审计，语义由 SQL 推导）
- 语义: `turn_context_snapshots` 同 0024 模式：session_id/turn_id 可空
  - agent_operation_id + scope CHECK + 操作唯一。
- 锁表: ACCESS EXCLUSIVE（约束重建）。
- 回滚: 反向操作。
- N-1: 放宽可空，兼容。
- Fresh install: 可重放。
- 风险: 低。

## 0026_furry_the_call.sql

- 状态: 归档基线（2026-08-07 审计，语义由 SQL 推导）
- 语义: `tool_calls` 同模式：session_id/turn_id/teaching_state 可空 +
  agent_operation_id + scope CHECK + 索引。
- 锁表: ACCESS EXCLUSIVE（约束重建）。
- 回滚: 反向操作。
- N-1: 放宽可空，兼容。
- Fresh install: 可重放。
- 风险: 低。

## 0027_conscious_risque.sql

- 状态: 归档基线（2026-08-07 审计，语义由 SQL 推导）
- 语义: 新增 `tool_effects`（工具副作用账本，操作 key / 调用唯一）。
- 锁表: 无用户表锁（CREATE）。
- 回滚: DROP TABLE/INDEX。
- N-1: 全新表，兼容。
- Fresh install: 可重放。
- 风险: 低。

## 0028_glamorous_whistler.sql

- 状态: 归档基线（2026-08-07 审计，语义由 SQL 推导）
- 语义: `model_runs` operation_shape CHECK 同形替换（形状定义更新）。
- 锁表: ACCESS EXCLUSIVE（CHECK 校验存量行）。
- 回滚: 反向同形替换。
- N-1: 同形约束，语义等价，兼容。
- Fresh install: 可重放（空库校验通过）。
- 风险: 低——存量行不满足新形状会失败。

## 0029_aspiring_ezekiel_stane.sql

- 状态: 归档基线（2026-08-07 审计，语义由 SQL 推导）
- 语义: 新增 `operation_continuations`（操作续跑/声明）+ 5 唯一索引。
- 锁表: 无用户表锁（CREATE）。
- 回滚: DROP TABLE/INDEX。
- N-1: 全新表，兼容。
- Fresh install: 可重放。
- 风险: 低。

## 0030_known_post.sql

- 状态: 归档基线（2026-08-07 审计，语义由 SQL 推导）
- 语义: 新增 `tool_approval_intents`（工具审批意图）+ 状态/过期索引。
- 锁表: 无用户表锁（CREATE）。
- 回滚: DROP TABLE/INDEX。
- N-1: 全新表，兼容。
- Fresh install: 可重放。
- 风险: 低。

## 0031_clean_songbird.sql

- 状态: 归档基线（2026-08-07 审计，语义由 SQL 推导）
- 语义: 新增 `mcp_tool_intents`（MCP 工具意图）+ 调用唯一。
- 锁表: 无用户表锁（CREATE）。
- 回滚: DROP TABLE/INDEX。
- N-1: 全新表，兼容。
- Fresh install: 可重放。
- 风险: 低。

## 0032_famous_starfox.sql

- 状态: 归档基线（2026-08-07 审计，语义由 SQL 推导）
- 语义: `operation_continuations` / `tool_approval_intents` 加
  trace_parent + 格式 CHECK（OpenTelemetry trace 上下文）。
- 锁表: ACCESS EXCLUSIVE（加列 + CHECK）。
- 回滚: DROP COLUMN + DROP CONSTRAINT。
- N-1: 新列可空，兼容。
- Fresh install: 可重放。
- 风险: 低。

## 0033_crazy_misty_knight.sql

- 状态: 归档基线（2026-08-07 审计，语义由 SQL 推导）
- 语义: 新增 `tool_effect_reconciliations`（副作用对账）；
  `tool_effects` 加 reconciliation_verifier_id + 文本 CHECK 同形替换。
- 锁表: ACCESS EXCLUSIVE（CHECK 校验）。
- 回滚: DROP TABLE/COLUMN/CONSTRAINT。
- N-1: 新列可空，兼容。
- Fresh install: 可重放。
- 风险: 低。

## 0034_dapper_tag.sql

- 状态: 归档基线（2026-08-07 审计，语义由 SQL 推导）
- 语义: 学习诊断域：`learner_profiles` / `learning_goals` /
  `learning_objectives` / `diagnostic_attempts` / `diagnostic_responses`
  五表 + 目标/节点唯一索引。
- 锁表: 无用户表锁（CREATE）。
- 回滚: DROP TABLE/INDEX。
- N-1: 全新表，兼容。
- Fresh install: 可重放。
- 风险: 低。

## 0035_curvy_justin_hammer.sql

- 状态: 归档基线（2026-08-07 审计，语义由 SQL 推导）
- 语义: Web 登录体系：`web_user_profiles` / `web_user_credentials`
  （用户名唯一）/ `web_sessions`（token hash 唯一）。
- 锁表: 无用户表锁（CREATE）。
- 回滚: DROP TABLE/INDEX。
- N-1: 全新表，兼容。
- Fresh install: 可重放。
- 风险: 高——凭证表为安全敏感表，回滚与迁移必须审计；
  token 只存 hash，勿改存明文。

## 0036_empty_banshee.sql

- 状态: 归档基线（2026-08-07 审计，语义由 SQL 推导）
- 语义: 资产处理/审计域 + 全局唯一化：新增
  `asset_processing_jobs` / `asset_representations` /
  `object_deletion_outbox` / `security_audit_events` 四表 + 索引；
  各业务表加 id 域内唯一约束（conversations_id_space_unique 等）；
  删除四个旧单列 FK（由 0037 复合 FK 取代）。
- 锁表: ACCESS EXCLUSIVE（删 FK + 建唯一约束校验存量）。
- 回滚: DROP TABLE/INDEX/CONSTRAINT；恢复被删 FK（见 0037 复合 FK）。
- N-1: ⚠️ 0036 单独部署会短暂失去四个 FK 引用完整性，必须与 0037
  同批发布；唯一约束会拒绝存量重复行。
- Fresh install: 可重放。
- 风险: 高——跨迁移依赖（0036+0037 必须同批），且唯一约束
  对存量数据的校验可能失败（需先清理重复）。

## 0037_aromatic_true_believers.sql

- 状态: 归档基线（2026-08-07 审计，语义由 SQL 推导）
- 语义: 八个复合 FK scope 约束（conversation↔notebook、操作↔会话、
  session↔student、goal↔student、objective↔goal 等），把引用完整性
  从单列升级为多租户复合键。
- 锁表: ACCESS EXCLUSIVE（FK 校验存量行）。
- 回滚: DROP CONSTRAINT ×8。
- N-1: ⚠️ 与 0036 同批发布（0036 已删旧 FK）；单独回滚 0037 会恢复
  单列 FK 缺失状态。
- Fresh install: 可重放。
- 风险: 高——复合 FK 对存量数据校验（列值组合必须存在），
  脏数据会失败；必须与 0036 成对部署。

## 0038_mighty_shen.sql

- 状态: 归档基线（2026-08-07 审计，语义由 SQL 推导）
- 语义: `artifacts` 加 creation_idempotency_key /
  creation_request_fingerprint + 创建幂等唯一约束。
- 锁表: ACCESS EXCLUSIVE（唯一约束校验存量）。
- 回滚: DROP COLUMN ×2 + DROP INDEX。
- N-1: 新列可空，兼容；唯一约束拒绝存量重复创建键。
- Fresh install: 可重放。
- 风险: 中——幂等键为创建请求契约，改指纹计算方式需同批改应用。

## 0039_little_dreaming_celestial.sql

- 状态: 归档基线（2026-08-07 审计，语义由 SQL 推导）
- 语义: 新增 `notebook_asset_bindings`（笔记本-资产绑定，变更序 + 突变
  唯一）。
- 锁表: 无用户表锁（CREATE）。
- 回滚: DROP TABLE/INDEX。
- N-1: 全新表，兼容。
- Fresh install: 可重放。
- 风险: 低。

## 0040_brave_domino.sql

- 状态: 归档基线（2026-08-07 审计，语义由 SQL 推导）
- 语义: `model_runs` 三组 CHECK 同形替换（operation_shape/phase/text
  形状更新）。
- 锁表: ACCESS EXCLUSIVE（CHECK 校验存量行）。
- 回滚: 反向同形替换。
- N-1: 同形约束，语义等价，兼容。
- Fresh install: 可重放。
- 风险: 低——存量行不满足新形状会失败。

## 0041_unusual_paper_doll.sql

- 状态: 归档基线（2026-08-07 审计，语义由 SQL 推导）
- 语义: `canvas_artifacts` 加 platform_artifact_id /
  platform_artifact_version_id + 平台工件对 CHECK + 唯一索引。
- 锁表: ACCESS EXCLUSIVE（CHECK 校验存量）。
- 回滚: DROP COLUMN ×2 + DROP CONSTRAINT + DROP INDEX。
- N-1: 新列可空，兼容。
- Fresh install: 可重放。
- 风险: 低。

## 0042_absurd_wild_pack.sql

- 状态: 归档基线（2026-08-07 审计，语义由 SQL 推导）
- 语义: `canvas_artifacts` 加 platform_version_scope 复合 FK
  （platform_artifact_version_id + platform_artifact_id 指向
  artifact_versions(id, artifact_id)，ON DELETE SET NULL）。
- 锁表: ACCESS EXCLUSIVE（FK 校验存量）。
- 回滚: DROP CONSTRAINT。
- N-1: 新 FK 只约束新写入组合，兼容。
- Fresh install: 可重放。
- 风险: 低。

## 0043_audio_transcription_pipeline.sql

- 状态: 归档基线（2026-08-07 审计，语义由 SQL 推导）
- 语义: 音频转写管线：`asset_versions` 加 transcription_text /
  transcription_metadata；asset 两类 kind CHECK 同形替换（新增
  transcribe_audio / transcription 种类）。
- 锁表: ACCESS EXCLUSIVE（加列 + CHECK 校验存量）。
- 回滚: DROP COLUMN ×2 + 反向 CHECK 替换。
- N-1: 新列可空，兼容；新 kind 值只在应用显式写入时出现。
- Fresh install: 可重放。
- 风险: 中——转写文本与元数据体积（单行大字段），查询注意避免
  无谓读取。

## 0044_pgvector_hybrid_retrieval.sql

- 状态: 归档基线（2026-08-07 审计，语义由 SQL 推导）
- 语义: 混合检索：新增 `knowledge_chunk_embeddings`（含 HNSW 向量索引）
  / `knowledge_embedding_runs` + 幂等唯一。
- 锁表: CREATE INDEX 为 SHARE 锁（阻塞写入、允许读取）；
  HNSW 索引构建耗时与数据量成正比。
- 回滚: DROP TABLE/INDEX。
- N-1: 全新表，兼容。
- Fresh install: 可重放（依赖 pgvector 扩展，见扩展创建位置）。
- 风险: 中——HNSW 索引构建资源消耗；向量维度/距离函数契约后续
  变更需重建索引。

## 0045_fk_index_audit.sql

- 状态: 归档基线（2026-08-07 审计，语义由 SQL 推导）
- 语义: FK 索引审计：补齐 24 个外键列索引，删除 4 个冗余/低效索引
  （conversation_message_citations_message_idx、
  gateway_operation_events_resume_idx、notebook_asset_bindings_latest_idx、
  session_source_bindings_latest_idx）。
- 锁表: CREATE INDEX 为 SHARE 锁；DROP INDEX 为 ACCESS EXCLUSIVE。
- 回滚: 反向删除/重建索引。
- N-1: 纯索引变更，兼容（删索引只影响查询计划）。
- Fresh install: 可重放。
- 风险: 低——删除索引后依赖该索引的查询路径变慢（已由替代索引覆盖，
  审计结论）。

## 0046_video_source_pipeline.sql

- 状态: 归档基线（2026-08-07 审计，语义由 SQL 推导）
- 语义: 视频源管线：新增 `asset_video_keyframes`（版本+算法+序唯一）；
  asset kind CHECK 与 outbox source CHECK 同形替换（新增视频种类）。
- 锁表: ACCESS EXCLUSIVE（CHECK 校验存量）。
- 回滚: DROP TABLE/INDEX/CONSTRAINT + 反向 CHECK。
- N-1: 全新表兼容；新 kind 只在显式写入时出现。
- Fresh install: 可重放。
- 风险: 中——keyframe 大字段体积，注意查询模式。

## 0047_illegal_dorian_gray.sql

- 状态: 归档基线（2026-08-07 审计，语义由 SQL 推导）
- 语义: 新增 `web_runtime_runs`（Web 运行时执行记录，request/runtime
  唯一）+ 4 索引。
- 锁表: 无用户表锁（CREATE）。
- 回滚: DROP TABLE/INDEX。
- N-1: 全新表，兼容。
- Fresh install: 可重放。
- 风险: 低。

## 0048_eminent_thunderball.sql

- 状态: 归档基线（2026-08-07 审计，语义由 SQL 推导）
- 语义: 音频同意域：新增 `audio_consents`（subject+purpose 活跃唯一）/
  `audio_retentions`（asset_version 唯一）+ 4 索引。
- 锁表: 无用户表锁（CREATE）。
- 回滚: DROP TABLE/INDEX。
- N-1: 全新表，兼容。
- Fresh install: 可重放。
- 风险: 高——同意为合规审计事实，任何约束/列变更需法务口径确认。

## 0049_audio_consent_guards.sql

- 状态: 归档基线（2026-08-07 审计，语义由 SQL 推导）
- 语义: 音频同意守卫：5 个函数 + 5 个触发器——生效同意校验（retention
  创建时 FOR UPDATE 锁 consent 行防止过期竞态）、consent/retention
  不可变与禁删（append-only 审计事实，仅 active→revoked /
  active→deletion_requested 生命周期跳变）。
- 锁表: 无迁移期用户表锁（CREATE FUNCTION/TRIGGER）；运行期触发器对
  命中行 FOR UPDATE。
- 回滚: DROP TRIGGER ×5 + DROP FUNCTION ×5。
- N-1: 触发器从迁移完成后即生效；老代码直接 UPDATE/DELETE
  consent/retention 会被拒绝——与引用代码同批发布。
- Fresh install: 可重放。
- 风险: 高——不可变约束阻断任何修复数据的常规 UPDATE/DELETE，
  数据修复必须走受控流程。

## 0050_acoustic_killer_shrike.sql

- 状态: 归档基线（2026-08-07 审计，语义由 SQL 推导）
- 语义: Q03 预算结果表：新增 `turn_usage_budget_outcomes`（每次预算
  中断的终态事实：estimated 标记、估算成本、token/调用/耗时计数、
  breach_reason 枚举）+ 计数非负/枚举 CHECK + created_at 索引。
- 锁表: 无用户表锁（CREATE）。
- 回滚: DROP TABLE/INDEX。
- N-1: 全新表，兼容。
- Fresh install: 可重放。
- 风险: 中——只记录估算成本（estimated 标记），不得把估算当
  真实账单（Q03 边界：budget events 进 ledger，不暴露价格 key）。

## 0051_d02_core_referential_integrity.sql

- 状态: active（D02 Codex 修订，2026-08-08）
- 语义: D02 核心参照完整性收口——(1) 对 assets、lesson_sessions、budget
  三类孤儿执行 fail-closed preflight；只允许修复已审计的单条开发遗留 asset；
  (2) 删除该 asset 前，把 version/representation/keyframe 的对象键写入
  `object_deletion_outbox`；(3) 建立三条强 FK：`assets.space_id → spaces.id`
  （restrict，强制先走 tombstone + Outbox）、`lesson_sessions.student_id →
platform_users.id`（restrict）、`turn_usage_budget_outcomes.operation_id →
agent_operations.id`（cascade）；(4) 建立 `assets_space_fk_idx`。
- 锁表: 有界 repair 只锁定已审计行；FK 先 `NOT VALID` 建立再逐条
  `VALIDATE CONSTRAINT`，避免用一次长时间存量扫描维持 ACCESS EXCLUSIVE；
  普通索引创建仍取 SHARE 锁。生产规模与维护窗口由 D07 复核。
- 回滚: DROP 三条 FK 与 `assets_space_fk_idx`；Outbox 行可按三种 source_type
  与已审计 source_id 识别。已删除的 asset/version 业务行不能由回滚自动恢复，
  但物理对象删除意图可审计且不会形成静默存储泄漏。
- N-1: 合法 0050 数据可升级；已审计孤儿会先登记对象删除再移除；任何额外
  asset、lesson session 或 budget 孤儿都会在数据修改前以 SQLSTATE 23503
  中止，要求显式处置。三条 FK 生效后老代码的新孤儿写入同样被拒绝。
- Fresh install: 空库 preflight/repair 无操作，三条 FK 与索引正常建立。
- Data migration: deterministic bounded repair——fail-closed preflight 只
  允许修复已审计的单条开发遗留 asset（owner/space 均不存在、零业务引用）；
  命中时先向 `object_deletion_outbox` 登记其 version/representation/keyframe
  的对象键再删除；任何额外孤儿都会以 23503 中止，不做启发式清理。
- Estimated scale: 本地验证 36 assets / 4 lesson_sessions / 1 budget 行，
  修复目标恰 1 行；生产数据规模未验证，D07 承接。
- 风险: 中——约束验证与普通索引仍需要数据库锁；未知历史脏数据会阻止部署，
  这是刻意的 fail-closed 行为。Space 物理删除必须先完成 Asset 的显式闭包。

## 0052_damp_jigsaw.sql

- 状态: active（D03 Codex 修订，2026-08-09）
- 语义: 将 11 张表上的 13 个扩展标识 CHECK 从字面量闭集改为稳定格式
  CHECK：assets.kind/origin、asset_versions.kind、asset_representations.kind、
  asset_processing_jobs.kind、knowledge_sources.source_type、
  agent_operations.kind、object_deletion_outbox.object_kind/source_type、
  operation_sources.kind、gateway_node_invocations.capability、
  agent_message_parts shape 中的 artifact_kind、
  tool_effect_reconciliations.source。教学学段/偏好、message part type、
  model finish reason、budget breach reason 与 MCP 专用 intent capability
  经复核仍承担结构、安全或平台归一化契约，保持数据库闭集。
- 锁表: 13 对 DROP/ADD CHECK 会在 11 张表上取得短时 ACCESS EXCLUSIVE
  DDL 锁并校验存量行；无数据迁移。
- 回滚: 先停止旧闭集外写入并确认无扩展值，再执行 D03 文档 §7 的完整
  13 项反向 CHECK SQL。
- N-1: 格式 CHECK 是原闭集的超集；旧应用写入兼容，格式非法值仍以
  SQLSTATE 23514 拒绝。测试必须从 0051 升级并同时确认 D02 三条 FK 保留。
- Fresh install: 可重放。0052 不重复创建 D02 FK/index。生成时只在临时
  0051 元数据副本补齐历史 snapshot 缺失的三条 FK 与 index；历史
  `0051_snapshot.json` 未修改，最终 0052 SQL/snapshot/journal 均由 Drizzle
  生成。0051 元数据漂移由 D06 治理。
- Data migration: none——13 对 DROP/ADD CHECK 只改约束定义，不触碰业务行。
- Estimated scale: 无数据变更（0 行受影响）；生产数据规模未验证，D07 承接。
- 风险: 中——DB 只验证 open identifier 的格式，生产写入依赖应用 Registry；
  AST vocabulary gate 同时审计 231 个 Schema CHECK 与最新 Migration，防止
  新增未登记 hard enum 或以注释/等值约束绕过。

## 0053_silky_millenium_guard.sql

- 状态: active（D04 作者记录，2026-08-08）
- 语义: D04 派生结果多版本身份——asset_representations 与 asset_processing_jobs
  新增 (variant, producer, producer_version) 三列（NOT NULL DEFAULT，自动
  backfill 现有行），唯一约束从 (asset_version_id, kind) 扩展为
  (asset_version_id, kind, variant, producer, producer_version)：
  同一 AssetVersion 下不同 Provider/变体/版本的派生结果可并存且互不覆盖；
  job 与 representation 共享同一 identity，重试 = 同 job attempts 递增，
  消除入队查重 TOCTOU。新增 6 个开放格式 CHECK（variant/producer/
  producer_version，D03 词汇门禁）。
- 锁表: 每表 ADD COLUMN 取 ACCESS EXCLUSIVE 元数据短锁（表规模 28/14 行）；
  唯一索引创建期间取 SHARE 锁并校验存量（现有 (version_id, kind) 唯一是
  新唯一键的子集，无冲突）。
- 回滚: DROP 新唯一索引与 CHECK + 删除三列（数据无丢失——旧行恢复默认
  identity）；旧唯一索引重建。回退前需确认没有写入非默认 identity 的新行。
- N-1: 0052 老代码写 representation/job 时新列走 DEFAULT（default/default/v1），
  与 backfill 行 identity 一致，幂等更新语义不变。
- Fresh install: 可重放。
- Data migration: backfill——(variant, producer, producer_version) 三列
  NOT NULL DEFAULT（default/default/v1）对存量 28 行 representations 与
  14 行 processing_jobs 自动回填；无行级 UPDATE。
- Estimated scale: 本地 28 representations / 14 jobs（默认值回填，0 行
  显式变更）；生产数据规模未验证，D07 承接。
- 风险: 低——无数据迁移；唯一键扩展不拒绝任何旧合法写入。

## 0054_hot_hex.sql

- 状态: active
- 语义: 新增 `resource_annotations` 纸面批注表（Live Voice 门槛设计 M2）：
  canvas-protocol `annotate` action 的持久化实体。多态引用
  (resource_kind, resource_id) 指向 assets/artifacts（不建 FK，引用语义
  走 CanvasResource 协议），resource_version_id 记录批注面对的不可变版本；
  author_pen 区分学生的墨笔（dai）与批改的笔（zhusha）；geometry 为归一化
  坐标 jsonb；space_id 强 FK 随 Space 删除前清理（生命周期注册表第 32 项）。
- 锁表: 无用户表锁（CREATE TABLE + CREATE INDEX 只触新表；spaces 的 FK
  校验取 ACCESS EXCLUSIVE 元数据短锁，引用既有主键，无需验证存量）。
- 回滚: DROP TABLE resource_annotations，并从生命周期注册表移除第 32 项。
- N-1: 全新表，老代码不感知；无兼容性问题。
- Fresh install: 可重放。
- Data migration: none——只创建空的叶子表与索引，不读取或改写既有业务行。
- Estimated scale: 新表初始 0 行；批注按用户显式圈点增长，生产规模尚未验证。
- 风险: 低——新增叶子表，不改动任何既有表结构。

## 0055_sticky_leader.sql

- 状态: active
- 语义: 新增 `notebook_surface_positions` 私有案面快照表（门槛设计 M3）。
  主键包含 space、owner_subject、resource_kind 与 resource_id，因此协作成员
  不会覆盖彼此的注意力位置；zone/rest_state 表达中心、案边、页签和展开、折叠、
  钉住状态，x/y 使用 0..1 归一化坐标。
- 锁表: 只创建新表与索引；spaces 外键校验只读取既有主键。
- 回滚: DROP TABLE notebook_surface_positions，并移除生命周期注册项。
- N-1: 全新表，旧应用不读取也不写入，兼容。
- Fresh install: 可重放。
- Data migration: none——只创建空的私人布局表，不读取或回填既有资源。
- Estimated scale: 新表初始 0 行；上界随每位成员摆放的资源数线性增长，生产规模尚未验证。
- 风险: 低——个人布局是可重建派生状态，失败不影响资源或对话事实。

## 0056_glorious_tiger_shark.sql

- 状态: active
- 语义: ADR-0026 派生表示质量四态列与上下文选择冻结。
  `asset_representations.quality`（processing/structured/degraded_plain_text/
  failed/unavailable）表达文本派生质量：text/plain、text/markdown 直解为
  structured，pdf/docx 纯文本抽取为 degraded_plain_text；两个 CHECK 把 quality
  与 status/kind 生命周期绑死（ready+text 必为 structured 或 degraded，
  ready+非 text 必为 unavailable）。`turn_context_snapshots.
selected_asset_representations`（jsonb，DEFAULT '[]' NOT NULL）按
  selected_asset_version_ids 同序冻结实际使用的表示身份（assetId+versionId+
  representation），null=无派生表示；历史 Turn 以空数组表示未冻结。
- 锁表: 只加列与约束，不重写行；backfill UPDATE 按 asset_versions 主键
  JOIN 逐行更新 quality，行数 O(表示数)。
- 回滚: 删两列两约束；回滚后旧应用不读取新列，兼容。
- N-1: 新列可空态由 DEFAULT 兜底（'[]' / 'unavailable'），旧应用不写新列，
  读侧无影响。
- Fresh install: 可重放。
- Data migration: 有——backfill 在加列后、加 CHECK 前执行（先 backfill 再
  约束），按原文件 MIME 区分 quality，避免非空表 ADD COLUMN NOT NULL 失败
  与约束违例。
- Estimated scale: O(现有 asset_representations 行数) 的一次性 UPDATE，
  无新表。
- 风险: 低——quality 派生自既有 status/kind/mime，不引入新事实；缺外键
  JOIN 匹配的孤儿表示行保持 unavailable。

## 0057_faulty_corsair.sql

- 状态: active（CA08B，2026-08-13）
- 语义: 新增 `k12_conversation_message_projections` provenance sidecar，以
  `source_chat_message_id` 主键和 `conversation_message_id` 唯一键冻结 K12
  legacy 消息到平台消息的一对一映射，并记录 session/conversation 作用域。
  新 begin 与受信 operator backfill 在同一事务插入或验证映射；settle 只允许
  已存在的两侧事实继续收敛。
- 锁表: 仅 CREATE TABLE 与两个普通索引，不改既有表、不扫描或锁定历史消息表。
- 回滚: 切回 `legacy` 并重启；配置回退不删除 sidecar，因为当前应用的 settle 与审计路径仍会
  读取它。只有先回滚到完全不引用该表的旧应用，并通过独立 migration 与批准后才能 drop。
  回滚不删除 `chat_messages`、`conversation_messages`、引用、教学运行态或 provenance 证据。
- N-1: 全新无外键表，旧应用不读取也不写入；部署后需由受信 operator 运行
  bounded backfill，为既有已验证副本补映射，完成全量 missing/mismatch/orphan
  零差异证据前不得启用 platform authority。
- Fresh install: 可重放；表初始为空，新写入由应用事务建立 provenance。
- Data migration: none——历史映射不能由 DDL 猜测；使用已有确定性 ID 的受控
  repository backfill，发现 mismatch 或并发部分写时整页回滚。
- Estimated scale: 每条 K12 可见消息一条窄映射；实际生产规模尚未验证。
- 风险: 中——刻意不为两侧消息加级联 FK，否则删除一侧会抹掉 orphan/missing
  审计证据。匿名主体删除闭包显式先删 sidecar；日常一致性由双唯一键、原子写入
  与 parity/read fail-closed 共同保证。

## 0058_overrated_cyclops.sql

- 状态: active（网页导入与 Deep Research，2026-08-17）
- 语义: 新增 `asset_web_snapshots` 版本级网页溯源表，以
  `asset_version_id` 作为主键和外键，保存请求 URL、最终 URL、响应类型、页面标题
  与抓取时间；原始响应正文仍由对应 `asset_versions.storage_key` 指向私有对象。
- 锁表: 仅创建新表与普通时间索引；新增指向 `asset_versions` 的外键只读取既有
  主键，不改写历史 AssetVersion。
- 回滚: 停止写入和读取网页溯源后 DROP TABLE `asset_web_snapshots`；资产原始对象、
  已抽取正文与引用事实不删除，但将失去版本级网页来源元数据。
- N-1: 全新可选子表，旧应用不读取也不写入；新应用只为网页版本写 sidecar，
  因此旧应用可继续读取既有 Asset 与 AssetVersion。
- Fresh install: 可重放；表初始为空，网页导入或研究来源创建时与版本同事务写入。
- Data migration: none——不根据历史 displayName 或正文猜测 URL，不回填旧网页资产。
- Estimated scale: 新表初始 0 行；每个新抓取网页版本至多 1 行，随网页版本数线性增长；
  生产规模尚未验证。
- 风险: 低——新增叶子表，不改变既有状态机；URL 和文本长度由 CHECK 与仓储双重约束，
  跨空间读取仍先校验 Notebook 权限。

## 0059_clumsy_lady_bullseye.sql

- 状态: active（DP08，2026-08-17）
- 语义: 为 `gateway_handoff_tokens` 新增可空 `target` jsonb 列，承载一次性精确
  Web handoff 的 message、artifact 或 resource 目标；开放形状 CHECK 只允许 null
  或对象，具体目标仍由服务端契约解析与归属校验。
- 锁表: `ALTER TABLE ADD COLUMN` 与 `ADD CONSTRAINT` 获取短时 ACCESS EXCLUSIVE
  元数据锁；列可空且默认 null，不回写历史凭证。
- 回滚: 先回滚应用到不读取 target 的版本，再由后续 migration 删除 CHECK 与列；
  不修改或删除已消费、过期及未消费的 handoff 审计事实。
- N-1: 旧应用不写 target 时继续得到 null；新应用把 null 解释为原有的对话级 handoff，
  因此滚动部署期间保持向后兼容。
- Fresh install: 可重放；0058 网页快照先建立，0059 再增量扩展 handoff 表。
- Data migration: none——历史凭证保持 null，不从消息或资源记录反推目标。
- Estimated scale: 每条新 handoff 凭证至多一个窄 jsonb 对象，与凭证表行数线性增长；
  生产规模尚未验证。
- 风险: 低——数据库只约束 JSON 顶层形状；issue/consume 路径仍按用户、空间、会话
  与资源归属 fail closed，浏览器不能伪造服务端授权目标。

## 0060_funny_vengeance.sql

- 状态: active（WS06，2026-08-22）
- 语义: 新增 `research_checkpoints`，按 Operation 保存 Deep Research 的版本化、
  有界执行游标：四个非终态阶段、最多 5 个已完成规范化查询与 15 个候选 URL；
  Operation 终态、Source 和 Citation 仍由既有权威表维护。
- 锁表: 仅创建新叶子表并增加指向 `agent_operations` 的级联外键，不改写历史行。
- 回滚: 先回滚应用到不读写研究检查点的版本，再 DROP TABLE；已有 Operation、
  Gateway Event、Source、Citation 和消息事实不受影响。
- N-1: 旧应用忽略新表并继续完成普通 Turn；新应用只为 `deep_research` 写入，
  滚动部署期间不会要求旧实例理解新的公开事件或终态。
- Fresh install: 可重放；表初始为空，研究 Operation 启动时按需创建。
- Data migration: none——不从 Tool Call 摘要、Prompt 或历史消息猜测查询与候选 URL。
- Estimated scale: 每个研究 Operation 至多 1 行，两个 JSONB 数组分别上限 5 与 15。
- 风险: 低——仓储逐项校验查询与公开 URL，浏览器投影只返回计数、阶段及派生的
  Source/Citation 序号，不返回原始查询或候选 URL。
