# D06：快速开发期 Migration 治理与 CI 分层

- 任务：`D 数据架构与扩展性收敛` → `D06 快速开发期 Migration Governance 与 CI 分层`
- 类型：治理工具链 + CI 分层（Migration = 0，物理数据库 Schema 变化 = 0，业务行为变化 = 0）
- 实施日期：2026-08-09（CST）
- 状态：`DONE`（待 Codex 复核；DONE ≠ PASS）
- 基线：开始/结束 HEAD = origin/main = `610921cae09823d6f481db3b5cd41ded0f26e6c7`
- 前置：Q06 已完成（SHA pin、container digest、release evidence、MIGRATIONS.md 基础门禁）——不重复建设

## 1. 当前治理缺口（复核结果）

| #   | 缺口                                                                     | 复核证据                                                | D06 处置                                                |
| --- | ------------------------------------------------------------------------ | ------------------------------------------------------- | ------------------------------------------------------- |
| 1   | migration-records 只要求 6 字段（语义/锁表/回滚/N-1/Fresh install/风险） | `tooling/quality/migration-records.mjs` REQUIRED_FIELDS | 扩展为 8 字段（+Data migration/Estimated scale）        |
| 2   | 无独立门禁证明历史 SQL/snapshot 不可修改、journal 只允许合法追加         | 无对应工具                                              | 新增 migration-governance.mjs                           |
| 3   | CI 单一 integration lane 混合 DB+Worker                                  | ci.yml `integration` job 跑 `pnpm test:integration`     | 拆为 db/worker/migration 三个 lane                      |
| 4   | ci-impact 对任何 `packages/**` 触发 E2E，范围过宽                        | `result.e2e = matchesAny(paths, [/^packages\//...])`    | 收窄为浏览器可执行面（排除 db/asset-processing/worker） |
| 5   | 无独立、清晰命名的 migration CI 证据                                     | 无 migration lane                                       | 新增 migration-integration job + 脚本                   |
| 6   | Q06 已完成项（不可重复）                                                 | SHA pin/digest pin/release evidence/records 基础门禁    | 全部保留未动                                            |

## 2. 历史 Migration 不可变规则（Rule 1）

`tooling/quality/migration-governance.mjs`（新增），基于**明确 base/head SHA 的真实 git 比较**（非文件名正则猜测）：

- base 已存在的 `packages/db/drizzle/*.sql`：禁止修改（M）/删除（D）/重命名（R）；
- base 已存在的 `meta/*_snapshot.json`：同上；
- `meta/_journal.json`：base 的 entries 必须原样保留（全部字段+顺序），head 只允许尾部追加；
- 新 migration：SQL/snapshot/journal 必须成套；数字前缀全局唯一；journal idx 唯一且单调递增；新 snapshot 的 prevId 必须指向前一个 snapshot 的 id；SQL 文件 stem（不含 `.sql`）、journal tag、snapshot 编号一致；三者任一方向出现孤儿均失败；
- 工作区未提交的对不可变文件修改也会失败（本地保护）；
- base/head 无法解析 → **fail closed**（CI 失败 + 本地用法说明）。

## 3. 并行分支 / rebase / regenerate 流程（Rule 2/3）

1. Feature Branch 写 Migration 前先 `sync main`；
2. 两个并行分支都新增 migration：**后合并者 rebase main → 重新 `drizzle-kit generate`/revalidate 自己的 migration**，禁止人工猜编号；
3. 门禁自动兜底：rebase 后旧 journal 前缀不变（只追加）、新编号唯一、prevId 链连续——任一违反立即失败。

## 4. journal / snapshot 链规则

- journal 是**只追加日志**：`idx` 唯一单调递增，`tag` 与 SQL 文件 stem（不含 `.sql`）一致；
- snapshot 是**单向链表**：每个 snapshot 的 `prevId` 指向编号前一位 snapshot 的 `id`；新 migration 的 snapshot 必须挂在链尾；
- 历史 snapshot 与 journal 前置项在任何情况下不可修改（含 drizzle-kit 自动生成）。

## 5. Migration 记录模板（Rule 4，8 字段）

新迁移（0051 起）必须含：

```text
- 状态: active
- 语义: <semantic change>
- 锁表: <lock risk>
- 回滚: <rollback>
- N-1: <N-1 upgrade>
- Fresh install: <fresh install>
- Data migration: none | deterministic bounded repair | backfill | destructive cleanup
- Estimated scale: <本地规模>；生产数据规模未验证，D07 承接（不允许伪造数字）
- 风险: <risk>
```

