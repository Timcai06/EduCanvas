# Turn Runtime、数据事实与公共边界收敛

- 任务分配名：`R 运行时收敛`
- 状态：`active`
- 负责人：项目负责人
- 实现执行：协作 Agent，每次只领取一个原子任务
- 代码审核与最终验收：Codex
- 最后验证时间：2026-08-06
- 当前领取任务：`R00`
- 并行计划：[W 工作面画布](W-工作面画布收敛.md)、[Q 质量观测成本](Q-质量观测成本.md)
- 后续出口：[G 产品发布闭环](G-产品发布闭环.md)
- 关联计划：[UV 画布语音](UV-画布语音.md)、[KM 知识记忆](KM-知识记忆.md)

## 一、目标

本线只解决两轮架构审计中最核心的问题：**Turn 控制流虽然共享同一
`TurnApplicationService`，但应用组合根、持久事实、数据库公共出口和兼容协议仍然存在双轨。**

阶段结束后必须能够验证：

1. Web General、Web Teaching 与 Gateway 不再分别复制完整 Turn Runtime 装配逻辑；
2. Platform Turn、旧 Chat/K12 Turn、Model Run、Tool Call 等重叠事实都有明确唯一权威、
   兼容读取路径和退场计划，不再无限期双写；
3. `@educanvas/db` 默认公共出口不再暴露任意 `getDb`、全部 schema 和无边界仓储；
4. Context Snapshot 能完整记录模型实际看到的全部 Asset 版本，包括单轮多图；
5. 运行时 Node 版本、TypeScript Node 类型和 CI 基线一致；
6. 工具、错误与能力标识不再通过中文展示文案或字符串包含关系推断协议身份；
7. 本线通过删除旧路径和减少公共概念完成收敛，不以新增第二套框架、第二个 Runtime 或
   新微服务冒充优化。

本计划不是第三代架构重写，不拆微服务，不重做 Agent Loop、Tool Kernel、Context Engine、
Gateway 协议或教学领域状态机。现有可信失败、审批、取消、恢复和账本纪律必须保留。

## 二、已经确认的代码事实

| 事实 | 代码位置 | 本计划处理 |
| --- | --- | --- |
| Web General、Web Teaching、Gateway 都使用 `TurnApplicationService` | `apps/web/server/platform/general-turn.ts`、`apps/web/server/teaching/learning-turn.ts`、`apps/gateway/src/agent-runner.ts` | 保留唯一应用服务，收敛组合根 |
| Web 仍经 Gateway envelope、兼容 Runner 和 legacy event 投影 | `apps/web/server/gateway/web-turn.ts` | 删除展示文案推断与不必要协议往返 |
| `@educanvas/db` 默认导出 `getDb`、schema 和大量仓储 | `packages/db/src/index.ts` | 建立受控 subpath 和架构门禁 |
| Platform Turn 与旧 Chat/K12 持久模型并存 | `packages/db/src/index.ts` 及相关 repository | 盘点、确定权威、迁移、停止双写 |
| 多张原生图片合成一个 Context Segment，但只登记首张 `assetVersionId` | `apps/web/server/platform/general-turn-profile.ts`、`packages/agent-runtime/src/context-engine.ts` | 修复完整追溯 |
| Runtime 使用 Node 22，多个包使用 Node 26 类型 | `.nvmrc`、各 `package.json` | 统一版本 |
| 模型配置在组合根和 factory 中重复解析 | `apps/web/server/model/model-runtime.ts`、`apps/worker/src/model-runtime.ts`、`packages/model-gateway/src/turn-model-gateway-factory.ts` | 单次解析与显式注入 |
| Web 兼容投影存在展示标签和字符串错误映射 | `apps/web/server/gateway/web-turn.ts` | 改为稳定协议枚举 |

若实现时任一事实已变化，先停止当前任务，更新本表并由 Codex 重新确认依赖，不得按过期报告
机械改代码。

## 三、绝对边界与协作纪律

### 允许触达的主路径

- `packages/agent-core/src/**`
- `packages/agent-runtime/src/**`
- `packages/db/src/**`
- `packages/db/package.json`
- `packages/model-gateway/src/**`
- `apps/gateway/src/**`
- `apps/web/server/platform/**`
- `apps/web/server/gateway/**`
- `apps/web/server/model/**`
- `apps/web/server/teaching/**`
- `apps/worker/src/model-runtime.ts`
- 根目录 Node / TypeScript / workspace 配置
- 与本线直接对应的测试和 canonical 文档
- 本计划文件

