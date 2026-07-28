# 外键删除策略与索引审计

- 状态：`accepted`
- 最后验证时间：2026-07-27
- 对应迁移：`packages/db/drizzle/0045_fk_index_audit.sql`

本文记录一次证据化审计的判定依据与结论。它不是「把所有外键都加上索引」的清单，
恰恰相反：审计的目的是把「确实会造成问题的关系」与「看起来该加索引但实际不会被
执行到的关系」区分开。

## 审计方法

### 判定 1：外键删除策略是否正确

对每条外键回答三个问题：父实体被删除时，子行应当**跟着消失**（cascade）、
**阻止删除**（restrict / no action），还是**断开挂接但保留**（set null）？

审计结论：**114 条外键中没有一条的删除策略需要修改**。因此本次迁移不含任何
`ALTER TABLE ... DROP CONSTRAINT / ADD CONSTRAINT`。

### 判定 2：外键索引是否真的需要

父行删除时，PostgreSQL 会对每条被删行在子表上执行一次等值探测：

```sql
SELECT 1 FROM child x WHERE $1 = x.fk_col FOR KEY SHARE OF x
```

子表若**没有任何以外键列开头的索引**，该探测退化为顺序扫描，并在删除期间放大
锁窗口。这是唯一被本次审计接受的加索引理由——「这个字段看起来常用」不是理由。

因此一条外键只有同时满足两个条件才会被加索引：

1. **父表存在真实的生产删除路径**；
2. **子表没有任何以该外键任一列开头的非部分索引**。

条件 2 用「以任一外键列开头」而不是「完整覆盖外键列序」判定：复合外键的探测是
对所有列的等值条件，一个以其中任一列开头的索引已经足以把顺序扫描变成索引扫描 +
过滤。按完整列序判定会多加十几条毫无收益的索引。

## 证据 1：哪些父表真的会被删除

代码中的删除路径只有三处（`grep -rn "\.delete("`，排除测试）：

| 路径               | 文件                                | 删除的父表                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------ | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 匿名主体保留期清理 | `anonymous-data-lifecycle.ts`       | spaces、conversations、agent_operations、operation_sources、artifacts、artifact_versions、artifact_generation_jobs、conversation_messages、conversation_message_citations、lesson_sessions、chat_messages、agent_message_parts、assets、asset_versions、model_runs、tool_calls、canvas_artifacts、canvas_artifact_grading_keys、retrieval_candidates、turn_source_versions、turn_source_snapshots、session_source_bindings、learning_events、mastery_states、turn_safety_decisions、message_citations |
| 匿名学习数据清理   | `anonymous-study-data-lifecycle.ts` | diagnostic_responses、diagnostic_attempts、learning_objectives、learning_goals、learner_profiles                                                                                                                                                                                                                                                                                                                                                                                                      |
| 学习引导补偿回滚   | `study-bootstrap-compensator.ts`    | canvas_artifacts、lesson_sessions、conversations、spaces                                                                                                                                                                                                                                                                                                                                                                                                                                              |

**从不被删除的父表**：`platform_users`、`personal_agents`、`knowledge_sources`、
`knowledge_documents`、`knowledge_chunks`。指向它们的外键因此不需要支撑索引——
其中 `knowledge_chunks` 另有不可变触发器，物理上也无法删除。

这条判定把候选从「50 条无索引外键」收敛到「28 条」。被排除的 22 条不是被忽略，
而是被证明不会执行到删除路径。

## 证据 2：EXPLAIN 与实测代价

在同结构的隔离库上构造 5 000 父行 / 100 000 子行（每父 20 子），删除 500 个父行：

| 场景                      | 耗时        | FK 探测计划                                |
| ------------------------- | ----------- | ------------------------------------------ |
| 无支撑索引                | **903 ms**  | `Seq Scan on fk_child`                     |
| 建立 `(parent_id)` 索引后 | **4.75 ms** | `Bitmap Index Scan on fk_child_parent_idx` |

同一删除相差约 **190 倍**，且顺序扫描期间对整张子表持锁。匿名清理任务按主体批量
删除，父行数量随保留期线性增长，这个差距会直接决定清理任务能否在窗口内完成。

