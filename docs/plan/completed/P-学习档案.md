# 学习档案活动可靠性优化

- 任务分配名：`P 学习档案`
- 状态：`completed`
- 负责人：协作开发者
- 代码审核与最终验收：Cai
- 最后验证时间：2026-08-01
- 下一领取任务：无；P00-P05 已完成并归档
- 并行计划：[画布运行时与实时语音主线](../active/UV-画布语音.md)
- 已完成计划：[画布界面与可访问性优化](F-画布界面.md)

## 一、目标

本计划把已经接入真实学习事实的档案活动投影，从“基本可显示”收口为“日期统计可信、
失败状态有限、用户可以恢复”。

交付后必须满足：

1. 热力图、活跃天数和连续学习天数按明确的教学日历时区计算，不受服务器本地时区、
   固定 24 小时减法或夏令时切换影响；
2. 无身份、无活动、接口失败和契约异常均诚实展示，不生成虚假活动、掌握度或成功状态；
3. 档案抽屉不会在请求失败后永久保持 `aria-busy`，失败时提供可访问提示和显式重试；
4. 学习主体仍只来自服务端身份，浏览器不能指定或切换他人主体；
5. 本计划与 F 线 Canvas 外壳、S 线 Canvas/媒体/语音/Worker 文件保持零交集。

本计划不是新建学习档案、重做视觉设计或改变学习事实来源。真实活动聚合、Repository 和
数据库集成测试已经存在，本阶段只处理日期派生、HTTP 失败边界和档案抽屉恢复能力。

## 二、已经确认的代码事实

| 事实                                   | 代码证据                                                     | 本计划处理                     |
| -------------------------------------- | ------------------------------------------------------------ | ------------------------------ |
| 活动已来自可信`assessment_graded` 事件 | `packages/db/src/learning-activity-repository.ts:19-58`      | 不修改 Repository 或事实口径   |
| 服务层已将可信事实交给纯派生函数       | `apps/web/server/profile/learning-activity-service.ts:13-40` | 补服务边界与失败测试           |
| 日期窗口使用固定`86_400_000` 毫秒倒推  | `apps/web/server/profile/learning-activity.ts:13-65`         | 改为日历日运算                 |
| 日期键依赖 Node 进程本地时区           | `apps/web/server/profile/learning-activity.ts:16-24`         | 固定生产教学时区并支持测试注入 |
| 当前产品已有`Asia/Shanghai` 日期口径   | `apps/web/features/progress/progress-drawer.tsx:17-21`       | 复用该口径，不新增配置         |
| Activity Route 不接受主体参数          | `apps/web/app/api/v1/me/activity/route.ts:9-29`              | 用 Route 测试锁定              |
| 抽屉失败时保持`activity === null`      | `apps/web/features/profile/profile-drawer.tsx:43-68`         | 建立有限状态与重试             |
| 抽屉以`activity === null` 表示忙碌     | `apps/web/features/profile/profile-drawer.tsx:111-130`       | 只在真实 loading 时设置 busy   |

## 三、绝对文件边界

本计划只允许修改或新增：

- `apps/web/server/profile/learning-activity.ts`
- `apps/web/server/profile/learning-activity.test.ts`
- `apps/web/server/profile/learning-activity-service.ts`
- `apps/web/server/profile/learning-activity-service.test.ts`
- `apps/web/app/api/v1/me/activity/route.ts`
- `apps/web/app/api/v1/me/activity/route.test.ts`
- `apps/web/features/profile/profile-drawer.tsx`
- `apps/web/features/profile/profile-activity-view-model.ts`
- `apps/web/features/profile/profile-activity-view-model.test.ts`
- `apps/web/features/profile/learning-activity-loader.ts`
- `apps/web/features/profile/learning-activity-loader.test.ts`
- `tests/e2e/profile-activity.spec.ts`
- 本计划文件

除上述文件外一律不得修改。特别禁止修改：

