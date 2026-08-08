# 数据权威、扩展性、迁移与数据库健康收敛

- 任务分配名：`D 数据架构收敛`
- 状态：`PENDING`
- 负责人：项目负责人
- 实现执行：协作 Agent，每次只领取一个原子任务
- 代码审核与最终验收：Codex
- 计划建立时间：2026-08-07
- 当前领取任务：无
- 前置门禁：`R` 已完成；`W`、`Q` 必须完成最终审核并归档后才能执行 `D00`
- 前置计划：
  - `R 运行时收敛`：completed
  - `W 工作面画布`：已收口（2026-08-08 W06/W07 合并，待归档）
  - `Q 质量观测成本`：completed（2026-08-07 归档）
- 后续功能阶段：
  - `UV 画布语音`
  - `KM 知识记忆`
  - `PET Agent Presence / 桌宠`（独立功能线，待建立正式计划）
- 阶段出口：`Core Architecture Freeze → Feature Development Phase`

---

# 一、为什么现在需要 D 线

R、W、Q 三条线分别解决：

```text
R
Runtime / Authority / Boundary

W
Workspace / State / Renderer / Frontend Boundary

Q
Quality / Observability / Cost / Release Evidence
```

它们完成以后，EduCanvas 的运行时、前端工作面和质量体系基本收敛。

接下来项目将进入：

> **快速、多功能、多人并行开发阶段。**

后续预计持续增加：

- Memory；
- Product Knowledge；
- Voice；
- Agent Presence / 桌宠；
- 新 Artifact；
- 新 Tool；
- 新 Source；
- 新 Agent Profile；
- 新 Channel；
- 新 Runtime；
- 更多多模态处理；
- 更多 Notebook 能力。

这一阶段最大的风险已经不是“现有功能能不能运行”，而是：

> **每新增一个功能，会不会开始修改核心表、增加平行事实、扩散 JSONB、复制 Repository、产生 migration 冲突，并最终重新破坏 R 线已经建立的单一权威。**

因此 D 不是第三轮数据库重构。

D 的目标是：

> **在功能爆发前最后一次确认并冻结 Stable Data Kernel，使未来大多数新功能可以挂接在稳定的数据骨架上，而不持续修改核心事实模型。**

D 完成后原则上不再开启新的“大范围基础架构优化线”。

---

# 二、D 线最终必须回答的问题

阶段结束后必须能明确回答：

1. 每一种长期业务事实到底由哪张表、哪个 Repository、哪个服务拥有；
2. 哪些表是权威事实，哪些只是 Projection、Ledger、Audit、Cache 或 Derivation；
3. 所有核心父子关系是否有数据库级参照完整性；
4. 是否存在孤儿行、隐式 owner、无 FK 的长期引用或重复事实；
5. 哪些类型属于封闭状态机，哪些属于未来不断扩展的 Registry；
6. 新 Artifact / Tool / Processor / Capability 是否可以在不修改数据库枚举的情况下增加；
7. 同一个 AssetVersion 是否能够同时保存多个 Provider / Algorithm 的派生结果而不互相覆盖；
8. 新增 Feature 是否默认复用 Space、Conversation、Operation、Asset、Artifact、Ledger，而不是新增平行根实体；
9. 数据迁移是否支持多人分支开发、fresh install、N-1 upgrade 和回退；
10. 当前真实 PostgreSQL 是否存在明显索引、锁、表膨胀或高频查询结构问题；
11. 新表是否必须声明 owner、authority、retention、deletion、privacy 和 migration contract；
12. 数据层完成后能否宣布：

```text
Stable Data Kernel
        ↓
Feature A
Feature B
Feature C
Feature D
```

而不是：

```text
Feature A → 改核心 Schema
Feature B → 改核心 Schema
Feature C → 改核心 Schema
Feature D → 再改核心 Schema
```

---

# 三、当前已经确认的数据架构优势

以下结构原则默认保留，不在 D 线重新设计。

## 3.1 单 PostgreSQL + 模块化单体

继续保留：

```text
PostgreSQL
+
Drizzle
+
Graphile Worker
+
Modular Monolith
```

