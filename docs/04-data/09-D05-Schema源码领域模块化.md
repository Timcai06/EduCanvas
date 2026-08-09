# D05：Schema 源码领域模块化

- 任务：`D 数据架构与扩展性收敛` → `D05 Schema 源码领域模块化`
- 类型：纯 TypeScript 源码重组（Migration = 0，物理数据库变化 = 0）
- 实施日期：2026-08-09（CST）
- 状态：`PASS`（Codex 复核，2026-08-09）
- 基线：开始/结束 HEAD = origin/main = `610921cae09823d6f481db3b5cd41ded0f26e6c7`（D04 #332 已合入）

## 1. 最终目录结构

```text
packages/db/src/
├── schema.ts                    # 8 行兼容聚合入口（export * from './schema/index'）
└── schema/
    ├── index.ts                 # 薄聚合（27 行，仅 re-export，无实现）
    ├── identity.ts              # 127 行  platformUsers / securityAuditEvents / personalAgents
    ├── workspace.ts             # 139 行  spaces / notebookMemberships / delegatedGrants
    ├── gateway.ts               # 245 行  gatewayChannelAccountBindings / ThreadBindings /
    │                            #          HandoffTokens / NodePairings / NodeInvocations
    ├── conversation.ts          # 401 行  conversations / agentOperations / gatewayOperationEvents /
    │                            #          gatewayApprovals / gatewayDeliveries / conversationMessages /
    │                            #          operationSources / conversationMessageCitations
    ├── agent-runtime.ts         # 272 行  lessonSessions / chatMessages / agentMessageParts / turnContextSnapshots
    ├── asset.ts                 # 478 行  assets / assetVersions / notebookAssetBindings /
    │                            #          assetRepresentations / assetVideoKeyframes /
    │                            #          assetProcessingJobs / objectDeletionOutbox
    ├── turn.ts                  # 506 行  modelRuns / turnUsageBudgetOutcomes / toolCalls / toolEffects /
    │                            #          toolApprovalIntents / operationContinuations / turnSafetyDecisions
    ├── knowledge.ts             # 349 行  knowledgeSources / Documents / Chunks / ChunkEmbeddings / EmbeddingRuns
    │                            #          （含 tsvector / vector / EMBEDDING_DIMENSIONS 辅助）
    ├── retrieval.ts             # 239 行  sessionSourceBindings / turnSourceSnapshots / turnSourceVersions /
    │                            #          retrievalCandidates / messageCitations
    ├── learning.ts              # 150 行  canvasArtifacts / canvasArtifactGradingKeys / learningEvents / masteryStates
    ├── artifact.ts              # 242 行  artifacts / artifactGenerationJobs / artifactVersions
    ├── study.ts                 #（既有，未改）
    ├── account.ts               #（既有，未改）
    ├── audio-consent.ts         #（既有，未改）
    ├── mcp-intent.ts            #（既有，未改）
    ├── tool-effect-reconciliation.ts  #（既有，未改）
    └── web-runtime.ts           #（既有，未改）
```

拆分前 schema.ts 2992 行 → 拆分后最大领域模块 506 行（turn.ts），全部 < 600。

## 2. Domain Owner Matrix

| 模块          | Domain Owner                               | 表数 | 行数 |
| ------------- | ------------------------------------------ | ---- | ---- |
| identity      | 平台主体（账号/主体生命周期）              | 3    | 127  |
| workspace     | 空间与协作（space/membership/delegation）  | 3    | 139  |
| gateway       | 渠道与网关编排（channel/node/handoff）     | 5    | 245  |
| conversation  | 对话与 Agent 操作账本                      | 8    | 401  |
| agent-runtime | 会话/消息/上下文（Agent 运行时）           | 4    | 272  |
| asset         | 资产与派生表示（D04 五元组 identity 所在） | 7    | 478  |
| turn          | 单轮账本（model run/tool call/安全决策）   | 7    | 506  |
| knowledge     | 知识库/RAG 存储                            | 5    | 349  |
| retrieval     | 检索链路（快照/候选/引用）                 | 5    | 239  |
| learning      | 教学纵切（canvas 产物/学习事件/掌握度）    | 4    | 150  |
| artifact      | Artifact 一等公民（ADR-0005）              | 3    | 242  |

