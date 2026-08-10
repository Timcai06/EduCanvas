# 账号登录原子性与会话撤销可靠性

- 任务分配名：`A 账号会话`
- 状态：`completed`
- 负责人：协作开发者
- 实现执行：协作开发者使用 DeepSeek，每次只领取一个原子任务
- 代码审核与最终验收：Codex
- 最后验证时间：2026-07-30
- 下一领取任务：无；A00-A04 已完成并归档
- 已完成关联计划：[画布运行时与实时语音主线](UV-画布语音.md)
- 并行计划：[对象删除 Outbox 恢复与并发安全](../active/O-删除队列.md)

## 一、目标

这条线只管 Web 账号和 session 的原子性与撤销可靠性，不碰 Canvas、Runtime、语音、
Composer、Gateway 或学习事实。

交付后必须满足：

1. 注册、登录、改密和退出都只能依赖服务端权威身份，不允许浏览器伪造 userId 或 session；
2. session 只持有 token hash，原始 token 仅活在服务端准备阶段和 HttpOnly Cookie 写入阶段；
3. login / register / logout / change-password 的事务边界与 Cookie 写入边界清晰，失败时不会
   把“数据库已变更”伪装成“浏览器已登录”；
4. 退出和改密导致的旧 session 撤销在并发和重复请求下保持幂等、稳定、可测试；
5. 本计划只改 auth/session 相关文件，不触碰 Canvas、Runtime、语音、Worker、Gateway
   和 UI 外壳。

本计划不是重做账号体系，也不是引入新的 IdP。现有 `web_user_credentials`、`web_sessions`
和 `WebAccountRepository` 都保留，只补事务边界、撤销语义和测试证据。

## 二、已经确认的代码事实

| 事实                                                          | 代码证据                                                     | 本计划处理                      |
| ------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------- |
| session helper 已把原始 token 与 token hash 分离              | `apps/web/server/auth/session.ts:1-110`                      | 保持分离，不把 hash 写回 Cookie |
| 登录 route 已做 same-origin 和 rate-limit                     | `apps/web/app/api/v1/auth/login/route.ts:1-70`               | 不改变门禁，只补并发与失败证据  |
| 注册 route 已在服务端准备 session 后再写 Cookie               | `apps/web/app/api/v1/auth/register/route.ts:1-80`            | 补原子性与失败边界测试          |
| 退出 route 只通过 `revokeCurrentWebSession()` 撤销当前 Cookie | `apps/web/app/api/v1/auth/logout/route.ts:1-30`              | 补幂等与并发测试                |
| DB 账号仓储已原子创建账号和首个 session                       | `packages/db/src/web-account-repository.ts`                  | 不重做，只补缺失边界            |
| DB 账号仓储已原子改密、撤销旧 session 并创建替代 session      | `packages/db/src/web-account-repository.ts`                  | 保留事务，只补缺失并发证据      |
| `DrizzleWebSessionRepository` 只存 tokenHash / revokedAt      | `packages/db/src/web-session-repository.ts:1-50`             | 保持 raw token 不落库           |
| 现有 DB 集成测试已覆盖用户名竞态、回滚和 session rotation     | `packages/db/src/web-account-repository.integration.test.ts` | 不重复已有用例                  |
| session helper、logout route 和 session repository 无直接测试 | 对应测试文件不存在                                           | 本计划优先补齐                  |

如果实现时发现上述事实已经变化，先停止当前任务，由 Codex 更新本表与依赖图。

## 三、绝对文件边界

本计划只允许修改或新增：

- `apps/web/server/auth/session.ts`
- `apps/web/server/auth/session.test.ts`
- `apps/web/server/auth/account-repository.ts`
- `apps/web/server/auth/account-repository.test.ts`
- `apps/web/app/api/v1/auth/login/route.ts`
- `apps/web/app/api/v1/auth/login/route.test.ts`
- `apps/web/app/api/v1/auth/logout/route.ts`
- `apps/web/app/api/v1/auth/logout/route.test.ts`
- `apps/web/app/api/v1/auth/register/route.ts`
- `apps/web/app/api/v1/auth/register/route.test.ts`
- `packages/db/src/web-session-repository.ts`
- `packages/db/src/web-session-repository.integration.test.ts`
- `packages/db/src/web-account-repository.ts`
- `packages/db/src/web-account-repository.integration.test.ts`
- 本计划文件

除上述文件外一律不得修改。特别禁止修改：

- Canvas、Runtime、语音、Composer、Gateway、Worker、对象删除 outbox；
- 任何 schema/migration 输出；
- 学习事实、教学事件、Card/Canvas 资源协议；
- 其它 active 计划文件和既有未提交改动；
- 根目录预存删除或其它协作开发者未提交文件。