不拆数据库服务。

不引入：

- MongoDB；
- Redis 作为新事实源；
- Kafka；
- Event Bus；
- 微服务数据库；
- 第二 ORM。

物理同库不代表领域同层。

---

## 3.2 Stable Platform Core

当前长期稳定骨架：

```text
platform_users
        │
personal_agents
        │
      spaces
     /      \
 assets    conversations
    │            │
 versions   agent_operations
                  │
        ┌─────────┼─────────┐
        ▼         ▼         ▼
     Context    Model      Tool
                           │
                         Effect

spaces
  │
artifacts
  │
artifact_versions
```

这是未来 Feature 必须优先挂接的稳定根实体。

---

## 3.3 不可变版本模式

继续冻结：

```text
Asset
↓
AssetVersion

Artifact
↓
ArtifactVersion

KnowledgeSource
↓
KnowledgeDocument
↓
KnowledgeChunk
↓
Embedding
```

禁止重新退回：

```text
asset.text = ...
artifact.content = ...
```

然后覆盖旧历史的模型。

---

## 3.4 Agent Ledger 分层

继续保持：

```text
Operation
Context Snapshot
Model Run
Tool Call
Tool Effect
Reconciliation
Safety Decision
Usage Budget
```

它们承担不同事实。

禁止把它们重新压成：

```text
agent_events(payload JSONB)
```

这种万能事件表。

---

## 3.5 Repository / DB Boundary

继续保持：

```text
Feature
↓
Application / Repository Contract
↓
@educanvas/db
↓
Drizzle
↓
PostgreSQL
```

生产 Feature 禁止：

```ts
getDb()
db.insert(...)
```

直接操作数据库。

`@educanvas/db/internal` 只允许受控 Composition Root 使用。

---

## 3.6 RAG 版本模型

继续保留：

```text
Chunk
+
Embedding Model
+
Model Version
+
Instruction
+
Chunking Version
+
Content Hash
```

同一 Chunk 不同 Embedding 身份允许并存。

D 线不得为了“统一”破坏这一结构。

---

# 四、当前已经识别的主要数据风险

## D-RISK-01：Asset → Space 参照完整性仍处迁移状态

当前 `assets.spaceId` 是核心长期归属字段，但历史兼容原因使它没有完全收紧为稳定 Workspace FK。

进入快速 Feature Phase 后：

```text
Memory
Source
Voice
Artifact
Research
Pet
```

都会越来越依赖 Notebook / Space。

因此该关系必须在 D 中做最终结论：

```text
能够收紧
→ 完成 FK

暂时无法收紧
→ 明确阻塞原因、退出条件和禁止新增的兼容模式
```

不得无限期保持“以后再处理”。

---

## D-RISK-02：预算账本与 Operation 的完整性

`turn_usage_budget_outcomes` 本质上从属于 Agent Operation。

D 必须检查：

```text
Budget Outcome
→ Agent Operation
```

是否由数据库级 FK 强制。

任何没有独立生命周期的 Ledger 都不得产生孤儿事实。

---

## D-RISK-03：Asset 派生结果未来可能发生字段爆炸

当前已经出现：

```text
extractedText
transcriptionText
transcriptionMetadata
asset_representations
keyframes
```

未来还可能增加：

```text
OCR
Cloud transcription
Local transcription
Corrected transcription
Translation
Table extraction
Vision caption
Diagram extraction
Preview variants
```

禁止最终演化成：

```text
ocrText
cloudTranscriptionText
localTranscriptionText
correctedTranscriptionText
translatedText
...
```

D 必须建立统一、版本化、可并存的 Derivation / Representation 模型。

---

## D-RISK-04：开放能力类型被数据库 CHECK 写死

必须区分：

### Closed Vocabulary

必须由数据库严格限制：

```text
status
approval risk
tool effect
security outcome
consent purpose
terminal state
```

### Open Registry

未来持续增加的类型不应每次 migration：

```text
Artifact kind
Tool capability
Processor kind
Renderer kind
Model alias
Agent profile
Derivation producer
```

目标模式：