## 3. import direction

```text
identity ──────────────────────────────────────────────┐
workspace → identity                                    │
asset → workspace                                       │
conversation → identity + workspace + asset             │
gateway → identity + workspace + conversation           │
agent-runtime → identity + workspace + conversation + asset
turn → identity + conversation + agent-runtime          │
artifact → identity + workspace + conversation          │
knowledge → agent-runtime                               │
learning → agent-runtime + artifact                     │
retrieval → knowledge + agent-runtime                   │
（既有模块：study/account/audio-consent/mcp-intent/tool-effect-reconciliation/web-runtime 依赖新模块方向不变）
```

方向依据 = 真实 FK 引用（含 `foreignKey({...})` 复合 FK）：如 conversation.operationSources → asset.assetVersions（conversation → asset）、learning.canvasArtifacts → artifact.artifactVersions（learning → artifact）、knowledge.retrievalCandidates → agent-runtime.lessonSessions 等。根/上游表所在模块不依赖下游模块。

## 4. 循环依赖审计结果

- 模块依赖图拓扑排序：`identity < workspace < asset < conversation < gateway < agent-runtime < turn < artifact < knowledge < retrieval < learning`——**无环**；
- 模块内表间引用为同文件内部引用（如 conversation 内 agentOperations ↔ conversations）；
- 无 any、无重复声明、无动态 require、无复制表对象；
- 跨模块引用统一经 `import { ... } from './上游模块'`（类型安全）。

## 5. 公共/internal/testing 导出兼容证明

- `./schema` 导入路径解析不变（schema.ts 文件优先于 schema/ 目录，Bundler resolution）；
- schema.ts 导出集合 = 拆分前（54 表 + study/account/web-runtime 3 个 re-export = 63 个表导出，名称完全一致）；
- `packages/db/src/index.ts`、`packages/db/src/internal/index.ts`、`packages/db/src/testing/index.ts` **零修改**（未触碰）；
- 全仓 `from './schema'` 调用方零改动（typecheck 全绿证明符号可解析）；
- 无新增内部 Schema 文件路径依赖（生产代码无 `from './schema/identity'` 之类直接导入）；
- 默认公共入口导出不变；internal/testing 边界未扩大；无 export * 公共 API 泄漏（schema/index.ts 只导出表，不导出辅助 const tsvector/vector/EMBEDDING_DIMENSIONS）；
- import-boundary 测试通过（db unit 70 tests 内含）。

## 6. before/after generated schema 等价证明

**方法**（双层）：

1. drizzle-kit 权威验证：`drizzle-kit generate` → `No schema changes, nothing to migrate`（零差异）；`drizzle-kit check` → `Everything's fine`；无 0054 文件；`packages/db/drizzle/` 目录 git 零改动（0000–0053 SQL/snapshot/journal 未触碰）。
2. 源码级对比（/tmp/educanvas-d05-before vs /tmp/educanvas-d05-after，未写入仓库）：按表定义区间提取表名/列名顺序/约束名，逐项比较。

**结果**：表 54=54（名称全等）、列 0 差异（全部表列名顺序一致）、checks 194=194、uniques 67=67、indexes 72=72、primaryKey 1=1、复合 FK 13=13、列引用（`.references`）72=72。

## 7. 表、列、FK、UNIQUE、CHECK、INDEX 前后数量