## 结论 1：新增 25 条外键支撑索引

命名统一为 `*_fk_idx`，只服务外键强制查询，不服务任何业务读取。

| 子表                            | 索引列                  | 父表                          | 删除策略  |
| ------------------------------- | ----------------------- | ----------------------------- | --------- |
| agent_message_parts             | asset_id                | assets                        | no action |
| agent_operations                | notebook_id             | spaces                        | restrict  |
| artifact_generation_jobs        | operation_id            | agent_operations              | set null  |
| artifact_versions               | created_by_operation_id | agent_operations              | set null  |
| assets                          | current_version_id      | asset_versions                | set null  |
| canvas_artifacts                | platform_artifact_id    | artifacts / artifact_versions | set null  |
| conversation_message_citations  | operation_source_id     | operation_sources             | cascade   |
| delegated_grants                | notebook_id             | spaces                        | cascade   |
| diagnostic_attempts             | session_id              | lesson_sessions               | cascade   |
| diagnostic_responses            | objective_id            | learning_objectives           | restrict  |
| gateway_approvals               | operation_id            | agent_operations              | cascade   |
| gateway_channel_thread_bindings | conversation_id         | conversations                 | set null  |
| gateway_channel_thread_bindings | notebook_id             | spaces                        | cascade   |
| gateway_handoff_tokens          | conversation_id         | conversations                 | cascade   |
| gateway_node_invocations        | operation_id            | agent_operations              | cascade   |
| learning_goals                  | notebook_id             | spaces                        | cascade   |
| lesson_sessions                 | conversation_id         | conversations                 | restrict  |
| mcp_tool_intents                | operation_id            | agent_operations              | cascade   |
| message_citations               | retrieval_candidate_id  | retrieval_candidates          | cascade   |
| model_runs                      | assistant_message_id    | chat_messages                 | cascade   |
| model_runs                      | conversation_message_id | conversation_messages         | cascade   |
| notebook_asset_bindings         | asset_id                | assets                        | cascade   |
| retrieval_candidates            | turn_source_version_id  | turn_source_versions          | cascade   |
| tool_approval_intents           | operation_id            | agent_operations              | cascade   |
| turn_context_snapshots          | agent_operation_id      | agent_operations              | cascade   |

`canvas_artifacts (platform_artifact_id)`、`diagnostic_attempts (session_id)`、
`diagnostic_responses (objective_id)` 各自同时覆盖了一条单列外键和一条以同列参与的
复合外键，因此各只建一条索引而不是两条。

### 写放大取舍

高写入子表只有 `model_runs`、`conversation_message_citations`、`retrieval_candidates`、
`agent_message_parts`。它们恰好也是删除时需要扫描行数最多的表，多一条 btree 的插入
成本换掉一次全表扫描是划算的。其余子表（`gateway_*`、`delegated_grants`、
`diagnostic_*`）写入频率很低，索引成本可以忽略。

## 结论 2：删除 4 条重复索引

它们与既有唯一索引列序完全相同或构成其左前缀，不改变任何查询计划，只增加写放大：

| 删除的索引                                 | 被谁覆盖                                               | 关系             |
| ------------------------------------------ | ------------------------------------------------------ | ---------------- |
| conversation_message_citations_message_idx | conversation_message_citations_message_source_unique   | 严格左前缀       |
| gateway_operation_events_resume_idx        | gateway_operation_events_sequence_unique               | 列与顺序完全相同 |
| notebook_asset_bindings_latest_idx         | notebook_asset_bindings_subject_asset_sequence_unique  | 列与顺序完全相同 |
| session_source_bindings_latest_idx         | session_source_bindings_session_source_sequence_unique | 列与顺序完全相同 |

## 结论 3：明确不新增的索引

以下字段被审计过并**判定无需索引**，记录在此以免日后被重复提出：

- `tool_calls (answer_model_run_id)`：已被复合索引
  `tool_calls (answer_model_run_id, provider_tool_call_id)` 的左前缀覆盖；
- 所有指向 `platform_users`、`personal_agents` 的外键：父表无删除路径；
- 所有指向 `knowledge_sources`、`knowledge_documents`、`knowledge_chunks` 的外键：
  父表无删除路径，且 chunk 另有不可变触发器；
