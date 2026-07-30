# ADR-0019：持久 Web Runtime 的隔离与安全边界

- 状态：`accepted`
- 日期：2026-07-29
- 负责人：@Timcai06

## 背景

当前 Canvas 已支持轻量 HTML 片段的即时预览，但缺少持久、可恢复、可审计的 Web Runtime 运行层。
S3 计划中的 U09 仅定义持久 Runtime 的架构边界与安全模型，不实现运行能力，且不改变现有 `sandbox-preview.ts`。

## 当前实现与缺口

### 已确认事实

- `apps/web/features/canvas/sandbox-preview.ts` 仅是轻量的一次性 `srcdoc` 预览构建器；
- iframe 仅使用 `SANDBOX_IFRAME_PERMISSIONS = 'allow-scripts'`，不包含 `allow-same-origin`；
- 构建出的 CSP 为 `default-src 'none'`，并显式禁止 `frame-src`/`form-action`，不提供主页面可达网络；
- 当前实现没有持久 Runtime 生命周期、运行记录、版本化消息桥和依赖策略；
- `CanvasResource`、`Artifact Version`、`Operation` 为当前事实来源，Canvas 不改变这些事实主权；
- Tier 2（如持久 Web Runtime）不直接向 `mastery`、`learning_events` 或其他学习事实写入。

### 缺口（U09 仅决策，不实现）

- 缺少持久 Runtime 的信任边界、生命周期模型和恢复策略；
- 缺少 Runtime 与宿主双向通信的版本化白名单协议；
- 缺少依赖白名单、资源配额和供应链约束的统一文档；
- 缺少跨 Notebook/Artifact 的隔离与可审计终态行为定义。

## 保护资产

- 用户隐私：Cookie、Credential、本地持久化存储、会话 token、用户私有 Source；
- 服务端事实完整性：Notebook、Source、Artifact、Operation、学习事实链路；
- 执行安全：Runtime 执行沙箱边界与消息桥；
- 平台信誉：CSP、依赖供应链、审计日志与故障行为的一致性；
- 可用性：超时、取消、崩溃可恢复能力与稳定终态定义。

## 攻击者与攻击入口

- 远程或本地注入的恶意 Artifact 内容（HTML/脚本）；
- 伪造/回放版本化消息（host→sandbox、sandbox→host）；
- 依赖注入（非白名单包、漂移版本、远程 CDN 引用）；
- 利用 iframe 能力逃逸（同源、弹窗、导航、表单、下载、嵌套 iframe）；
- 运行记录与审计伪造、终态乱序与状态重放。

## 信任边界

- 服务端权威层：重新校验身份、Notebook/Artifact 权限和不可变版本绑定，并持久化运行终态与审计记录；
- 浏览器 Host：只负责展示、局部协议校验和转发用户意图，不是身份、权限、Artifact 归属或审计事实源；
- Runtime Adapter：仅承载服务端已授权的不可变 `Artifact Version`，并将 side effect 限制为声明性输出；
- Messaging 网关：浏览器 Host 与 sandbox 的唯一通信入口，执行实例绑定、版本/类型/大小/顺序验证；
- 依赖与资源卫兵：在运行前验证 manifest，与宿主仓库审计清单一致；
- 数据面：不能跨 Notebook、跨 Source、跨用户共享运行上下文。

## 候选方案

### 方案一：扩展现有 `srcdoc preview` 承担持久 Runtime

- 做法：复用现有 `buildSandboxDocument` 与 iframe，追加生命周期与消息桥；
- 优点：改动小、最短路径；
- 风险：会将轻量预览语义与持久 Runtime 混淆，导致信任边界与恢复模型不清晰；
- 结论：不采纳。

### 方案二：独立 Tier 2 Web Runtime Adapter（推荐）

- 做法：保留 `sandbox-preview.ts` 作为当前轻量预览；新增独立持久 Runtime Adapter；
- 优点：边界清楚，runtime 生命周期与轻量预览解耦，可独立演进与治理；
- 风险：实现成本更高，需新增 adapter 运行态文档与守卫；
- 结论：采纳。与既有轻量预览复用 CSP 与 iframe 安全原则，但不复用生命周期。

### 方案三：独立服务或独立站点承载 Runtime

- 做法：通过跨站服务/站点运行 Web Runtime；
- 优点：可实现最强运行环境隔离；
- 风险：引入额外部署面、会话联接与跨域边界，延迟与治理成本高；
- 结论：不采纳（本阶段后置）。

## 决定

- 采用**独立 Tier 2 Web Runtime Adapter**。
- 现有 `sandbox-preview.ts` 维持“轻量、一次性、非持久”定位，仅服务于短时源码预览与兼容行为验证；
- 持久 Runtime 只运行已发布且不可变的 `Artifact Version`；
- Runtime 与 Host 的通信全部使用版本化白名单消息；
- 依赖源、版本、配额由仓库审计清单与治理入口统一定义；
- 默认网络关闭，默认不允许 Cookie/会话/同源访问。
- 浏览器提供的 Notebook、Artifact、版本、动作和终态都不作为服务端可信事实；run/cancel 等动作在服务端重新鉴权。

## 安全不变量

