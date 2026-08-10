# 持久 Web Runtime 安全测试矩阵

## 目标

本矩阵用于 U09 决策后的负面安全验证设计，覆盖持久 Web Runtime 的隔离边界、消息安全、资源治理和审计能力。
U09 本身只定义模型与预期；测试用例按责任切分给 U10、U11、U12。
当前共 28 条负例；数量不是通过标准。U10/U11 已完成契约或策略层证据，U12 已通过独立
origin/process Runtime、服务端授权、浏览器组合与非合作负载压力测试完成运行时验证。
下表保留任务执行时的逐项状态作为审计轨迹；不再把其中的 `runtime_pending` 或 R28
`blocked` 解释为当前实现状态。

| 编号 | 分类                                 | 攻击或失败场景                                                                              | 前置条件                            | 预期结果                                                         | 自动化层级                          | 归属任务  | 当前状态                               |
| ---- | ------------------------------------ | ------------------------------------------------------------------------------------------- | ----------------------------------- | ---------------------------------------------------------------- | ----------------------------------- | --------- | -------------------------------------- |
| R01  | 同源、Cookie 与 Credential           | 沙箱 iframe 被错误配置为 `allow-same-origin`，导致注入脚本可访问主页面 `document` 与 Cookie | Host 允许构建 iframe 字符串并执行   | `sandbox` 创建失败或被拒绝启动，记录 fail-closed 终态            | U11（构建层静态检查+tooling）       | U11       | policy_pass                            |
| R02  | 同源、Cookie 与 Credential           | Runtime 内部脚本调用 `document.cookie`、`localStorage` 或注册 Service Worker                | Runtime 处于不透明 origin           | 访问被拒绝、抛出安全错误或只能看到沙箱自身空值；绝不取得宿主数据 | U12（沙箱运行冒烟）                 | U12       | proposed                               |
| R03  | 网络与远程依赖                       | 运行时执行 `fetch("https://evil.example")`                                                  | Runtime 已启动                      | 受控网络观察端收到 0 个请求；Runtime 返回稳定网络禁用错误        | U11（CSP 守卫）+U12（浏览器 smoke） | U11 / U12 | policy_pass / runtime_pending          |
| R04  | 网络与远程依赖                       | 运行时创建 `WebSocket`、`EventSource` 或远程动态 `import()`                                 | Runtime 已启动                      | 连接均未建立；任务保持安全失败或进入 `failed`，不产生新终态枚举  | U11（守卫）+U12（浏览器 smoke）     | U11 / U12 | policy_pass / runtime_pending          |
| R05  | iframe、导航、表单、弹窗与下载       | Runtime 试图调用 `window.open` 发起弹窗                                                     | 运行时消息环境允许弹窗 API          | 弹窗被阻断，审计记录 `blocked`                                   | U12（浏览器层 smoke）               | U12       | proposed                               |
| R06  | iframe、导航、嵌套与表单             | Runtime 试图 `form.submit()` 或导航到外部顶层                                               | HTML 中包含可提交/可导航行为        | 不发生顶层跳转，不触发表单提交，返回 fail-closed 终态            | U12（e2e/adapter）                  | U12       | proposed                               |
| R07  | host→sandbox 消息                    | Host 发送未注册消息类型给 sandbox                                                           | Host messaging 桥未校验消息白名单   | Host 侧拒绝发送并记录错误；sandbox 无状态变化                    | U10（消息契约测试）                 | U10       | contract_pass                          |
| R08  | host→sandbox 消息                    | Host 发送超出版本约束或错误 `messageVersion` 的控制消息                                     | 桥接层缺失版本校验                  | Host 侧拒绝并返回不可恢复错误，不执行 runtime 命令               | U10（schema + 单测）                | U10       | contract_pass                          |
| R09  | sandbox→host 消息                    | Runtime 发送未授权操作（如 `write_mastery`）                                                | 消息接收方仅按白名单验证            | Host 拒绝并保持 fail-closed，事件不写入学习事实                  | U10（状态机/授权测试）              | U10       | contract_pass                          |
| R10  | sandbox→host 消息                    | Runtime 发送高频事件洪泛导致主端事件风暴                                                    | 缺少消息频率限制                    | 超限消息被拒绝，任务进入 `failed` 并记录稳定 quota failure code  | U10（协议）+U11（阈值）             | U10 / U11 | contract_policy_pass / runtime_pending |
| R11  | 消息版本、乱序、重复终态和终态后消息 | Message 包缺少 `id`/`version` 或版本回退                                                    | 桥未做消息签名与幂等检查            | 该条消息被拒绝且不改变状态机                                     | U10（schema 与状态机）              | U10       | contract_pass                          |
| R12  | 消息版本、乱序、重复终态和终态后消息 | Runtime 已达 `terminal` 后发送第二条终态                                                    | 容器未执行终态熔断                  | 重复终态被拒绝，保留首个终态并打上重放告警                       | U10（状态机单测）                   | U10       | contract_pass                          |
| R13  | 输入、消息、输出、时长与资源超限     | 输入 Artifact 体积/消息体超过约定上限                                                       | U11 配额未绑定                      | 超限请求直接拒绝，不进入运行状态                                 | U11（tooling 守卫）                 | U11       | policy_pass / adapter_pending          |
| R14  | 输入、消息、输出、时长与资源超限     | Runtime 输出日志或结果超限（巨量 DOM/字符）                                                 | 输出聚合器未做裁剪                  | 输出截断并进入 `failed` 或 `unavailable`，并记录超限码           | U11（契约 + U12 运行）              | U11 / U12 | policy_pass / runtime_pending          |
| R15  | 取消、超时、崩溃与重新加载           | 用户取消后 Runtime 未结束，仍继续写入结果                                                   | 取消信号未下发到 runtime 生命周期   | 取消终止执行并输出 `canceled`；无后续 side effect                | U12（adapter 冒烟）                 | U12       | proposed                               |
| R16  | 取消、超时、崩溃与重新加载           | 超时与崩溃后状态机停留在 running                                                            | Runtime 运行后无法复位              | 收敛到 `failed`，以稳定 timeout/crash failure code 区分原因      | U10（状态机）+U12（运行）           | U10 / U12 | contract_pass / runtime_pending        |
| R17  | Artifact Version 与跨 Notebook 隔离  | Runtime 使用了另一个 Notebook 的 Artifact Version                                           | 运行上下文缺失 Notebook 绑定校验    | 服务端拒绝运行并返回不可探测结果，不泄漏目标 Notebook 信息       | U12（服务端集成）                   | U12       | proposed                               |
| R18  | Artifact Version 与跨 Notebook 隔离  | 重复 Artifact Version 在不同 Notebook 被误复用状态日志                                      | 缺少可追踪日志维度                  | 每次请求必须包含与绑定一致的 Notebook+version+hash；不一致拒绝   | U10（事件元数据验证）+U12（运行）   | U10 / U12 | contract_pass / runtime_pending        |
| R19  | 学习事实隔离                         | Runtime 试图触发 `learning_events` 写入路径                                                 | 事件路由未隔离写入口                | 拒绝写入学习事实，返回 `operation_unsupported`                   | U10（授权与路由）                   | U10       | contract_pass                          |
| R20  | 学习事实隔离                         | Runtime 返回高可信“授予成绩”型 payload 伪装学习事件                                         | 审计层缺少 schema 校验              | 严格 schema 验证失败，事件不进入教学事实                         | U10（schema）                       | U10       | contract_pass                          |
| R21  | 依赖锁定与供应链                     | Runtime 请求未在清单中的依赖（`lodash` 非白名单版本）                                       | 依赖解析链路未生效                  | 运行拒绝启动，返回明确不可恢复错误码                             | U11（依赖清单测试）                 | U11       | policy_pass                            |
| R22  | 依赖锁定与供应链                     | 声明相似包名/篡改版本（如 `react@latest` 或 typo-squatting）                                | 仅做字符串包含检测                  | 解析器必须精确匹配 `name+version`，否则 reject                   | U11（守卫）                         | U11       | policy_pass                            |
| R23  | 日志、错误和审计信息泄漏             | 运行失败日志暴露私有 Source、prompt、cookie、channel nonce 或宿主文件路径                   | 日志串联未脱敏                      | 仅输出稳定 ID 和错误码；敏感字段不进入日志                       | U10（安全错误契约）+U12（实现测试） | U10 / U12 | contract_pass / runtime_pending        |
| R24  | 日志、错误和审计信息泄漏             | 统一错误信息回传完整堆栈导致路径泄漏                                                        | 错误透传缺少代理层过滤              | host 返回稳定安全码，不暴露敏感细节                              | U10（错误契约）+U12（实现测试）     | U10 / U12 | contract_pass / runtime_pending        |
| R25  | 跨实例消息与不透明 origin            | 同页面旧 iframe 或恶意 sibling Window 发送形状合法的 Runtime 消息                           | sandbox 消息 `origin` 同为 `"null"` | `event.source` 或 channel nonce 不匹配即拒绝，目标实例状态不变   | U10（消息契约）+U12（浏览器 smoke） | U10 / U12 | contract_pass / runtime_pending        |
| R26  | 跨实例消息与不透明 origin            | Runtime reload 后重放旧实例的 channel nonce 和终态消息                                      | 新实例已创建                        | 旧 nonce 已失效；重放被拒绝且不污染新实例终态                    | U10（重放单测）+U12（reload smoke） | U10 / U12 | contract_pass / runtime_pending        |
| R27  | 服务端权限重校验                     | 浏览器 Host 伪造 Notebook ID、Artifact Version ID 或 run/cancel 动作                        | 客户端已通过本地 UI 校验            | 服务端重新解析身份和归属并拒绝越权，不返回目标是否存在           | U12（服务端集成/E2E）               | U12       | proposed                               |
| R28  | 非合作负载与宿主可用性               | Runtime 执行无限循环或持续内存增长，且不响应取消消息                                        | Browser Runtime 已启动              | 宿主仍可响应并销毁实例；无法证明时阻断 U12 并升级隔离方案        | U12（受控浏览器压力 smoke）         | U12       | blocked：缺少可强制终止的隔离边界      |