```text
namespaced identifier
+
format CHECK
+
Application Registry
```

---

## D-RISK-05：核心 schema 源码文件并行开发冲突

物理 PostgreSQL 可以保持单库。

但 Drizzle 源码应进一步按领域拆分。

目标不是改变表。

目标是降低：

```text
多人开发
+
多个 Coding Agent
+
多个 Feature Branch
```

同时修改一个巨大 `schema.ts` 的冲突概率。

---

## D-RISK-06：Migration 数量进入快速增长期

现有迁移历史已经形成长期链。

Q06 已开始建立 migration evidence 和供应链门禁。

D 不重新实现 Q06，而是在其基础上冻结：

```text
多人 Migration 工作流
Fresh install
N-1 upgrade
Rollback
Lock risk
Migration ownership
```

---

## D-RISK-07：源码健康 ≠ 真实 PostgreSQL 健康

现有 Schema / Repository / Integration Test 很强。

但还必须真正看：

```text
pg_stat_user_tables
pg_stat_user_indexes
relation size
index size
locks
dead tuples
critical query plans
```

否则只能证明：

> 数据模型结构合理。

不能证明：

> 当前真实数据库运行健康。

---

# 五、绝对文件边界

## 允许修改

### 数据定义

```text
packages/db/src/schema.ts
packages/db/src/schema/**
packages/db/src/*repository*
packages/db/src/*data*
packages/db/src/import-boundary.test.ts
packages/db/package.json
```

### Migration

```text
packages/db/drizzle/**
packages/db/drizzle/MIGRATIONS.md
```

### 数据质量工具

```text
tooling/quality/**
tooling/db/**
```

### DB 测试

```text
packages/db/**/*.test.ts
tests/integration/**
```

仅允许与 D 线数据契约直接相关部分。

### 文档

```text
docs/04-data/**
docs/09-decisions/**
docs/plan/active/D-数据架构与扩展性收敛.md
```

### CI

仅 D06/D08 必要时：

```text
.github/workflows/**
```

---

# 六、默认禁止

D 线不得：

- 实现 Memory 产品功能；
- 实现 Product Knowledge；
- 实现 Voice；
- 实现桌宠；
- 新增 Artifact 产品类型；
- 新增 Tool 产品能力；
- 修改 Canvas UI；
- 修改 Workspace UI；
- 创建第二数据库；
- 拆微服务；
- 换 ORM；
- 引入 Kafka / Redis 作为业务事实源；
- 建立 Generic Entity 万能表；
- 建立 Generic Relation 万能表；
- 建立 Generic Event 万能 JSONB 表；
- 用 JSONB 逃避稳定关系建模；
- 为“以后也许会用”提前设计十种抽象；
- 删除历史 K12 数据；
- 在没有迁移与回退证据时物理删除兼容字段；
- 根据一次本地 EXPLAIN 删除索引；
- 根据开发库低使用率判断生产索引无用；
- 为追求“0 migration”削弱安全状态 CHECK；
- 修改其它 active 计划的状态。

---

# 七、D 线共同提示词

