# 对象删除 Outbox 恢复与并发安全

- 任务分配名：`O 删除队列`
- 状态：`active`
- 负责人：协作开发者
- 实现执行：协作开发者使用 DeepSeek，每次只领取一个原子任务
- 代码审核与最终验收：Codex
- 最后验证时间：2026-07-30
- 下一领取任务：`O00`
- 并行计划：[画布运行时与实时语音主线](UV-画布语音.md)
- 并行计划：[账号登录原子性与会话撤销可靠性](A-账号会话.md)

## 一、目标

这条线只做一个事情：把“对象已经被业务归档/删除”与“对象在物理存储中真正删除”
之间的可靠性闭环做实，确保 worker 崩溃、重复投递、并发领取和对象已不存在等场景都
能形成稳定终态。

交付后必须满足：

1. 业务事务内写入的 object deletion outbox 不能丢，且不会因为 worker 重启而重复造成
   二次破坏；
2. `claimBatch` / `complete` / `fail` 的语义是单写者、幂等、可恢复的，重复领取不会让
   已处理项回到待处理状态；
3. asset/avatar 使用资产根、artifact 使用产物根；所有 schema 允许的 object/source kind
   都有明确适配，不会读错根、删错根或把错误路径泄露给浏览器；
4. worker 失败日志只保留稳定错误码，不泄露对象 key、真实路径、堆栈或原始存储错误；
5. 这条线只改对象删除 outbox 及其 worker 相关文件，不碰 Canvas、Runtime、语音、
   Composer、Gateway 或 UI 外壳。

本计划不是重做所有资产生命周期，也不是改造新的对象存储协议。已有的事务写 outbox、
worker cron、asset/artifact 双根对象删除都保留，只补可靠性缺口和证据链。

## 二、已经确认的代码事实

| 事实                                               | 代码证据                                                     | 本计划处理                        |
| -------------------------------------------------- | ------------------------------------------------------------ | --------------------------------- |
| Artifact 归档已在同一事务内写 outbox               | `packages/db/src/platform-artifact-archive.ts:12-92`         | 不重做归档逻辑，只补恢复/并发证据 |
| 对象删除 outbox 仓储已提供 claim / complete / fail | `packages/db/src/object-deletion-outbox-repository.ts:1-120` | 补并发、租约恢复和幂等测试        |
| 资产相关派生链路也会写 objectDeletionOutbox        | `packages/db/src/asset-repository.ts:1280-1306` 左右         | 只核对 outbox 事实，不改派生业务  |
| Worker 已有 maintenance:delete_object_outbox 调度  | `apps/worker/src/worker-config.ts:1-20`                      | 不新增调度系统                    |
| 删除 worker 已按 asset / artifact 分根读取对象     | `apps/worker/src/tasks/delete-object-outbox.ts:1-115`        | 补 avatar 路由和失败分类证据      |
| claim 类型允许 avatar，但 worker 当前拒绝 avatar   | Repository 的 `objectKind` 联合；worker `delete()` 的 else   | 必须修复，不能让头像永久重试失败  |
| processing 行没有过期 claim 恢复                   | `claimBatch()` 只查询 `pending`                              | 增加有界租约和崩溃恢复证据        |
| schema 允许 `asset_video_keyframe` source type     | `packages/db/src/schema.ts` 的 source check                  | 补齐 TypeScript claim 联合与测试  |

如果实现时发现上述事实已经变化，先停止当前任务，由 Codex 更新本表与依赖图。

## 三、绝对文件边界

本计划只允许修改或新增：

- `packages/db/src/object-deletion-outbox-repository.ts`
- `packages/db/src/object-deletion-outbox-repository.integration.test.ts`
- `packages/db/src/platform-artifact-archive.ts`
- `packages/db/src/platform-artifact-repository.ts`
- `packages/db/src/asset-repository.ts`
- `packages/db/src/platform-artifact.integration.test.ts`
- `packages/db/src/asset-repository.integration.test.ts`
- `apps/worker/src/tasks/delete-object-outbox.ts`
- `apps/worker/src/tasks/delete-object-outbox.test.ts`
- `apps/worker/src/tasks/maintenance-tasks.test.ts`
- `apps/worker/src/worker-config.ts`
- 本计划文件

除上述文件外一律不得修改。特别禁止修改：

- Canvas、Runtime、语音、Composer、Gateway、Agent Runtime 和 UI 外壳；
- 任何 schema/migration 输出；
- 任何面向浏览器的对象存储读取面；
- 其它 active 计划文件和既有未提交改动；
- 根目录预存删除或其它协作开发者未提交文件。