- `packages/db`、Drizzle schema、migration 和学习事件写入路径；
- `activity-contract.ts` 及公开 API 响应形状；
- `apps/web/features/canvas/**`、CanvasHost、Renderer 和 Canvas E2E；
- Artifact、媒体读取/下载/删除 Route 和 `apps/worker/**`；
- 语音、Composer、Gateway、Agent Runtime、Model Gateway；
- `Sheet`、Button、全局主题、Tailwind 配置和共享错误组件；
- F 线与 S 线计划文件；
- 根目录预存删除或其他开发者未提交修改。

若必须越界才能完成当前任务，立即停止并向 Codex 报告。不得复制共享组件、修改数据库
事实口径、增加请求参数或以格式化整目录的方式绕过文件边界。

## 四、统一设计约束

### 4.1 日期口径

- 生产默认教学时区固定为 `Asia/Shanghai`，与现有进度界面一致；
- 日期转换必须基于 IANA 时区和日历日期键，不得依赖 Node 进程的本地时区；
- 不得用 `86_400_000` 毫秒表示“前一天”或“后一天”；
- 日期工具应允许测试注入其他 IANA 时区，用
  `America/New_York` 覆盖春季和秋季夏令时边界；
- 不新增环境变量、账户时区字段、Cookie、API query 或数据库迁移；
- 53 周窗口固定为 371 个互不重复、严格升序的日期键，最后一项是教学时区中的今天。

### 4.2 状态口径

档案抽屉的活动区只允许：

| 状态      | 含义                 | 展示要求                            |
| --------- | -------------------- | ----------------------------------- |
| `loading` | 请求正在进行         | `aria-busy=true`，不显示虚假数字    |
| `ready`   | 契约有效且有活动     | 展示可信统计                        |
| `empty`   | 契约有效但没有活动   | 展示 0 或明确空态，不算失败         |
| `failed`  | HTTP、网络或契约失败 | 固定安全文案、`aria-live`、重试按钮 |

失败信息不得包含响应正文、堆栈、SQL、学生标识、Cookie、URL 动态参数或 Provider 信息。
重试只重新获取 Activity，不得重复获取用户资料或关闭抽屉。

### 4.3 安全与兼容

- `studentId` 只能由 `readAnonymousIdentity()` 产生；
- 浏览器请求不能新增 `studentId`、Notebook ID 或时间戳参数；
- 保持 `learningActivityResponseSchema` 和 `ProfileDrawer` 公共 props 不变；
- 遥测、日志和 UI 只使用稳定错误码或固定文案；
- 不允许通过 mock 数据让空档案看起来已有学习记录；
- 不新增 npm 依赖。

## 五、DeepSeek 共同提示词

以下文本必须附在每一个原子任务提示词前：

```text
你只执行“学习档案活动可靠性优化”计划当前指定的一个 P 任务。
先阅读仓库根 AGENTS.md、CLAUDE.md、本计划，以及当前任务涉及的源码和相邻测试。

硬边界：
- 每条 shell 命令都必须以 rtk 开头；
- 只能修改本计划“绝对文件边界”中与当前任务明确列出的文件；
- 不修改 packages/db、schema、migration、Activity 公开响应契约或学习事实来源；
- 不触碰 Canvas、Artifact、媒体、语音、Worker、Gateway 或其他开发者文件；
- 不新增依赖、环境变量、Cookie、query 参数、第二套 Activity API 或全局组件；
- 不使用固定 86400000 毫秒进行日历日加减；
- 不泄露学生标识、响应正文、堆栈、SQL、Cookie 或任何 Secret；
- 不 reset、restore、checkout、stash、rebase，不格式化任务外文件；
- 发现需要越界、已有目标文件脏改、基线不一致或验收无法执行时，立即停止并报告。

实施规则：
- 先补能证明缺口的失败测试，再做最小实现；
- 一个文件只承担一个可命名职责，接近 400 行时主动评估拆分，禁止超过 600 行；
- 不大面积更新 snapshot，不以 mock 的“调用过”代替行为和安全断言；
- 保持现有公开 props、API schema 和服务端身份边界兼容。

完成报告必须逐项给出：
1. 任务编号和 PASS / PARTIAL / BLOCKED；
2. 基线 SHA、修改文件及每个文件的单一职责；
3. 每条验收标准对应的代码和测试名称；
4. 实际命令、退出码和关键输出；
5. 未运行项及原因；
6. 安全边界检查、残余风险和回退方式；
7. rtk git diff --check、rtk git diff --name-status、rtk git status --short。

不能替 Codex 宣布任务或阶段最终通过。不要自行合并 PR。
```