```text
你只执行“D 数据权威、扩展性、迁移与数据库健康收敛”当前指定的一个原子任务。

前置条件：
R、W、Q 必须已经最终归档；若任一仍 active，停止实施并只报告依赖状态。

先阅读：
- AGENTS.md
- CLAUDE.md
- 第二代架构
- 数据设计
- R 完成记录
- Q 的 migration/release evidence
- 当前 D 计划
- 当前任务涉及的 Schema / Repository / Migration / Integration tests

每条 shell 命令必须以 rtk 开头。

总原则：
- PostgreSQL 是业务事实源；
- 不创建第二套数据库事实模型；
- 不把派生物升级成根事实；
- 不把开放 Registry 写死成数据库枚举；
- 不把安全/生命周期状态放宽成任意字符串；
- 优先加强已有 Space / Conversation / Operation / Asset / Artifact /
  Ledger，而不是新增平行根实体；
- 数据迁移必须 Expand → Migrate → Switch → Contract；
- 已进入 main 的 Migration 不得修改；
- 新 Migration 必须证明 fresh install 与 N-1 upgrade；
- 不通过 JSONB 绕过 FK；
- 不以“多加一层”冒充数据收敛；
- 不替 Codex 宣布 PASS；
- 不提交、推送或合并。

涉及真实数据库时：
- 默认只允许只读审计；
- 禁止 DROP / TRUNCATE / DELETE / destructive UPDATE；
- EXPLAIN ANALYZE 只允许安全 SELECT；
- 不打印用户正文、Prompt、Credential、Secret 或原始敏感数据。

完成回报必须包含：

1. 任务编号与 PASS / REVISE / BLOCK；
2. 基线 SHA 与 origin/main；
3. 修改文件及每个文件的单一职责；
4. Schema Authority / Ownership 影响；
5. Migration 影响；
6. Fresh install / N-1 证据；
7. FK / UNIQUE / CHECK / INDEX 变化；
8. 回退方案；
9. 对后续 UV / KM / PET 的影响；
10. 实际命令、退出码和关键输出；
11. rtk git diff --check；
12. rtk git diff --name-status；
13. rtk git status --short。
```

---

# 八、执行顺序

```text
R completed
      │
W completed
      │
Q completed
      │
      ▼
     D00
      │
     D01
      │
     D02
      │
     D03
      │
     D04
      │
     D05 ──────────────┐
                       │
D01 ───────→ D06 ──────┤
                       ▼
                      D07
                       │
                      D08
                       │
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
       UV             KM             PET
```

### 串行主干

```text
D00 → D01 → D02 → D03 → D04 → D05 → D07 → D08
```

### 可并行

`D06` 在 D01 完成后，可与 D02-D05 并行。

原因：

- D02-D05 主要触达 schema / repository；
- D06 主要触达 migration governance / tooling / CI；
- 只有文件无重叠时允许并行。

### 禁止并行

任何两个同时生成数据库 Migration 的任务禁止并行。

---

# 九、原子任务

# D00：数据库真实基线与 Schema 图冻结

- 依赖：W/Q/R completed
- 可并行：否
- 类型：只读盘点

## 目标

建立进入 Feature Phase 前唯一的数据架构基线。

盘点：

```text
platform
identity
workspace
conversation
agent runtime
tool
asset
artifact
knowledge
K12
account
privacy
voice
runtime
worker
audit
```

每张表记录：

```text
table
domain
root / child / projection / ledger / audit / derivation
primary key
parent
writer
reader
retention
deletion
authority
mutable / append-only / immutable
```

同时记录：

- HEAD；
- origin/main；
- Migration 最新版本；
- 全部表；
- FK；
- UNIQUE；
- partial unique；
- CHECK；
- index；
- JSONB；
- array；
- nullable ownership reference；
- 无 FK 的逻辑 ID。

## 产出

```text
docs/04-data/04-D00-数据架构基线.md
```

至少包含：

### Domain Map

```text
Identity
Workspace
Agent Runtime
Asset
Artifact
Knowledge
Learning
Privacy
Operations
```

### Authority Matrix

```text
Fact
→ Authority
→ Writer
→ Readers
→ Retention
→ Deletion
```

### Relation Graph

必须标出：

```text
hard FK
logical reference
compatibility reference
derived relation
```

不能把逻辑关联伪装成数据库保证。

## PASS

只有所有长期表都能明确分类才 PASS。

出现：

```text
“这个表好像……”
“这里两个都是事实”
“应该不会孤儿”
```

一律 REVISE。

---

# D01：数据权威、生命周期与删除契约冻结

- 依赖：D00
- 可并行：否

## 目标

为每一种长期事实冻结：

```text
Owner
Authority
Mutation model
Retention
Deletion
Privacy
```

必须明确区分：

### Root Fact

例如：

```text
User
Space
Conversation
Asset
Artifact
```

### Execution Ledger

```text
Operation
Model Run
Tool Call
Tool Effect
```

### Projection

例如：

```text
Mastery State
```

### Audit

例如：

```text
Security Audit
```

### Derivation

例如：

```text
Embedding
Preview
Thumbnail
Transcription
```