若必须越界才能完成当前任务，立即停止并向 Codex 报告。不能复制 worker、改写对象存储
协议、也不能新建第二套删除调度系统来绕边界。

## 四、DeepSeek 共同提示词

```text
你只执行“对象删除 Outbox 恢复与并发安全”计划当前指定的一个 O 任务。
先阅读仓库根 AGENTS.md、CLAUDE.md、本计划和当前任务涉及的源码及相邻测试。

硬边界：
- 每条 shell 命令都必须以 rtk 开头；
- 只能修改本计划“绝对文件边界”列出的文件；
- 不改 Canvas、Runtime、语音、Composer、Gateway、数据库 schema/migration 或其它活跃计划；
- 不把对象 key、真实路径、堆栈、原始存储错误或 Secret 带到浏览器或日志；
- 不新增第二套 outbox 调度、第二套对象根或新的全局状态；
- 不 reset、restore、checkout、stash、rebase，不格式化任务外文件；
- 发现需要越界、基线不一致或验收无法执行时，立即停止并报告。

实施规则：
- 先补能证明缺口的失败测试，再做最小实现；
- 一个文件只承担一个可命名职责，接近 400 行时主动评估拆分，禁止超过 600 行；
- 不靠 snapshot 大面积覆盖真实断言；
- 保持 asset/avatar 与 artifact 的根隔离，不把“对象已不存在”误判成业务失败，也不把错误路径泄露给客户端。

完成回报必须逐项给出：
1. 任务编号和 PASS / PARTIAL / BLOCKED；
2. 基线 SHA、修改文件及每个文件的单一职责；
3. 每条验收标准对应的代码和测试名称；
4. 实际命令、退出码和关键输出；
5. 未运行项及原因；
6. 安全边界检查、残余风险和回退方式；
7. `rtk git diff --check`、`rtk git diff --name-status`、`rtk git status --short`。

不能替 Codex 宣布任务或阶段最终通过。不要自行合并 PR。
```

## 五、任务顺序与并行关系

单个协作开发者默认按：

```text
O00 → O01 → O02 → O03 → O04
```

如果以后拆给两名协作者，可在 O00 后分成：

```text
               ┌→ O02 worker 路径 ─┐
O00 → O01 仓储 ─┤                  ├→ O04 收口
               └→ O03 集成测试 ────┘
```

并行仅表示任务依赖允许，不允许两人修改同一文件。O01 和 O02 可以并行，但不能同时改
同一仓储文件。

## 六、原子任务

### O00：基线、事实与所有权冻结

- 依赖：无
- 文件边界：本计划
- 可并行：否

```text
只做只读盘点，不修改产品源码。

1. 记录 HEAD、origin/main、当前分支和 worktree；
2. 记录 git status --short，明确哪些是预存改动；
3. 核对 objectDeletionOutbox、archiveOwnedArtifactTransaction、delete-object-outbox worker 和 worker cron 的真实代码事实；
4. 明确 asset/avatar 与 artifact 的对象根映射、processing claim 无租约的当前缺口；
5. 只更新本计划验证台账，不改任何源码。
```

完成标准：

- 每条当前事实都有真实路径和 `file:line`；
- 没有把文档、历史 PR 或未运行测试写成 passed；
- 与其它 active 计划的开发文件交集为零；
- 不把“outbox 已存在”误报为“恢复闭环已完成”。

验证命令：

```text
rtk git rev-parse HEAD
rtk git rev-parse origin/main
rtk git status --short
rtk rg -n "objectDeletionOutbox|delete_object_outbox|archiveOwnedArtifactTransaction|ASSET_STORAGE_ROOT|OBJECT_STORAGE_ROOT" packages/db/src apps/worker/src
```

### O01：Outbox 仓储的 claim / complete / fail 语义收口

- 依赖：O00
- 文件边界：`packages/db/src/object-deletion-outbox-repository.ts`、`packages/db/src/platform-artifact-archive.ts`

```text
先在 `object-deletion-outbox-repository.integration.test.ts` 补失败、租约和并发证据，
再做最小实现。

要点：
- claimBatch 必须保证单批次领取、可重试，并能在租约到期后重新领取 worker 崩溃遗留的
  processing 行；未过期 processing 不得重复领取；
- complete / fail 只能推进 processing 记录，已终态再次写入必须返回稳定结果；
- archiveOwnedArtifactTransaction 里登记 outbox 的语义不能被拆成“先写业务、后补 outbox”；
- 不改变 objectDeletionOutbox 的稳定字段，也不暴露新敏感字段。
```

完成标准：