### 默认禁止

- 不改 Canvas UI、Composer、Workspace 布局、视觉设计；
- 不改实时语音 Adapter、音频留存或对象删除任务；
- 不实现 Memory、Product Knowledge 或新的 RAG 能力；
- 不新建第二个 Agent Loop、Context Compiler、Tool Kernel 或 Turn Ledger；
- 不引入微服务、消息总线、ORM 替代或数据库重写；
- 不在同一 PR 同时做“新事实上线”和“旧事实物理删除”，除非已有完整迁移与回退证据；
- 不修改其它 active 计划文件；
- 不 reset、restore、checkout、stash、rebase 或格式化任务外文件。

### 与其它 active 线的冲突规则

- `R02` 会触达 Context 契约，必须在 KM 的 M02 前完成，或等待 M02 合并后重放；
- `R03` 会触达模型配置，若 UV 仍在修改同一配置文件，必须等待 UV 对应任务合并；
- `R04-R06` 是本线串行主干，不与任何修改 Turn/DB 组合根的任务并行；
- `R01`、`R07` 可在文件所有权不重叠时独立并行。

## 四、共同提示词

```text
你只执行“R Turn Runtime、数据事实与公共边界收敛”当前指定的一个原子任务。

先阅读仓库根 AGENTS.md、CLAUDE.md、本计划、第二代架构文档、系统架构现状、相关 ADR，
再阅读当前任务涉及的源码和相邻测试。每条 shell 命令必须以 rtk 开头。

硬边界：
- 只修改当前任务列出的文件；需要越界时立即停止并报告；
- 不创建第二个 Agent Loop、TurnApplicationService、Tool Kernel、Context Compiler、
  Gateway authority 或数据库事实源；
- 不把“新增一层 Adapter”当作收敛；优先删除重复装配、重复事实和重复映射；
- 不用中文展示文案、错误 message、字符串 includes 或 UI label 作为协议身份；
- 数据迁移必须先兼容、再切换、最后删除；没有回滚和 N-1 证据不得删除旧事实；
- 一个文件接近 400 行必须评估拆分，手写文件不得超过 600 行；
- 不替 Codex 宣布 PASS，不提交、推送或合并。

实施顺序：
1. 先补能证明当前缺口的失败测试或静态门禁；
2. 做最小实现；
3. 删除被替代路径；
4. 运行局部验证，再运行任务要求的跨包验证；
5. 检查没有把旧路径留成永久兼容层。

完成回报必须包含：
1. 任务编号与 PASS / PARTIAL / BLOCKED；
2. 基线 SHA、修改文件和每个文件的单一职责；
3. 验收标准到测试或静态门禁的逐项映射；
4. 实际命令、退出码和关键输出；
5. 删除了哪些重复路径，仍保留哪些兼容路径及退出条件；
6. 数据迁移、回退、安全边界和残余风险；
7. rtk git diff --check、rtk git diff --name-status、rtk git status --short。
```

## 五、执行顺序与并行关系

```text
R00 → R01
  ├→ R02 ─┐
  ├→ R03 ─┼→ R04 → R05 → R06 → R08
  └→ R07 ─┘
```

- `R01`、`R02`、`R03`、`R07` 在文件所有权无交集时可并行；
- `R04-R06` 依次处理公共出口、持久事实和组合根，是串行主干；
- `R08` 只有在所有遗留兼容路径都有删除结论后才可开始。

## 六、原子任务

### R00：基线、重复路径与所有权冻结

- 依赖：无
- 文件边界：本计划
- 可并行：否

只做只读盘点：

1. 记录 HEAD、origin/main、当前分支、worktree 和预存改动；
2. 绘制 Web General、Web Teaching、Gateway 三条 Turn 路径的真实调用图；
3. 列出全部 Turn、Message、Model Run、Tool Call、Context、Operation 持久表及写入者；
4. 列出 `@educanvas/db` 与 `@educanvas/agent-core` 默认出口；
5. 标记兼容投影、双写、只读旧路径和计划删除路径；
6. 核对 UV、KM 与本线文件交集，只更新本计划台账。

完成标准：

- 每个事实有 `file:line`；
- 区分“同一语义的重复实现”和“有意分层的不同事实”；
- 不把文档宣称写成代码事实；
- 输出一张权威矩阵：`事实类型 → 唯一写入者 → 读取者 → 兼容期限`。

验证命令：