## 责任映射与 U09 限制

- U10：消息版本、实例凭据、主客协议、状态机与安全错误契约（R07-R12、R16、R18-R20、R23-R26）；
- U11：依赖锁定、CSP/网络默认禁用与资源策略守卫（R01、R03-R04、R10、R13-R14、R21-R22）；
- U12：运行时行为、服务端重新授权、安全日志、弹窗/导航/表单/下载、跨 Notebook/reload、非合作负载和浏览器隔离（R02-R06、R15-R18、R23-R28）。

## U12 最终状态（2026-08-10 回写）

- U10/U11 的 `contract_pass` / `policy_pass` 只表示 schema、状态机或策略守卫已有自动化证据。
- 表内 `runtime_pending` / `adapter_pending` 是 U12 前的设计期标记；U12 已完成真实 Adapter、服务端与浏览器行为验证。
- U11 已将配额、并发、超时固化为可执行策略；这些值仍不是硬 CPU/内存隔离保证。
- 当前使用独立 Runtime origin/process、受控 bootstrap 与可销毁实例；R28 的非合作负载由
  独立压力 harness 证明宿主仍可响应并强制销毁实例。该证据不等于任意代码执行或生产级
  容器隔离，Tier 3 Experiment Runtime 仍走独立受控计算边界。