- 有并发领取、过期 claim 恢复和重复完成的 PostgreSQL 集成测试；
- claim/complete/fail 的返回值与状态转换可由测试证明；
- outbox 写入仍然和业务归档在同一事务中；
- 不引入新 schema 或迁移。

### O02：worker 删除路径与失败分类收口

- 依赖：O01
- 文件边界：`apps/worker/src/tasks/delete-object-outbox.ts`、`apps/worker/src/tasks/delete-object-outbox.test.ts`

```text
在 worker 里补“asset/avatar 与 artifact 根隔离”和“稳定失败码”证据。

要点：
- asset 与 avatar 必须走资产 `LocalObjectStorage` 根，artifact 走独立产物根；
- `asset_video_keyframe` 必须保持合法 source type，不能被不完整的 TypeScript 联合吞掉；
- 对未知 objectKind 必须 fail closed；
- 对象缺失、权限错误、路径非法等异常必须映射为稳定码，不得把原始路径写进日志；
- worker 只负责删除与 ack，不负责回写业务状态。
```

完成标准：

- 有 asset / avatar / artifact 三种 object kind 与双根映射的测试；
- 有未知 objectKind、对象缺失、删除失败的稳定错误码测试；
- 日志里不出现对象 key、真实路径或 stack；
- 任务可以在重复投递下保持幂等。

### O03：并发、崩溃恢复与定时任务证据

- 依赖：O01、O02
- 文件边界：`packages/db/src/platform-artifact.integration.test.ts`、`packages/db/src/asset-repository.integration.test.ts`、`apps/worker/src/tasks/maintenance-tasks.test.ts`

```text
补齐三个方向的证据：
1. 并发 claim 时只有一个 worker 真正处理；
2. worker 中断后，processing claim 在租约到期前不被抢占，到期后可恢复；
3. maintenance:delete_object_outbox 的调度与 worker 注册保持一致。
```

完成标准：

- 有并发/重启/重复投递的真实测试；
- 资产、头像与产物 outbox 都被覆盖；
- cron 注册与任务名一致；
- 没有依赖顺序的脆弱测试。

### O04：验证台账、文档与收口

- 依赖：O03
- 文件边界：本计划

```text
运行任务规定的验证命令，填写本计划的验证台账。
确保最终 diff 只包含边界文件，不把别人的改动纳入本 PR。
```

完成标准：

- 任务台账逐项对应证据；
- `git diff --check` 通过；
- `git status --short` 只包含本计划允许的文件；
- Codex 可以据此独立审计是否进入下一阶段。

## 七、验证台账

| 任务                | 状态      | 证据                                                                           |
| ------------------- | --------- | ------------------------------------------------------------------------------ |
| O00 基线与所有权    | `PASS`    | 本计划“基线与所有权”章节；5 个初始缺口已记录                                   |
| O01 Outbox 仓储收口 | `PASS`    | 本 PR; claimBatch 租约恢复 + complete/fail 带 attempt 防重入 + sourceType 补齐 |
| O02 worker 删除路径 | `PASS`    | 本 PR; avatar 路由 + object_not_found 幂等 complete + fail 错误日志            |
| O03 并发与恢复证据  | `PENDING` | 待补 — 需真双 worker 并发测试 + 租约恢复端到端验证                             |
| O04 台账与收口      | `PENDING` | 待补                                                                           |

### O01-O02 本轮修复（替代原 PR #259/#260）

| 问题                               | 修复                                                              |
| ---------------------------------- | ----------------------------------------------------------------- |
| complete/fail 缺 attempt 防重入    | WHERE 条件增加 `attempts = ?`，旧 worker 无法推进已被重新领取的行 |
| object_not_found 当作失败重试      | 映射为幂等 complete（目标已达成）                                 |
| 并发测试可两个都 false             | 改用 XOR 断言 `firstHas !== secondHas`                            |
| fail 失败被吞掉                    | catch 块记录 `helpers.logger.error`，保留失败计数                 |
| sourceType 缺 asset_video_keyframe | 已补齐                                                            |
| claimBatch 只查 pending            | 增加租约过期 processing 行恢复                                    |

## 八、Codex 审核标准

每个任务只能得到 `PASS`、`REVISE` 或 `BLOCK`：

- 是否严格限制在对象删除 outbox 与其 worker 相关边界；
- 是否保持 asset / artifact 双根隔离；
- 是否没有把对象 key、路径、堆栈或原始存储错误带进浏览器或日志；
- 是否用并发、重启和重复投递的行为测试证明幂等；
- 是否没有新增 schema、迁移或第二套删除系统；
- 是否实际运行了计划要求的验证命令。