## 六、任务顺序与阶段并行

单个协作开发者默认按：

```text
P00 → P01 → P02 → P03 → P04 → P05
```

如果以后拆给两名协作者，可在 P01 合并后分成：

```text
                 ┌→ P02 后端服务与 Route ─┐
P00 → P01 日期 ──┤                       ├→ P04 抽屉接入 → P05 收口
                 └→ P03 前端加载状态 ─────┘
```

并行仅表示任务依赖允许，不允许两人修改同一文件。P04 必须等待 P02、P03 都完成。

### P00：基线、真实缺口与所有权冻结

- 依赖：无
- 文件边界：本计划

任务提示词：

```text
执行只读基线核对，不修改产品源码。

1. 记录 HEAD、origin/main、当前分支和 worktree；
2. 记录 git status --short，明确哪些是预存改动；
3. 核对学习活动 Repository 已使用 assessment_graded 可信事件；
4. 核对 learning-activity.ts 的固定毫秒与进程本地时区问题；
5. 核对 ProfileDrawer 请求失败后 activity 仍为 null、aria-busy 不会结束；
6. 对比 F、S 计划绝对文件边界，证明本计划开发文件交集为零；
7. 只更新本计划验证台账，不改任何源码。
```

完成标准：

- 基线 SHA 与远端缓存 SHA 有实际命令证据；
- 每个缺口都有当前 `file:line`，不能只引用本计划描述；
- `git diff --name-only` 中若已有本计划专属文件修改，标记 `BLOCKED`；
- F、S、P 三条线的开发文件集合交集为零；
- 不把已有 Repository 聚合误报为待开发功能。

验证命令：

```text
rtk git rev-parse HEAD
rtk git rev-parse origin/main
rtk git status --short
rtk git diff --name-only
rtk rg -n "DAY_MS|setHours|aria-busy|assessment_graded" apps/web/server/profile apps/web/features/profile packages/db/src/learning-activity-repository.ts
```

### P01：教学时区与日历日派生

- 依赖：P00
- 文件边界：`learning-activity.ts`、`learning-activity.test.ts`

任务提示词：

```text
先在 learning-activity.test.ts 增加会失败的日期测试，再最小修改纯派生实现。

要求：
- 生产默认时区为 Asia/Shanghai；
- now 和每个 ISO instant 都按显式 IANA timeZone 转换为 YYYY-MM-DD；
- 日历日前后移动使用日期键或 UTC 日历字段，不减固定毫秒；
- 测试可以注入 America/New_York，但公开 LearningActivity 响应形状不变；
- 保持无效时间戳、窗口外事件和未来事件被忽略；
- 不触库、不读取环境变量、不修改 service、route 或 React 组件。
```

完成标准：

- `TZ=UTC` 与 `TZ=America/Los_Angeles` 运行目标测试结果一致；
- 上海时间 `23:59` 与次日 `00:01` 分属正确日期；
- New York 春季少一小时、秋季多一小时的相邻日均只产生一个日期键；
- 371 个日期键互不重复、严格升序，最后一项为教学时区今天；
- 今天无活动、昨天有活动时 streak 从昨天起算；更早有断点时为 0；
- 同一教学日多个事件只增加该日 count，不增加 activeDays；
- 源码中不存在用固定毫秒完成日历日移动的实现。

验证命令：

```text
rtk env TZ=UTC pnpm --dir apps/web exec vitest run server/profile/learning-activity.test.ts
rtk env TZ=America/Los_Angeles pnpm --dir apps/web exec vitest run server/profile/learning-activity.test.ts
rtk pnpm --dir apps/web typecheck
rtk git diff --check
```