- `retrieval_candidates (chunk_id, document_id)`、
  `knowledge_chunk_embeddings (chunk_id, document_id)`：同上。

## 删除策略逐关系说明（重点关系）

保持 cascade 的审计事实类关系，理由都不是「方便」：

- `model_runs → chat_messages` / `→ conversation_messages`（cascade）：模型运行账本的
  审计价值绑定在它所属的消息上。消息本身已被删除后保留孤儿 run 不产生可审计价值，
  却会违反匿名数据删除承诺。清理任务实际也按子→父顺序显式删除，cascade 只是兜底。
- `turn_context_snapshots → agent_operations`（cascade）：同上，上下文快照的意义完全
  依附于对应 Operation。
- `message_citations → retrieval_candidates`（cascade）：引用只在候选白名单存在时有效，
  候选消失后引用无法解释来源，保留即制造无法追溯的引用。

保持 restrict / no action 的关系，理由是**证据不得被顺手删除**：

- `learning_events → lesson_sessions`（restrict）：可信学习证据不能因删会话而静默消失，
  必须由显式清理路径按顺序处理。
- `lesson_sessions → conversations`（restrict）：会话必须先于所属 Conversation 被处理，
  避免留下无法定位的教学记录。
- `agent_message_parts → assets`（no action）：消息片段引用的资产不能在片段仍存在时被
  删除，否则历史消息会指向不存在的内容。
- `retrieval_candidates → knowledge_chunks`（no action）：教材切块是不可变事实，候选
  必须始终能解释自己引用了哪一段。

保持 set null 的关系，理由是**长期身份不应随触发它的操作消失**：

- `artifacts → conversations`、`artifact_generation_jobs → agent_operations`、
  `artifact_versions → agent_operations`、`canvas_artifacts → artifacts/artifact_versions`：
  产物是跨对话长寿的一等公民，删除对话只应断开挂接，不应带走产物本体。
- `assets → asset_versions`（current_version_id）：当前版本指针是可重算的缓存字段。

## 生产升级锁风险

`CREATE INDEX` 持有 ShareLock 阻塞子表写入。当前各表规模下窗口可以忽略；若某个部署
的 `model_runs` / `conversation_messages` 已达千万级，应先在迁移窗口外用
`CREATE INDEX CONCURRENTLY` 建同名索引，再应用迁移。迁移器在事务内运行，无法直接
使用 `CONCURRENTLY`。

## 复核方法

审计结论可以随时重算——两条查询分别验证「无遗漏」与「无重复」，期望结果都是空集：

```sql
-- 1. 父表有删除路径但子表缺支撑索引的外键（期望：0 行）
with deleted_parents(relname) as (values ('spaces'), ('conversations') /* …见上表 */),
fk as (
  select con.conname, src.relname as child_table, tgt.relname as parent_table, con.conrelid,
    (select array_agg(att.attname order by k.ord)
       from unnest(con.conkey) with ordinality k(attnum, ord)
       join pg_attribute att on att.attrelid = con.conrelid and att.attnum = k.attnum) as cols
  from pg_constraint con
  join pg_class src on src.oid = con.conrelid
  join pg_class tgt on tgt.oid = con.confrelid
  where con.contype = 'f' and src.relnamespace = 'public'::regnamespace
),
lead as (
  select i.indrelid, att.attname as leadcol, i.indpred is not null as partial
  from pg_index i
  join pg_attribute att on att.attrelid = i.indrelid and att.attnum = (i.indkey::int2[])[0]
)
select fk.child_table, fk.cols, fk.parent_table
from fk join deleted_parents dp on dp.relname = fk.parent_table
where not exists (
  select 1 from lead
  where lead.indrelid = fk.conrelid and not lead.partial and lead.leadcol = any(fk.cols));

-- 2. 被其他索引完全覆盖的重复索引（期望：0 行）
-- 见 packages/db/src/fk-index-audit.integration.test.ts，该测试固化了这两条断言。
```

`packages/db/src/fk-index-audit.integration.test.ts` 把上述两条断言固化为集成测试，
新增外键或索引时会自动复核，不需要人工重跑本文。