### Queue

Graphile Worker queue 不能成为业务事实。

## 新增长期表模板

D01 应建立统一模板：

```text
Table:
Domain:
Authority:
Owner:
Parent:
Writer:
Readers:
Mutation:
Retention:
Deletion:
PII:
Idempotency:
Concurrency:
Recovery:
Versioning:
```

以后新增表必须填写。

## PASS

不存在“没有 owner 的表”。

不存在“无法说明为什么长期保存”的表。

---

# D02：核心参照完整性与孤儿事实收口

- 依赖：D01
- 可并行：否
- 允许 Migration：是

## 第一优先级

审计：

```text
assets.space_id
→ spaces.id
```

流程必须是：

```text
1. orphan preflight
2. ownership parity
3. backfill / repair
4. N-1 compatibility
5. FK
6. integration test
```

不能直接：

```sql
ALTER TABLE ADD FOREIGN KEY
```

然后祈祷历史数据正确。

## 第二优先级

审计：

```text
turn_usage_budget_outcomes.operation_id
→ agent_operations.id
```

若预算账本没有独立业务生命周期，则必须建立强 FK。

## 全库检查

扫描所有：

```text
*_id
*_user_id
*_space_id
*_conversation_id
*_operation_id
*_asset_id
*_artifact_id
```

区分：

```text
应该有 FK
不应该有 FK
迁移兼容暂时无 FK
外部稳定 ID
hash / opaque ID
```

每个无 FK 的长期内部 ID 必须有解释。

## PASS

- 0 未解释内部逻辑引用；
- 0 意外 orphan；
- Fresh install PASS；
- N-1 PASS；
- 删除行为有 integration test。

---

# D03：开放 Vocabulary 与封闭状态机分离

- 依赖：D02
- 可并行：否
- 允许 Migration：是

## 目标

逐个审计所有：

```sql
CHECK x IN (...)
```

并分类。

## Closed

必须保持数据库级闭集：

```text
lifecycle status
security outcome
approval risk
consent purpose
tool read/write effect
terminal state
```

禁止放宽。

## Open

预期未来持续增加的：

```text
capability
processor kind
artifact kind
renderer
model alias
profile
producer
derivation kind
```

优先采用：

```text
format CHECK
+
application Registry
```

例如：

```text
filesystem.read
filesystem.write
calendar.read
calendar.create

asset.ocr
asset.transcribe
asset.preview
```

## 静态门禁

建立检查：

> 新增开放 Extension Identifier 时，不得默认增加 DB hard enum。

需要数据库闭集必须：

- 给出安全/生命周期理由；
- 或 accepted ADR。

## PASS

未来增加普通：

```text
Tool
Artifact
Processor
Profile
```

不应默认要求 Migration。

---

# D04：Asset Derivation / Representation 多版本收敛

- 依赖：D03
- 可并行：否
- 允许 Migration：是

这是 D 线最重要的扩展性任务之一。

## 目标

同一个：

```text
AssetVersion
```

必须能够同时存在：

```text
transcription:sherpa:v1
transcription:cloud:v1
transcription:corrected:v2

ocr:provider-a:v1
ocr:provider-b:v2

preview:low:v1
preview:high:v1
```

互不覆盖。

## 原则

优先演进现有：

```text
asset_representations
```

禁止无理由再创建：

```text
asset_derivations_v2
```

形成第二套事实。

如果现有表无法演进，必须先 ADR 解释为什么。

## 最低身份

派生结果必须能表达类似：

```text
asset_version
kind
variant
producer
producer_version
algorithm/config version
status
content/storage identity
created_at
```

最终身份可以不同，但必须满足：

> 两个不同 Provider 对同一 AssetVersion 做 transcription 可以同时存在。

## 兼容迁移

第一阶段不要求一次 PR 物理删除：

```text
extractedText
transcriptionText
transcriptionMetadata
```

但必须：

1. 确定新权威；
2. 新写入切新权威；
3. 旧字段只保留 compatibility read；
4. 禁止继续新增：
   `xxxText / yyyText / zzzMetadata`；
5. 写退出条件。

## PASS