### P02：服务与 Activity Route 失败边界

- 依赖：P01
- 文件边界：`learning-activity-service.ts`、`learning-activity-service.test.ts`、
  `app/api/v1/me/activity/route.ts`、`route.test.ts`
- 可并行：P03

任务提示词：

```text
补齐服务层和 GET /api/v1/me/activity 的行为测试，不改变公开成功响应契约。

服务测试必须证明：
- trustedStudentId 为 null 时不访问 Repository，返回真实空投影；
- 有主体时只把 Repository 返回的可信 facts 交给日期派生；
- mastery 平均值按现有规则转成百分比，不自行推断；
- Repository 失败不会被伪装成空活动或成功。

Route 测试必须证明：
- 主体只来自 readAnonymousIdentity，不读取 query/body/header 中的 studentId；
- 成功响应通过 learningActivityResponseSchema，带 private, no-store；
- 无身份返回 200 的真实空投影；
- Repository/服务异常返回稳定 activity_unavailable 和固定中文文案；
- 契约输出异常返回 activity_contract_violation；
- 错误响应不包含原异常、堆栈、SQL、主体 ID 或内部字段。

如为了单测需要依赖注入，只添加最小的模块私有/可选测试缝，不建立第二个 Repository。
```

完成标准：

- Route 新测试覆盖 200、服务失败和契约失败；
- 失败不能返回 200 空数据；
- 客户端伪造主体对 Repository 调用参数没有影响；
- 错误 body 只包含现有安全错误封套允许的字段；
- 不修改 Activity schema、Repository、数据库或身份实现。

验证命令：

```text
rtk pnpm --dir apps/web exec vitest run server/profile/learning-activity-service.test.ts app/api/v1/me/activity/route.test.ts
rtk pnpm --dir apps/web typecheck
rtk pnpm exec prettier --check apps/web/server/profile/learning-activity-service.ts apps/web/server/profile/learning-activity-service.test.ts apps/web/app/api/v1/me/activity/route.ts apps/web/app/api/v1/me/activity/route.test.ts
rtk git diff --check
```

### P03：可取消、可重试的前端 Activity Loader

- 依赖：P01
- 文件边界：`learning-activity-loader.ts`、`learning-activity-loader.test.ts`
- 可并行：P02

任务提示词：

```text
新增档案专用、职责单一的 Activity loader 与纯状态转换，不修改 ProfileDrawer。

要求：
- 请求固定 GET /api/v1/me/activity，cache: no-store；
- 接受 AbortSignal，组件卸载后可取消；
- 使用 learningActivityResponseSchema 解析成功响应；
- 状态只允许 loading、ready、empty、failed；
- activeDays=0 是 empty，不是 failed；
- 非 2xx、JSON 解析失败、schema 失败和网络失败都归一化为 failed；
- Abort 不覆盖新请求结果，也不显示失败提示；
- 只向 UI 返回固定安全错误信息，不返回 Response body、Error stack 或内部 code；
- retry 所需动作由调用方显式触发，loader 不做自动重试。
```

完成标准：

- 测试覆盖 ready、empty、HTTP 失败、非法 JSON、schema 失败、网络失败和 Abort；
- 后发请求的状态不会被先发请求的旧响应覆盖；
- 单次 retry 只产生一次新 fetch；
- 模块不依赖 React、Router、Canvas 或数据库；
- 不新增依赖。

验证命令：

```text
rtk pnpm --dir apps/web exec vitest run features/profile/learning-activity-loader.test.ts
rtk pnpm --dir apps/web typecheck
rtk pnpm exec prettier --check apps/web/features/profile/learning-activity-loader.ts apps/web/features/profile/learning-activity-loader.test.ts
rtk git diff --check
```

### P04：档案抽屉有限状态、可访问性与重试

- 依赖：P02、P03
- 文件边界：`profile-drawer.tsx`、`profile-activity-view-model.ts` 及其 `.test.ts`

任务提示词：