- 不允许 `allow-same-origin`；
- 不允许宿主 Cookie、Credential、`localStorage`、可信会话传递；
- 默认无网络；禁止任意 `fetch`、`WebSocket`、`EventSource`、远程 CDN；
- 禁止嵌套 iframe、表单提交、弹窗、下载与顶层导航；
- Host↔Sandbox 双向消息必须版本化白名单；
- 无 `allow-same-origin` 的 sandbox 消息来源为不透明 origin，不能把 `event.origin === "null"` 当作身份依据；
- Host 入站必须同时校验 `event.source`、每实例随机且不可记录的 channel nonce、Runtime ID、Artifact Version ID、消息版本、类型、大小、顺序与终态语义；
- Sandbox 入站必须校验消息来自 `parent` 且携带当前实例 channel nonce；reload、重建或销毁实例时旧 nonce 立即失效；
- 未知消息、重复终态、终态后消息、越权动作为 fail-closed；
- 依赖仅允许精确包名与锁定版本；
- 不允许运行时 `npm install`、`import()` 远程模块；
- Runtime 不能读取其他 Notebook、Source、Artifact 或用户私有数据；
- Tier 2 事件不能直接写 `mastery`、`learning_events` 或其他学习事实；
- 取消、超时、崩溃与输出超限必须落入稳定可审计的终态；
- 浏览器响应与日志不得暴露 Cookie、Credential、Prompt、私有 Source、堆栈、宿主路径；
- 不支持的 Runtime、版本、依赖或 capability 必须返回 `unavailable`（不可伪装成成功）。

## 资源与配额原则（proposed policy）

- 资源维度采用 U11 门禁任务完成后的固定上界：CPU/时长、内存、输出体积、并发实例与队列深度；
- 既有 `CanvasResource.runtime.kind = web_sandbox` 协议已经给出 300,000 ms 与 5 MiB 的绝对上界；U11 只能选择不超过该协议上界的更小平台策略，不能把协议上界误写成已验证的安全运行值；
- 配额数字目前不以已验真实测为基础，保持为**提议值**并要求 U11 以守卫测试固化；
- 任何超过阈值行为应产生明确终态（`failed`/`rejected`/`unavailable`）与稽核证据；
- 未验证的数字不写入实现文档，仅在 U11 完成后将“proposed policy”转入受控常量。
- 同一浏览器进程中的 iframe 不能先验保证硬 CPU/内存隔离；U12 必须用不合作死循环和内存压力验证宿主仍可响应并销毁 Runtime。若无法证明，方案二不得宣称“硬配额”成立，必须升级到可终止 Worker、独立 origin/process 或方案三。

## 失败、取消与审计

- 预检失败与运行生命周期分离：不支持、未配置或未授权在启动前返回 `unavailable`/`rejected`，不能伪装成一次已运行任务；
- 进入执行后的状态至少区分 `running` 与 `succeeded`、`failed`、`cancelled` 三类终态，并沿用仓库 `cancelled` 拼写；
- timeout、crash、quota exceeded 是稳定 failure code，不在 U09 提前发明新的持久状态枚举；最终版本化状态契约由 U10 定义；
- 非终态回报不能触发最终持久化；
- 终态后不得接收任何附加消息；
- 取消链路应显式终止执行并带清理结果；
- 超时与崩溃应记录失败码与重试边界，避免隐式成功；
- 审计日志由服务端持久化请求 ID、Notebook ID、Artifact Version ID、Runtime ID、终态与稳定错误码；不得记录 channel nonce、源码、Prompt、私有 Source、原始消息或浏览器堆栈。

## 与轻量 sandbox-preview 的关系

- `sandbox-preview.ts` 继续用于轻量、低风险、一次性渲染，不承担恢复、版本追踪、消息会话或依赖治理；
- 持久 Runtime Adapter 不复用该预览生命周期；
- 两者共享同一安全基线（如 CSP 白名单思想与最小 iframe 授权），但不共享运行时控制平面。

## 后果与残余风险

- U09 决策不立即带来行为变化；实现阶段仍需通过 U10/U11/U12 完成；
- 残留风险：
  - 运行时依赖供应链治理依赖持续更新清单；
  - 长时任务的可观测性与成本治理依赖 U12 与 U11 联动；
  - 浏览器内 iframe 对死循环、内存压力和进程级隔离的保证取决于浏览器实现，必须通过 U12 的非合作负载门禁，否则回退到更强隔离方案；
  - 未声明的外部输入仍可能通过业务漏洞进入沙箱外层接口。

## 假设、范围外风险与严重度

- 假设受支持浏览器正确实现 iframe sandbox、CSP 与进程隔离；浏览器引擎自身漏洞不由本项目修复，但发现隔离逃逸时必须视为发布阻断。
- 物理设备、操作系统管理员权限和浏览器扩展劫持不在 Runtime 应用边界内；服务端仍不能因此信任浏览器传入的权限事实。
- `Critical`：获取宿主 Cookie/Credential、跨 Notebook 私有数据，或绕过服务端直接写可信学习事实。
- `High`：建立未授权网络通道、执行未审计依赖、跨 Runtime 实例控制，或用不可终止负载阻塞宿主产品。
- `Medium`：绕过单实例资源上限、污染审计关联或泄露稳定内部标识，但没有跨主体数据或可信写入。
- `Low`：不包含敏感信息的错误展示、可恢复的单实例失败或仅影响开发诊断的偏差。

## 与 U10/U11/U12 的关系

- U10：定义 host↔sandbox 消息、状态机与终态约束；
- U11：固化依赖白名单、版本策略、CSP/网络守卫与配额上限；
- U12：实现独立 Runtime Adapter、浏览器层隔离、重载与 smoke 守护。
- U12 还必须证明不合作死循环不会永久阻塞宿主；无法证明时停止并重新评估独立 origin/process 方案，不得以普通 happy-path smoke 代替。

## 验证方式

- 通过本 ADR 的安全测试矩阵覆盖负例；
- `apps/web/features/canvas/sandbox-preview.ts` 保持当前轻量实现不变；
- 本 ADR 已通过 Codex 安全复审并由项目负责人 @Timcai06 于 2026-07-29 接受；U10 与 U11
  可以并行启动，U12 仍须等待二者分别完成并通过复审。