若必须越界才能完成当前任务，立即停止并向 Codex 报告。不能复制 session helper、
不能引入第二套会话存储，也不能靠前端隐藏按钮假装完成退出。

## 四、DeepSeek 共同提示词

```text
你只执行“账号登录原子性与会话撤销可靠性”计划当前指定的一个 A 任务。
先阅读仓库根 AGENTS.md、CLAUDE.md、本计划和当前任务涉及的源码及相邻测试。

硬边界：
- 每条 shell 命令都必须以 rtk 开头；
- 只能修改本计划“绝对文件边界”列出的文件；
- 不改 Canvas、Runtime、语音、Worker、对象删除 outbox、Gateway 或其它活跃计划；
- 不把原始 session token、cookie、密码、hash 或栈信息带出服务端边界；
- 不新增第二套 session helper、第二套 Cookie 名或新的登录状态机；
- 不 reset、restore、checkout、stash、rebase，不格式化任务外文件；
- 发现需要越界、基线不一致或验收无法执行时，立即停止并报告。

实施规则：
- 先补能证明缺口的失败测试，再做最小实现；
- 一个文件只承担一个可命名职责，接近 400 行时主动评估拆分，禁止超过 600 行；
- 不靠 snapshot 大面积覆盖真实断言；
- 保持 same-origin、rate-limit、HttpOnly Cookie 和 token hash-only 的服务端边界不变。

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
A00 → A01 → A02 → A03 → A04
```

如果以后拆给两名协作者，可在 A00 后分成：

```text
               ┌→ A02 route / helper ─┐
A00 → A01 session ─┤                  ├→ A04 收口
               └→ A03 integration ────┘
```

并行仅表示任务依赖允许，不允许两人修改同一文件。A01 和 A02 可以并行，但不能同时改
同一 helper 文件。

## 六、原子任务

### A00：基线、事实与所有权冻结

- 依赖：无
- 文件边界：本计划
- 可并行：否

```text
只做只读盘点，不修改产品源码。

1. 记录 HEAD、origin/main、当前分支和 worktree；
2. 记录 git status --short，明确哪些是预存改动；
3. 核对 session helper、WebAccountRepository、web-session 仓储和 login/logout/register 路由的真实事实；
4. 明确 raw token、token hash、Cookie 和数据库之间的边界；
5. 只更新本计划验证台账，不改任何源码。
```

完成标准：

- 每条当前事实都有真实路径和 `file:line`；
- 没有把文档、历史 PR 或未运行测试写成 passed；
- 与其它 active 计划的开发文件交集为零；
- 不把“已有登录功能”误报为“session 撤销闭环已完成”。

验证命令：

```text
rtk git rev-parse HEAD
rtk git rev-parse origin/main
rtk git status --short
rtk rg -n "prepareWebSession|createWebSession|writeWebSessionCookie|revokeCurrentWebSession|web_sessions|login|logout|register" apps/web/server/auth packages/db/src/web-session-repository.ts apps/web/app/api/v1/auth
```

### A01：session helper 与仓储契约收口

- 依赖：A00
- 文件边界：`apps/web/server/auth/session.ts`、`packages/db/src/web-session-repository.ts`

```text
先在 session.test.ts 或 web-session-repository.integration.test.ts 增加失败/并发证据，再做最小实现。

要点：
- `prepareWebSession` 只在服务端生成原始 token，tokenHash 才能落库；
- `createWebSession`、`revokeCurrentWebSession` 和 `revokeByTokenHash` 的语义要幂等；
- `findActiveRegisteredUserIdByTokenHash` 必须隐藏过期 / revoked session；
- 不能把 raw token、cookie 名或用户输入写回数据库或日志。
```

完成标准：

- 有 session helper 的单元测试；
- 有 web-session-repository 的集成测试；
- token hash-only、过期、revoked、重复撤销都能被测试证明；
- 不引入新的 session 字段或 API。

### A02：登录 / 注册 / 退出路由的原子边界

- 依赖：A01
- 文件边界：`apps/web/app/api/v1/auth/login/route.ts`、`apps/web/app/api/v1/auth/logout/route.ts`、`apps/web/app/api/v1/auth/register/route.ts` 及其 route.test

```text
把 route 层的“先事务、后 Cookie、再返回”的边界写死。

要点：
- same-origin、rate-limit 和 JSON 校验仍然是第一道门；
- 登录/注册成功后才写 HttpOnly Cookie；
- 退出必须幂等，重复调用不会泄露失败细节；
- 失败响应只能返回稳定码和固定文案，不得透传内部异常。
```

完成标准：

- route tests 覆盖 same-origin、重复退出、Cookie 写入失败边界和稳定错误码；
- 登录/注册/退出不把 token hash、密码或 session 原始内容带回浏览器；
- 代码没有引入新的请求参数或状态字段。

### A03：改密与并发撤销证据