```text
rtk git rev-parse HEAD
rtk git rev-parse origin/main
rtk git status --short
rtk rg -n "new TurnApplicationService|AgentLoopEngine|PlatformTurn|ChatRepository|ModelRun|ToolCall|export \* from './schema'|getDb" apps packages
```

### R01：Node 运行时与类型基线统一

- 依赖：R00
- 文件边界：`.nvmrc`、根 `package.json`、受影响 workspace 的 `package.json`、锁文件、CI 配置
- 可并行：是

目标：

- Node runtime、engines、CI、开发文档和 `@types/node` 使用同一主版本；
- 不升级 Node 主版本，只把类型降到当前运行基线；
- 增加静态验证，防止未来包单独漂移到更高 Node 类型。

完成标准：

- 全 workspace typecheck 通过；
- CI 与本地 doctor 显示同一 Node 主版本；
- 新门禁能拒绝再次出现 Node 22 runtime + Node 26 types。

### R02：多 Asset Context Snapshot 完整追溯

- 依赖：R00
- 文件边界：
  - `packages/agent-core/src/**` 中 Context material 契约；
  - `packages/agent-runtime/src/context-engine.ts` 及测试；
  - `apps/web/server/platform/general-turn-profile.ts` 及测试；
  - 必要的账本 repository 和集成测试。
- 可并行：是，但不得与 KM M02 同时改同一文件

目标：

- Context Segment 可以登记零个、一个或多个 Asset Version；
- 多图合并进入同一模型消息时，Snapshot 必须记录全部版本且保持原顺序；
- 重复、越权、空 ID、超限和 Prompt/material 漂移必须 fail closed；
- 保持旧单 Asset 读取兼容，但新增写入只使用新契约。

完成标准：

- 2–4 张图片实际进入模型消息时，Context material 精确登记全部版本；
- 文本 Asset、单图、多图、混合 Asset 均有测试；
- 数据库账本可重建本轮模型实际可见 Asset 集合；
- 不通过拆成大量 required Segment 挤掉对话历史来规避问题。

### R03：模型配置单次解析与显式注入

- 依赖：R00
- 文件边界：
  - `packages/model-gateway/src/**`
  - `apps/web/server/model/**`
  - `apps/worker/src/model-runtime.ts`
  - 相关测试和配置文档
- 可并行：是，若 UV 正在修改同文件则等待

目标：

- 每个进程或请求范围只解析一次环境配置；
- Factory 接收已验证配置，不在内部再次读取 `process.env`；
- Vision、Embedding、Speech 等 capability override 共享同一解析纪律；
- 注释与实际生命周期一致，不再声称“缓存”却每次重建。

完成标准：

- 通过 spy 或注入测试证明单次解析；
- 配置错误只关闭对应能力，不污染其它能力；
- Secret 不离开 model-gateway 边界；
- Web、Gateway、Worker 使用相同配置对象语义。

### R04：`@educanvas/db` 公共出口收口

- 依赖：R01、R02、R03
- 文件边界：
  - `packages/db/package.json`
  - `packages/db/src/index.ts`
  - 新增受控 subpath entry
  - 所有直接依赖默认出口的导入点
  - ESLint / dependency boundary 配置
- 可并行：否

目标：

- 默认 `@educanvas/db` 只导出稳定应用级 Repository、Port Adapter 和公开类型；
- `getDb`、schema、迁移辅助和底层表只允许从明确 internal/testing subpath 使用；
- Web feature、Gateway 和领域包不得直接依赖 schema；
- 集成测试可使用 testing subpath，但生产代码不可导入。

完成标准：

- 静态门禁能拒绝生产代码导入 `@educanvas/db/schema`、`getDb` 或 testing entry；
- 所有生产组合根通过 Repository/Port 构造；
- 没有用几十个临时 re-export 掩盖原来的超级出口；
- 包循环依赖和构建时间没有显著恶化。

### R05：Turn 与执行事实单轨化

- 依赖：R04
- 文件边界：经 R00 权威矩阵批准的 Turn、Message、Model Run、Tool Call repository、migration、
  compatibility reader 与集成测试
- 可并行：否

目标：

1. 对每类重复事实指定唯一权威表和唯一新写入路径；
2. 旧路径只保留有期限的读取或回填，不再继续双写；
3. 提供历史数据回填、校验、计数对账和回退方案；
4. General、Teaching、Gateway 使用同一 Turn Ledger 语义；
5. Learning Event、Operation Event、Tool Effect 等不同事实不得错误合并。

完成标准：