```text
现有 Vitest 没有 DOM 组件测试环境，不新增临时 React 测试依赖。把活动区的四态展示、
aria-busy、固定文案和可重试语义提取为纯 view model，由 `.test.ts` 直接证明；
ProfileDrawer 只消费该模型。实际 DOM、键盘和 retry 由 P05 Playwright 验证。

要求：
- 打开时进入 loading，并在卸载时 Abort；
- ready 展示可信 streakDays、activeDays、masteryPercent；
- empty 展示 0/无数据语义，不伪造 masteryPercent；
- failed 结束 aria-busy，显示固定“暂时无法加载学习活动”及重试按钮；
- failed 容器使用适当的 role/aria-live；loading 只在请求进行时 aria-busy=true；
- 重试只重新请求 Activity，不重复请求 /api/v1/me，不关闭抽屉；
- 快速关闭、重新打开或连续点击重试时，旧响应不能覆盖新状态；
- 保持 ProfileDrawer props、身份区、主题区、通信设置和“查看完整档案”行为不变；
- 不修改 Sheet、CountUp 或全局组件。
```

完成标准：

- loading、ready、empty、failed 四态都有纯状态/投影断言；
- 请求失败后不存在永久 busy；
- Retry 的启用条件与动作投影可由纯测试证明；真实键盘行为留给 P05；
- 卸载后不提交旧请求状态；
- 测试断言用户可见行为，不使用大面积 snapshot；
- ProfileDrawer 公共 props 无变化。

验证命令：

```text
rtk pnpm --dir apps/web exec vitest run features/profile/profile-activity-view-model.test.ts features/profile/learning-activity-loader.test.ts
rtk pnpm --dir apps/web typecheck
rtk pnpm exec prettier --check apps/web/features/profile/profile-drawer.tsx apps/web/features/profile/profile-activity-view-model.ts apps/web/features/profile/profile-activity-view-model.test.ts
rtk git diff --check
```

### P05：独立回归、PR 与交付

- 依赖：P04
- 文件边界：`tests/e2e/profile-activity.spec.ts`、本计划

任务提示词：

```text
新增独立 profile Activity E2E，并完成整线验证和 PR 交付。

E2E 使用 Playwright route interception 返回合成 Activity 响应，不连接真实学生数据，
不依赖 UV/F 新接口。覆盖：
- Activity 成功后统计可见且 busy 结束；
- 第一次返回 500 时出现安全失败提示；
- 点击重试后返回合法响应并恢复统计；
- 响应 body 含敏感诱饵字符串时，页面不得显示该字符串；
- 320px 窄屏不产生横向页面溢出，重试按钮可键盘操作。

随后运行目标测试、Web 全量 test/typecheck、lint、Prettier 和 diff 检查。只更新本计划
验证台账，创建独立 PR，不能自行合并，也不能为解决冲突修改 UV/F 文件。
```

完成标准：

- E2E 可单独运行、无执行顺序依赖、只用合成身份和响应；
- 目标单测、Web 全量测试、typecheck、lint、Prettier 全部退出码 0；
- `git diff --name-only` 全部位于本计划绝对文件边界；
- PR 描述逐项列出 P00-P05 证据、未运行项、风险和回退；
- Codex 审核为 `PASS` 后才允许合并。

验证命令：

```text
rtk pnpm exec playwright test tests/e2e/profile-activity.spec.ts
rtk pnpm --dir apps/web test
rtk pnpm --dir apps/web typecheck
rtk pnpm lint
rtk pnpm exec prettier --check apps/web/server/profile/learning-activity.ts apps/web/server/profile/learning-activity.test.ts apps/web/server/profile/learning-activity-service.ts apps/web/server/profile/learning-activity-service.test.ts apps/web/app/api/v1/me/activity/route.ts apps/web/app/api/v1/me/activity/route.test.ts apps/web/features/profile/profile-drawer.tsx apps/web/features/profile/profile-activity-view-model.ts apps/web/features/profile/profile-activity-view-model.test.ts apps/web/features/profile/learning-activity-loader.ts apps/web/features/profile/learning-activity-loader.test.ts tests/e2e/profile-activity.spec.ts docs/plan/completed/P-学习档案.md
rtk git diff --check
rtk git diff --name-status
rtk git status --short
```

