# ADR-0023：Web features 静态边界

- 状态：`accepted`
- 日期：2026-08-06
- 负责人：hzlgou

## 背景

W 线（工作面画布收敛）的 W05 要为 Web 前端建立模块静态边界，防止 `features/**`（浏览器侧 Client 组件层）反向依赖服务端与数据层，避免三类问题：

1. `features/**` 直接导入 `server/**`、`@educanvas/db`、schema 或 Node-only 模块，会让 Client bundle 混入服务端逻辑、放大安全与体积风险；
2. 具体 Renderer 反向依赖 Workspace，使 Canvas 渲染层与工作区耦合，违反分层信任模型（ADR-0004、ADR-0009）；
3. 测试专用入口进入生产 bundle，扩大攻击面。

## 候选方案

### 方案一：全面迁移 feature 公开入口（大重构）

为每个 feature 建 `index.ts` 公开入口，迁移全部跨 feature 导入走公开入口。

优点：边界彻底、长期最干净。
缺点：实测 14/15 个 feature 无 index、107 处跨 feature 导入分布在 46 个文件；波及面大、多个原子任务，与 W02/W03 在审 PR 易冲突，属大变动。

### 方案二：核心门禁 + 限期 allowlist（采纳）

建立能拦截真实边界风险的门禁，feature 间直接导入以"限期 allowlist"收口。

优点：核心防护（server/数据库反向依赖）立即落地；feature 间直接导入不构成安全或数据边界问题，属组织层面问题，可后续排期；符合 W05 计划"现有违规导入清零或**有明确限期 allowlist**"的完成标准。
缺点：feature 公开入口收敛成为长期 TODO，需保留限期。

## 决定

采纳**方案二**：

1. **门禁 A（server 边界）**：ESLint `no-restricted-imports` 限定 `features/**`，禁止导入 `server/**`、`@educanvas/db`、schema、`server-only`；新违规在 lint 阶段失败；`@/app/actions`（Next server actions）是合法入口，不在限制内。
2. **门禁 C（Renderer 不反向依赖 Workspace）**：`workspace/shared` 的共享组件移入 `apps/web/components/`，canvas/assets 等不再依赖 Workspace 目录。
3. **门禁 B（feature 公开入口）**：以限期 allowlist 收口——限期为 **W 线收口前（或最迟下季度）**，届时按需单独排期收敛 feature 公开入口。
   > 实施状态（2026-08-07 W 线收口）：限期到期，未清零（全库 79 处跨 feature 导入，组织性重构）。挂账 **Issue #317**（owner：hzlgou，deadline：2026-09-30），收口后更新本条状态；W 线归档不视为门禁 B 完成。

## 原因

- W05 的核心价值门禁（features 不反向依赖 server/数据库、Renderer 不反向依赖 Workspace）已可落地，覆盖真实的数据/安全边界；
- feature 间直接导入属于模块组织问题，不携带敏感能力或数据，全面迁移的收益低于成本；
- 当前 W02/W03 处于审核期，不宜叠加波及 46+ 文件的大重构。

## 后果

**收益**：
- Client 侧静态边界由 lint 强制，新违规无法合入；
- 跨 feature 反向依赖 server/数据库被根除。

**代价**：
- feature 公开入口收敛成为长期 TODO（限期：W 线收口前 / 下季度）。

**风险与缓解**：
- `no-restricted-imports` 的 glob 可能误伤（如 feature 内部 `server` 子目录）：审计确认当前无此结构，若出现由 lint 报错后调整 pattern；
- allowlist 无自动到期提醒：限期记录于 W 计划台账与本文档，收口时复查。

## 验证方式

- `tests/eslint-boundary.test.ts`：6 个 negative fixtures，验证 server/db/schema/server-only 被拦截、`@/app/actions` 与跨 feature 直接导入放行；
- `pnpm --filter @educanvas/web lint`：门禁对全量代码生效且当前零违规；
- Next build：确认无 server module 泄漏（build 通过）。