Integration Test 至少证明：

```text
同一 Audio AssetVersion
├─ Local transcription
└─ Cloud transcription
```

同时存在且不会互相覆盖。

---

# D05：Schema 源码领域模块化

- 依赖：D04
- 可并行：否
- 允许物理数据库变化：否

## 目标

只重组 TypeScript 源码。

建议目标：

```text
packages/db/src/schema/
├── identity.ts
├── workspace.ts
├── gateway.ts
├── conversation.ts
├── agent-runtime.ts
├── asset.ts
├── artifact.ts
├── knowledge.ts
├── study.ts
├── account.ts
├── privacy.ts
├── web-runtime.ts
└── index.ts
```

具体文件名以真实依赖关系为准。

## 硬要求

此任务不能产生数据库 Schema 变化。

必须证明：

```text
before generated schema
==
after generated schema
```

Migration：

```text
0
```

## 目标不是

把一个 3000 行文件拆成十个互相循环依赖的文件。

目标是：

> 不同 Feature owner 能修改自己的数据领域而减少 Git merge conflict。

## PASS

- 无 Migration；
- Drizzle Schema 等价；
- 全量 DB tests 通过；
- import direction 清楚；
- 每个 schema module 有明确 domain owner。

---

# D06：快速开发期 Migration Governance

- 依赖：D01
- 可与 D02-D05 并行
- 不应重复 Q06 已完成的工作

## 继承 Q06

保留：

```text
MIGRATIONS.md
migration evidence
action SHA pin
container digest
release evidence
```

D06 只补快速并行开发需要的纪律。

## 固定规则

### Rule 1

已进入 main 的 Migration：

```text
IMMUTABLE
```

不得修改。

### Rule 2

Feature Branch 开始写 Migration 前必须：

```text
sync main
```

### Rule 3

两个并行分支都新增 migration：

后合并者必须：

```text
rebase main
→ regenerate / revalidate own migration
```

禁止靠人工猜编号解决。

### Rule 4

每个新 Migration 必须记录：

```text
semantic change
lock risk
rollback
fresh install
N-1 upgrade
data migration
estimated scale
```

### Rule 5

破坏性迁移必须：

```text
Expand
→ Migrate
→ Switch
→ Contract
```

禁止同一个普通 Feature PR：

```text
新增新权威
+
删除旧权威
```

除非有明确安全证明。

## CI

检查是否已经拥有：

```text
fresh DB → head
N-1 → head
migration record completeness
migration/schema drift
```

Q06 已覆盖的直接引用，不重复建设。

缺少的才新增。

## PASS

多人并行开发 migration 不再依赖“大家记得互相说一声”。

---

# D07：真实 PostgreSQL 健康与查询计划审计

- 依赖：D05、D06
- 可并行：否
- 默认只读

源码审计完成后，对代表性开发/测试数据库执行真实健康审计。

## 数据规模

记录：

```text
table row estimate
table size
index size
total relation size
dead tuples
last analyze
last vacuum
```

关注：

```text
pg_stat_user_tables
pg_stat_user_indexes
pg_class
pg_indexes
```

## 连接与锁

记录：

```text
pg_stat_activity
pg_locks
long-running transaction
idle in transaction
blocked query
```

不得根据一次瞬时采样制造“生产瓶颈”结论。

---

## Critical Query Plan

至少覆盖：

### Conversation

```text
list recent conversations
message history
current turn
```

### Agent Runtime

```text
Operation by conversation
Model Run by operation
Tool Calls by operation
Effect reconciliation
```

### Workspace

```text
Assets by Space
Artifacts by Space
Notebook membership
```

### RAG

```text
FTS
Hybrid retrieval
Embedding identity filter
```

### Worker

```text
pending processing jobs
deletion outbox claims
```

使用安全：

```text
EXPLAIN (ANALYZE, BUFFERS)
```

仅对 SELECT。

---

## Index Audit

区分：

```text
FK protection index
business query index
unique invariant index
search index
```

不能看到“使用次数 0”就删除。

任何删除索引必须有：

```text
query inventory
EXPLAIN evidence
write amplification assessment
rollback
```