## 七、Codex 审核标准

每个任务只能得到 `PASS`、`REVISE` 或 `BLOCKED`：

- 是否实际先用失败测试证明固定毫秒/本地时区问题；
- 是否使用明确 IANA 时区和日历日运算，而不是换一种固定毫秒写法；
- 是否保持 371 天窗口、计数、连续天数和公开 schema 兼容；
- 是否区分 empty 与 failed，失败后是否结束 busy；
- 是否防止 Abort、快速重试和旧响应覆盖新状态；
- 是否保持服务端身份单源且不接受浏览器指定主体；
- 是否没有把异常降级为 200 空数据或伪造成功；
- 是否没有泄露错误正文、堆栈、SQL、主体或 Secret；
- 是否严格保持与 UV/F 文件集合零交集；
- 是否实际运行规定命令并如实记录未运行项。

## 八、最终联合审计

P 线 PR 合并前，由 Codex：

1. 获取 F、S、P 三条线最新分支与 PR 文件清单；
2. 要求 P 线开发文件与 UV/F 开发文件交集为零；
3. 复跑两种 `TZ` 下的日期单测、Activity Route 测试、Profile Drawer 测试和目标 E2E；
4. 检查 Activity Repository、schema 和可信事件写入路径没有被修改；
5. 检查失败响应与 UI 不含主体、异常正文、堆栈或内部字段；
6. 检查 ProfileDrawer props 和 `/api/v1/me/activity` 成功响应兼容；
7. 只有所有证据成立，才将 P00-P05 标为 `PASS` 并允许合并。

## 九、风险与停止条件

| 风险                           | 处理                                           |
| ------------------------------ | ---------------------------------------------- |
| 真实需求变成“每用户可选时区”   | 停止；这需要账户契约与数据设计，另开计划       |
| 需要修改 Activity schema       | 停止；由 Codex 判断是否另开兼容任务            |
| 发现 Repository 事实口径错误   | 只报告证据；不在本计划修改 DB                  |
| 没有 DOM 组件测试环境          | 提取纯 view model；DOM/键盘行为由 P05 E2E 验证 |
| E2E 环境不可用                 | 保留 spec 和确切阻塞证据，不得伪报通过         |
| UV/F 分支意外修改 Profile 文件 | 标记`BLOCKED`，先由 Codex 重划所有权           |
| 预存工作区改动与本计划无关     | 保留，不暂存、不还原、不纳入 PR                |

## 十、验证台账

| 任务                | 状态   | 证据                                                                                       |
| ------------------- | ------ | ------------------------------------------------------------------------------------------ |
| P00 基线与所有权    | `PASS` | PR #245 已合入主线；当前实现文件与 UV/F 边界无交集                                         |
| P01 日期与时区      | `PASS` | `learning-activity.test.ts` 覆盖 Asia/Shanghai、进程 TZ 隔离和 New York 夏令时边界         |
| P02 服务与 Route    | `PASS` | service/route 测试覆盖无身份、可信主体、500、契约异常、no-store 与安全错误投影             |
| P03 Activity Loader | `PASS` | 10 条 loader 测试覆盖 ready/empty/failed/Abort、旧响应隔离和单次 fetch                     |
| P04 抽屉状态与重试  | `PASS` | PR #264；纯 view model 与 17 条相邻测试覆盖四态、重试投影及不可变边界                      |
| P05 E2E 与收口      | `PASS` | PR #265；独立 spec 通过稳定深链验证成功投影、失败脱敏与重试恢复，Codex 无重试复跑 3 次全绿 |

## 十一、回退方式

- P01 只回退日期派生与测试，不影响数据库事实；
- P02 只回退服务/Route 的错误边界与测试，成功响应契约不变；
- P03-P04 可一起回退到现有一次性 fetch，服务端和完整档案页不受影响；
- P05 只删除独立 E2E 和计划台账更新；
- 任一回退都不得回退 UV/F 合并内容或用户预存改动。