- 新 Turn 不再向已废弃事实写入；
- N-1 数据可读取、回填或明确拒绝；
- 双写关闭前后有计数、哈希或抽样对账；
- 失败恢复、取消、审批、引用和教学事实没有回归；
- 旧表删除必须单独任务执行，不与首次切换同 PR。

### R06：唯一 Turn Application 组合工厂

- 依赖：R05
- 文件边界：
  - `packages/agent-runtime/src/**` 新增或调整 composition contracts；
  - Web General、Web Teaching、Gateway 组合根；
  - 相关跨入口契约测试。
- 可并行：否

目标：

- 建立唯一 `createTurnApplication` 或等价工厂；
- Web 与 Gateway 只提供 identity、profile、transport、capability 和 adapter；
- Lifecycle、Ledger、Model Runtime、Tool Kernel、Cancellation、Trace 的公共装配不再复制；
- Profile 仍可拥有领域差异，不把 Teaching 逻辑塞进 General。

完成标准：

- 三条生产路径不再各自 `new TurnApplicationService({...})`；
- 跨入口同一输入的终态、错误码、取消和账本切片有一致性测试；
- Gateway 无 Asset 能力时仍诚实失败，不通过伪造空能力达到“统一”；
- 删除至少一套重复装配文件或显著缩减其职责。

### R07：兼容协议稳定标识清理

- 依赖：R00
- 文件边界：`apps/web/server/gateway/web-turn.ts`、相关 protocol 类型和测试
- 可并行：是

目标：

- Tool ID、failure code、retryable、capability 不再由中文 label 或 message 字符串推断；
- Legacy 投影只消费稳定枚举；
- `tool.failed` 不再无差别映射为同一错误；
- 每个兼容映射都有删除条件。

完成标准：

- 修改任意 UI 文案不会改变协议结果；
- 未知枚举 fail closed；
- Legacy 与 canonical event 的映射有完整表驱动测试；
- 清理冗余条件和永远等价的逻辑。

### R08：删除审计、文档回写与收口

- 依赖：R05、R06、R07
- 文件边界：本计划、对应 canonical 文档、必要的静态门禁
- 可并行：否

完成标准：

- 权威矩阵中的每条双轨均为 `removed`、`read-only with deadline` 或 `blocked with owner`；
- 至少记录被删除的文件、出口、表写入者和兼容映射；
- 架构文档只描述当前事实，不把目标写成完成；
- 全 CI 通过；
- Codex 独立复核后才能归档。

## 七、验证台账

| 任务 | 状态 | 证据 |
| --- | --- | --- |
| R00 基线与权威矩阵 | `PENDING` | HEAD、调用图、事实写入矩阵 |
| R01 Node 基线 | `PENDING` | version gate、全量 typecheck、CI |
| R02 Asset 追溯 | `PENDING` | unit + PostgreSQL integration |
| R03 配置单次解析 | `PENDING` | factory/config tests |
| R04 DB 公共出口 | `PENDING` | import boundary gate、build |
| R05 持久事实单轨 | `PENDING` | migration、对账、跨入口 integration |
| R06 组合工厂 | `PENDING` | cross-entry contract tests |
| R07 协议标识 | `PENDING` | table-driven compatibility tests |
| R08 收口 | `PENDING` | full CI、删除清单、canonical 文档 |

## 八、阶段级验证

```text
rtk pnpm lint
rtk pnpm typecheck
rtk pnpm test:unit
rtk pnpm test:integration
rtk pnpm build
rtk pnpm test:e2e
rtk git diff --check
rtk git diff --name-status origin/main...HEAD
rtk git status --short
```

## 九、风险与回退

- 数据事实切换使用 expand → backfill → compare → switch reads/writes → contract；
- 任何跨入口终态或账本不一致立即回退到最后一个单轨写入前版本；
- 公共出口收口先提供 subpath，再迁移调用方，最后删除旧出口；
- 组合根收敛不得改变协议；先建立 characterization tests；
- 若减少概念后反而引入更多 Adapter、文件或双写，本任务判定 `REVISE`。

## 十、收尾检查表

- [ ] 每类执行事实都有唯一权威与唯一新写入者；
- [ ] Web、Teaching、Gateway 使用统一组合工厂；
- [ ] 默认 DB 出口不暴露底层连接和全部 schema；
- [ ] Context Snapshot 完整记录多 Asset；
- [ ] Node runtime/types/CI 一致；
- [ ] 展示文案不参与协议身份；
- [ ] 旧路径已有删除或限期读取结论；
- [ ] 稳定事实已回写 canonical 文档；
- [ ] 计划已移入 `completed/` 并更新 active 索引。