- 占位词（TBD/TODO/FIXME/pending/待定/待补/未填/占位/...）→ 门禁失败；
- 归档基线 0000–0050 只要求 Q06 时代的 6 字段，**不追溯补造无证据的规模数据**；
- `docs/04-data/10-D06` 交付时 0051–0053 已按 SQL 真实内容补齐两字段：
  - 0051：`deterministic bounded repair`（fail-closed preflight + 单条已审计孤儿 + outbox 登记）；规模 = 本地 36/4/1 行；
  - 0052：`none`（13 对 DROP/ADD CHECK，0 行受影响）；
  - 0053：`backfill`（NOT NULL DEFAULT 自动回填 28 representations / 14 jobs）。

## 6. Expand → Migrate → Switch → Contract 规则（Rule 5）

- 破坏性/行为变化迁移必须显式走四阶段并记录在语义字段；
- 门禁不强制四阶段（语义判断），但记录模板要求语义字段说明 data migration 类别，为 D07 的人工复核提供依据。

## 7. CI lane 路由矩阵（原子交付 C）

| 变更路径                                                          |    db-integration     | worker-integration | migration-integration | e2e | release-evidence |
| ----------------------------------------------------------------- | :-------------------: | :----------------: | :-------------------: | :-: | :--------------: |
| packages/db/src（Repository）                                     |           ✓           |         –          |           –           |  –  |        –         |
| packages/db/src/schema/**                                         |           ✓           |         –          |      ✓（drift）       |  –  |        –         |
| packages/db/drizzle/**                                            |           ✓           |         –          |           ✓           |  –  |        ✓         |
| apps/worker/**                                                    |           –           |         ✓          |           –           |  –  |        –         |
| packages/asset-processing/**                                      |           –           |         ✓          |           –           |  –  |        –         |
| apps/web、apps/gateway、apps/web-runtime、browser-facing packages |           –           |         –          |           –           |  ✓  |        –         |
| unknown path / dependency / workflow                              | **fail open（全跑）** |                    |                       |     |                  |
| docs-only                                                         |   低成本（全跳过）    |                    |                       |     |                  |

- e2e 从"任何 packages/** 都触发"收窄为"浏览器可执行面"（纯 DB/Worker/asset-processing 内部改动不再支付 Chromium smoke）；
- 与纯 DB/Worker 改动同时提交的普通交付文档属于 neutral path，不会重新启用 E2E；
- 纯 DB 内部改动不自动支付 Worker integration；纯 Worker 改动不自动运行 DB full（但 Worker lane 自备 PostgreSQL + Graphile schema）；
- secret scan、nightly full matrix、PR smoke、failOnFlakyTests、checks 聚合全部保留。

## 8. 独立 Migration CI 证据（原子交付 D）

`migration-integration` job 顺序执行：

1. `migration-governance.mjs $BASE_SHA $HEAD_SHA`（历史不可变 + 成套 + fail closed）；
2. `migration-records.mjs`（记录完整性 8 字段 + 占位词）；
3. `drizzle-kit check`（schema/migration drift）；
4. `drizzle-kit generate` 后 `git diff --exit-code -- packages/db/drizzle`（必须 "No schema changes, nothing to migrate"）；
5. `pnpm test:integration:migrations`（复用 `migrations.integration.test.ts`：fresh DB → head + N-1 → head，不复制测试逻辑）；
6. 结束后 `git status --short packages/db/drizzle` 确认无生成物（无 0054）。

本地入口：`test:integration:db` / `test:integration:worker` / `test:integration:migrations`；根 `test:integration` 保留 DB+Worker 组合语义（`turbo test:integration --filter=@educanvas/db --filter=@educanvas/worker --concurrency=1`），文档明确其兼容语义。

## 9. fresh / N-1 / drift 证据

- fresh DB → head：migrations 集成测试 beforeAll 全量迁移（disposable 库）通过；
- N-1 → head：0052→0053 升级测试通过（D04 既有）；
- drift：`drizzle-kit check` exit 0；`drizzle-kit generate` 零差异（无 0054）；
- 全量集成：50 文件 / 323 测试（db 包）。

## 10. fail-open 与 fail-closed 边界

| 场景                                         | 行为                                         |
| -------------------------------------------- | -------------------------------------------- |
| ci-impact 无法分类（未知路径/依赖/workflow） | fail open：运行完整必要门禁                  |
| migration-governance base/head 无法解析      | **fail closed**（CI 失败；本地输出用法说明） |
| records 缺字段/占位词                        | **fail closed**                              |
| e2e 依赖的 integration lanes skipped         | 接受（`contains('success','skipped')`）      |
| required lane failure                        | 拒绝（checks 聚合失败）                      |

`checks` 显式接收 `DB_INTEGRATION_EXPECTED`、`WORKER_INTEGRATION_EXPECTED`、
`MIGRATION_INTEGRATION_EXPECTED`；任一被分类为 required 的拆分 lane 非 success，
聚合上下文必须失败。

`migration-integration` 的 base/head 在 PR 与 push 使用真实事件 SHA；nightly 和
`workflow_dispatch` 没有 base/before 时以当前 SHA 自检，禁止把空 ref 交给
fail-closed governance。

## 11. 本地开发命令

```bash
# 本地验证历史不可变门禁（比较 origin/main..HEAD）
node tooling/quality/migration-governance.mjs origin/main HEAD
# 记录完整性
node tooling/quality/migration-records.mjs
# 完整 migration suite（门禁 + drift + fresh/N-1）
TEST_DATABASE_URL=postgresql://educanvas:educanvas@localhost:5433/educanvas_integration \
  pnpm test:integration:migrations
# 按风险分流
pnpm test:integration:db / test:integration:worker
```

## 12. 回退方案

- 工具链：删除 `tooling/quality/migration-governance.mjs`、`migration-integration.mjs` 与两个测试文件，恢复 ci-impact 的 `integration` lane 定义（git 可完整还原）；
- CI：还原 ci.yml 中三个 job 为原 `integration` job（依赖关系同时还原）；
- records：移除 2 个新字段要求即可回到 6 字段契约（0051-0053 补写的字段无害）；
- 无数据库变化，无数据回退需求。

## 13. 对 UV / KM / PET / O 的影响

零影响：纯治理工具与 CI 配置变更；不触碰 schema、repository、业务代码、migration 文件（0051-0053 仅补写文档字段，SQL 未动）。

## 14. D07 输入

- 生产数据规模验证（0051-0053 的 Estimated scale 已显式声明"未验证，D07 承接"）；
- 0051 snapshot 元数据漂移（D02 手写 migration 未同步 snapshot）的最终处置（D06 门禁已兼容：不可变检查以 base 树为准，历史 snapshot 不再修改）；
- migration-governance 可作为 D07 生产发布前 gate 的静态分析输入。

## 15. 验证记录

| 命令                                                             | 退出码 | 关键输出                                                              |
| ---------------------------------------------------------------- | ------ | --------------------------------------------------------------------- |
| `pnpm env:check`                                                 | 0      | OK                                                                    |
| `pnpm lint`                                                      | 0      | —                                                                     |
| `pnpm typecheck`                                                 | 0      | —                                                                     |
| `pnpm test:unit`                                                 | 0      | 含 tooling 与包测试                                                   |
| `node --test tooling/migration-governance.test.mjs`              | 0      | 13/13（含真实 Drizzle tag、journal-only/重复历史 tag、dirty journal） |
| `node --test tooling/migration-records.test.mjs`                 | 0      | 7/7                                                                   |
| `node --test tooling/ci-impact.test.mjs`                         | 0      | 22/22（含 checks env bridge、runner 自路由、DB+docs）                 |
| `node tooling/quality/migration-governance.mjs origin/main HEAD` | 0      | 通过                                                                  |
| `node tooling/quality/migration-records.mjs`                     | 0      | 54 迁移均有记录                                                       |
| `pnpm --dir packages/db exec drizzle-kit check`                  | 0      | Everything's fine                                                     |
| `pnpm --dir packages/db exec drizzle-kit generate`               | 0      | No schema changes, nothing to migrate                                 |
| `pnpm --dir packages/db test`                                    | 0      | 9 files / 70 tests                                                    |
| `pnpm --dir packages/db test:integration`                        | 0      | 50 files / 323 tests                                                  |
| `pnpm test:integration:migrations`（全流程）                     | 0      | 6 项证据全绿                                                          |
| ci.yml YAML 解析（js-yaml）                                      | 0      | 13 jobs，checks 聚合完整                                              |
| `pnpm typecheck:e2e`                                             | 0      | —                                                                     |
| `pnpm file:check`                                                | 0      | —                                                                     |
| `git diff --check`                                               | 0      | —                                                                     |
| `git status --short packages/db/drizzle`                         | 0      | 仅 MIGRATIONS.md（D06 补写字段）                                      |

## 16. 未完成项与证据缺口

- **CI 全量执行**未在本机运行（GitHub Actions 需 PR 环境）；YAML 解析与路由单元测试已覆盖，job 实际执行由 Codex 复核后首次 PR 验证；
- `pnpm test:tooling` 全量因沙箱 `/bin/ps` EPERM 无法完整运行（环境限制，与 D06 无依赖；子集另行报告）；
- migration-governance 的 base 缺省 `origin/main` 在 CI 由显式 BASE_SHA/HEAD_SHA 覆盖（PR 上下文），push 事件用 `github.event.before`；
- 0051 snapshot 漂移未修复（D06 纪律：不改历史；记录为 D07 输入）。

Codex 首轮复核发现并已在本工作区修复：split-lane expected env 漏接、真实
Drizzle journal tag 不带 `.sql`、dirty journal 路径漏检、migration runner 自修改
未路由，以及 DB+neutral docs 误触发 E2E。对应反例均已进入测试，不能只靠文档约定。