否则 D07 只记录，不修改。

## PASS

必须给出：

```text
Healthy
Watch
Action Required
```

三类清单。

不得用：

> “看起来应该没问题。”

作为结论。

---

# D08：Feature Phase 数据门禁与 Core Architecture Freeze

- 依赖：D07
- 可并行：否

这是 D 线最终验收。

## 全量验证

至少：

```text
DB unit
DB integration
fresh migration
N-1 migration
tooling quality
import boundary
typecheck
lint
relevant E2E
git diff --check
```

## 最终重新审计

必须重新回答：

### Authority

```text
一个事实是否只有一个权威？
```

### Integrity

```text
核心关系是否由 DB 强制？
```

### Extensibility

```text
新功能是否默认不改核心表？
```

### Derivation

```text
多 Provider / 多版本是否可以并存？
```

### Migration

```text
多人开发是否安全？
```

### Operations

```text
真实 DB 是否健康？
```

---

## 建立 Feature Data Contract

以后任何功能提出 Schema 修改前，必须先回答：

```text
这是新的根事实吗？
```

如果不是：

优先复用已有：

```text
Space
Conversation
Operation
Asset
Artifact
Ledger
```

如果确实是新的长期事实：

必须填写：

```text
Domain
Authority
Owner
Parent
Retention
Deletion
Privacy
Idempotency
Concurrency
Versioning
Migration
```

---

## D08 通过后的项目状态

D08 PASS 后：

```text
R → completed
W → completed
Q → completed
D → completed
```

然后正式宣布：

# Core Architecture Freeze

含义不是永远不能改架构。

含义是：

> 没有真实证据，不再进行大范围基础架构重构。

后续主要模式：

```text
Stable Core
  ├─ UV
  ├─ KM
  ├─ PET
  ├─ New Tools
  ├─ New Artifacts
  └─ New Product Features
```

---

# 十、D 完成后 UV / KM / PET 的并行边界

## UV

允许：

```text
Voice UI
Streaming Transport
ASR Adapter
Consent UX
Voice Context Integration
```

数据层复用：

```text
Asset
AssetVersion
Derivation
Consent
Retention
Operation
```

禁止 UV 自建：

```text
voice_files
voice_transcriptions_v2
voice_agent_runs
```

除非是新的独立权威事实。

---

## KM

Memory 是真正新的长期事实，可以新增独立 Domain Table。

但必须遵守 D 冻结的：

```text
Owner
Scope
Version
Source
Retention
Deletion
Tombstone
Authority
```

Product Knowledge 复用现有：

```text
Knowledge / Retrieval infrastructure
```

不创建第二个 RAG 系统。

---

## PET

桌宠原则上应该主要是：

```text
UI
Renderer
Preferences
Agent Runtime Event Adapter
```

通常不应该修改：

```text
Turn Ledger
Tool Ledger
Message Ledger
```

需要持久化时优先是：

```text
Agent / User Preference
```

而不是：

```text
pet_runtime_state
pet_agent_state
pet_tool_state
```

把瞬时动画状态写成长期业务事实。

---

# 十一、D 线完成定义

D 不是“数据库看起来整理好了”。

必须同时满足：

```text
□ 每张长期表有明确领域与 owner
□ 每个事实有唯一 authority
□ 核心内部引用没有无解释的弱关系
□ Asset → Workspace 关系已有最终结论
□ Budget → Operation 完整性已有最终结论
□ Asset derivation 支持多版本 / 多 Provider
□ Open Registry 与 Closed State 已分离
□ Schema 源码可多人低冲突修改
□ Migration 有 fresh / N-1 / rollback 纪律
□ 真实 PostgreSQL 做过 health / plan audit
□ 新表必须声明数据契约
□ DB public boundary 没有重新放宽
□ 没有创建第二套 Runtime / Ledger / RAG
□ D 产生的新兼容层均有退出条件
□ 全量测试和 CI 通过
```

全部满足后：

```text
D08 = PASS
```

然后归档到：

```text
docs/plan/completed/D-数据架构与扩展性收敛.md
```

---