- 依赖：A01、A02
- 文件边界：`apps/web/server/auth/account-repository.ts`、`apps/web/server/auth/account-repository.test.ts`、`packages/db/src/web-account-repository.ts` 及其测试

```text
先盘点既有账号集成测试，只补尚未覆盖的“改密、退出和并发撤销”场景，不重写已存在的
账号创建、回滚、唯一键竞态和 session rotation 事务。

要点：
- 旧密码验证成功后，改密与新 session 写入必须走同一原子边界；
- 旧 session 在并发登录 / 改密 / 退出下不会复活；
- invalid_credentials、invalid_current_password 和 credential_changed 的映射保持稳定。
```

完成标准：

- 既有并发 rotation 用例继续通过，并新增缺失的改密 / 退出交错测试；
- 旧 session 在撤销后无法再次认证；
- 失败码稳定且不泄露内部异常；
- 不修改 user/profile 以外的账号事实。

### A04：验证台账、文档与收口

- 依赖：A03
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

| 任务                    | 状态   | 证据                                                                        |
| ----------------------- | ------ | --------------------------------------------------------------------------- |
| A00 基线与所有权        | `PASS` | 基线审计完成，事实表见下                                                    |
| A01 session helper 收口 | `PASS` | PR #252；session 单元测试 17 条；session repository 集成测试 7 条           |
| A02 路由原子边界        | `PASS` | PR #253；login、register、logout 路由边界测试补齐                           |
| A03 改密与并发撤销      | `PASS` | PR #256；account repository 新增 7 条认证、改密和 session rotation 边界测试 |
| A04 台账与收口          | `PASS` | PR #255；Codex 核对 A01-A03 已合并且 CI 全绿，台账与真实合并状态一致        |

### A00 审计事实（2026-07-30）

| 文件                                         | 关键事实                                                                                                                                            |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/server/auth/session.ts`            | `prepareWebSession` 生成 32 字节 token → SHA-256 hash，raw token 不落库；事务成功后才写 Cookie；撤销后再删除 Cookie；A01 已补单元测试。             |
| `packages/db/src/web-session-repository.ts`  | active session 查询绑定 registered/active user、过期时间与 revoked 状态；撤销只更新尚未 revoked 的行；A01 已补集成测试。                            |
| `apps/web/app/api/v1/auth/login/route.ts`    | same-origin、rate-limit、输入校验、认证、失败计数复位、session 创建与 Cookie 写入边界由 A02 路由测试覆盖。                                          |
| `apps/web/app/api/v1/auth/logout/route.ts`   | same-origin 与幂等撤销边界由 A02 路由测试覆盖。                                                                                                     |
| `apps/web/app/api/v1/auth/register/route.ts` | raw token 仅在内存和 Cookie 边界使用，仓储只接收 token hash；A02 路由测试覆盖跨域、稳定失败码和敏感字段防泄漏。                                     |
| `apps/web/server/auth/account-repository.ts` | `authenticate`、`registerAndCreateSession`、`changePasswordAndRotateSession` 沿用单一账号仓储；A03 已补认证失败、改密失败和 session rotation 测试。 |

**文件交集检查**：本计划 14 个边界文件与 UV/P/O 三条线的文件无交集。

### A01 证据（PR #252）

- `apps/web/server/auth/session.test.ts`：17 条测试，覆盖 session 准备、创建、Cookie 写入、撤销幂等和身份读取。
- `packages/db/src/web-session-repository.integration.test.ts`：7 条测试，覆盖创建、过期、撤销幂等、缺失 hash 与跨用户隔离。
- 源码契约未改变。

### A02 证据（PR #253）

- login、register、logout 路由测试覆盖跨域拒绝、稳定错误映射、Cookie/撤销失败和敏感字段防泄漏。
- 路由源码未改变。

### A03 证据（PR #256）

- `apps/web/server/auth/account-repository.test.ts` 新增 7 条测试，覆盖认证、当前密码错误、未注册用户和改密后 session rotation。
- PR 的 secret-scan、checks、integration、windows 与 E2E 全部通过。
- 仓储源码未改变。

### 最终验证

- A01、A02、A03 已按依赖顺序合并。
- `git diff --check` 通过。
- A04 仅修改本计划文件。
- 未新增字段、API 或第二套会话系统。
- raw token 不落库、HttpOnly Cookie 边界保持。

## 八、Codex 审核标准

每个任务只能得到 `PASS`、`REVISE` 或 `BLOCK`：

- 是否严格限制在 auth/session 与 WebAccountRepository 边界；
- 是否保持 raw token 不落库、token hash-only、HttpOnly Cookie 的边界；
- 是否没有把登录、注册、退出和改密伪装成前端交互问题；
- 是否用并发、重复请求和撤销场景证明幂等；
- 是否没有新增第二套会话系统或新的请求参数；
- 是否实际运行了计划要求的验证命令。