| 项           | before            | after    | 变化 |
| ------------ | ----------------- | -------- | ---- |
| 表           | 54                | 54       | 0    |
| 列（含顺序） | 各表一致          | 各表一致 | 0    |
| CHECK        | 194               | 194      | 0    |
| UNIQUE       | 67                | 67       | 0    |
| INDEX        | 72                | 72       | 0    |
| 复合 FK      | 13                | 13       | 0    |
| 列引用 FK    | 72                | 72       | 0    |
| 既有模块表   | 13（schema/*.ts） | 13       | 0    |

## 8. Migration = 0 证明

- `packages/db/drizzle/` 无 0054；
- 0000–0053 SQL 零修改（git diff 无）；
- meta/0000–0053 snapshot 零修改（git diff 无）；
- meta/_journal.json 零修改（git diff 无）；
- MIGRATIONS.md 零修改；
- RC manifest migration.version 零修改（仍为 54）；
- drizzle-kit check 通过；
- before/after 规范化比较完全相等（§6）。

## 9. 历史 Migration/snapshot 零修改证明

`git status --short packages/db/drizzle/` 输出为空（零改动）；git diff 仅含 src 与 docs/baseline 文件。

## 10. file-size baseline 的降低结果

- `packages/db/src/schema.ts`：2993 → **8**，已从大文件基线移除；
- 只有达到 400 行治理阈值的模块进入 `files`：conversation 402、asset 479、turn 507（使用治理脚本的含末尾换行计数）；
- 其余 8 个领域模块均低于阈值，不制造无效基线；
- 未提高任何其他文件基线；`pnpm file:check` exit 0。

## 11. fresh DB 与完整 DB tests 结果

- fresh DB → head：集成测试 beforeAll 全量迁移通过（50 文件/323 测试，含 migrations N-1/fresh 测试）；
- db unit：9 文件/70 测试（含 import-boundary）；
- 全 workspace typecheck：25/25；
- vocabulary gate：audit exit 0、8/8 测试（约束名/语义未变——门禁不依赖文件位置）。

## 12. 对 UV/KM/PET/O 的影响

零影响（纯源码重组）：D04 五元组 identity（asset_representations/asset_processing_jobs 唯一约束、格式 CHECK）原样保留；learning/study 既有模块未动；所有表对象引用（repository/测试）感知不到变化。

## 13. D06/D07 输入

- D06（Migration Governance）：无新增迁移，0053 仍为最新；历史 snapshot 基线完好。
- D07（Schema/Repository 演进）：模块边界 = 真实 FK 依赖图，可作为后续"按域迁移到独立数据库/独立包"的静态分析输入；`schema/index.ts` 是未来公共 API 收敛的唯一入口。

## 14. 回退方案

提交或合并后应直接 `git revert <D05 原子提交>`，只反转 D05 的明确文件集；提交前如需放弃，应仅恢复 `packages/db/src/schema.ts`、删除本任务新增的 12 个 Schema 文件，并恢复本任务的文档和 file-size baseline。禁止用目录级 checkout 覆盖 `packages/db/src/` 的其他工作。drizzle/ 目录零改动，无数据库回退需求。

## 15. 验证记录

| 命令                                               | 退出码 | 关键输出                                  |
| -------------------------------------------------- | ------ | ----------------------------------------- |
| `pnpm env:check`                                   | 0      | OK                                        |
| `pnpm --dir packages/db exec drizzle-kit check`    | 0      | Everything's fine                         |
| `pnpm --dir packages/db exec drizzle-kit generate` | 0      | **No schema changes, nothing to migrate** |
| `pnpm --dir packages/db typecheck`                 | 0      | —                                         |
| `pnpm --dir packages/db test`                      | 0      | 9 files / 70 tests                        |
| `pnpm --dir packages/db test:integration`          | 0      | 50 files / 323 tests                      |
| `pnpm typecheck:e2e`                               | 0      | —                                         |
| `pnpm test:tooling`                                | 0      | 135/135                                   |
| `node tooling/quality/vocabulary-gate.mjs`         | 0      | 无违规                                    |
| `node --test tooling/vocabulary-gate.test.mjs`     | 0      | 8/8                                       |
| `pnpm file:check`                                  | 0      | 基线更新后                                |
| `pnpm exec turbo run typecheck --force`            | 0      | 25/25                                     |
| before/after 源码对比                              | 0      | 全等（§6）                                |
| fresh DB → head                                    | 0      | 迁移链可重建                              |
| `git diff --check`                                 | 0      | —                                         |

## 16. 未完成项和证据缺口

- 未删除 schema.ts（保留为兼容聚合入口，按任务允许的选项 A）；
- 既有 6 模块（study/account 等）未重写（任务要求保留或最小调整——仅 index 聚合边界调整）；
- reviewer 首次在受限沙箱内连接本地测试库被 EPERM 拒绝；按隔离库边界在获准环境重跑后，DB integration 323/323 与 tooling 135/135 全绿；
- before/after 对比为源码级 + drizzle-kit 双层证明；未做逐字节 snapshot diff（drizzle-kit generate 零差异已覆盖语义等价）。
