# 后端工程

- 状态：`draft`

## 当前主选

- 当前本地拓扑：Next.js Web/BFF + EduCanvas Gateway + graphile-worker + PostgreSQL；
- 控制平面：云端部署目标的 EduCanvas Gateway，每用户逻辑隔离，可选出站设备 Node；
- Web：Next.js Server Component、Server Action 和 Route Handler，已通过兼容层作为Gateway Client；
- 数据：PostgreSQL + Drizzle，二进制进入对象存储；
- 长任务：graphile-worker；
- 模型：`model-gateway` Provider Adapter；
- 观测：Gateway已有安全结构化日志和进程内低基数指标；外部OpenTelemetry/SLO后端尚未接入。

Redis、Temporal、Kafka、Python 服务和独立 core API 都不是当前既定依赖；真实需求出现时另行决策。

## 阶段一已实现边界

- 匿名身份使用32-byte随机base64url bearer，仅保存在HttpOnly、SameSite=Lax Cookie中；数据库只保存`anon:v1:<sha256>`派生标识；
- `local`模式的Web首次课程必须复用固定registered identity，只有带有效bearer的匿名身份可在没有活动课程时轮换，避免Web与TUI落入不同Notebook；
- 课程bootstrap在一个PostgreSQL事务内创建或复用Session，并保存公开Artifact与私有判分键；并发请求通过事务级advisory lock收敛到同一会话；
- Server Action不接受客户端session或student字段，而是从Cookie和固定课程范围恢复归属；
- `GradeCanvasSubmissionService`在事务内再次校验可信学生对session的归属，再判分、追加可信事件并更新掌握度投影；
- 页面读取只返回公共Artifact和Progress DTO，私有判分键不进入浏览器。

## 真实 Agent Turn 当前边界

- `POST /api/v1/learn/turn`只接受受限正文和`clientMessageId`，从服务端匿名身份恢复Session，不接受浏览器声明学生或Session归属；
- Web组合根通过`packages/model-gateway`创建可配置的OpenAI-compatible SSE Adapter；未配置或配置非法时写入诚实失败态，不回退到脚本回答；
- Web Teaching Profile把K12 Prompt、安全、教学状态与领域回调注入唯一`TurnApplicationService`；当前生产组合通过统一Tool Kernel注册只读`getStudentState`与`retrieveKnowledge`，工具可见性由可信教学状态、Actor/Agent/Notebook/Profile/入口/环境能力交集和Adapter共同收敛；
- Provider事件先归一为`teaching-core`协议，再由Route映射成版本化EduCanvas SSE；供应商chunk、模型ID、Key和原始异常不进入浏览器；
- 学生消息、老师消息和安全决策继续保留K12领域形状；Model Run、Tool Call与Turn Context Snapshot改为统一`agent_operation`账本归属，同一`clientMessageId`具备幂等/冲突语义，成功老师消息必须能够追溯到同一Operation的成功Model Run；
- `agent-runtime`按消息数/字符预算选择最新完整历史，Web在创建Turn时把选择的消息ID、AssetVersion ID、builder版本和计数与消息/Model Run原子落账；历史不能注入`system`角色；
- 已实现单Session活动Turn约束、PostgreSQL窗口限流、Turn租约/heartbeat、显式取消、过期收敛和刷新消息恢复；浏览器断连不等同于学生取消；
- 已定义`educanvas.operation-continuation.v1`并建立最小化PostgreSQL控制账本：一个Operation可按序保留多个历史等待点、同一时刻仅一个活动等待点。approval通过后，决策事件、ready游标与Graphile任务原子提交；worker以owner + generation + expiry领取，恢复前重算Agent/Membership/Conversation/approval，continuation与Operation终态原子提交。Turn Application已把L2/L3从失败终态改为“Schema验证→pending Tool Call→Adapter耐久准备→approval.required无终态挂起”；`educanvas.tool-approval-intent.v1`仓储已把prepared意图与Gateway事件、Approval、continuation原子绑定，缺少或漂移的意图整笔拒绝，过期prepared记录由有界维护任务收敛。生产Node/MCP Adapter仍待后续纵切，因此尚不是可用的高风险工具产品能力；
- continuation取消以PostgreSQL请求为跨进程事实：等待态立即原子取消，运行态由Worker heartbeat/结算观察，未过期lease触发Graphile重试而不是误报成功，过期后用新generation重领；
- 输入在Provider前经过确定性K12安全判断，输出delta在发给浏览器前经过流式安全Gate；这只是阶段一工程基线，不等于生产级未成年人治理已经完成。

通用与K12对话 Turn 都由`TurnApplicationService + AgentLoopEngine + ToolKernel`执行，圈数配额3；`webSearch`负责发现候选，只有`fetchWebPage`实际读取成功的网页才会落为不可变Link AssetVersion并进入`operation_sources`白名单。最终正文只把真实出现的合法`[n]`提升为Citation。Gateway Operation与通用/K12 Turn复用同一ID并记录Actor、Agent、Notebook和标准事件；模型、工具与上下文详细审计写统一Turn Ledger，学习安全和掌握度仍写教育领域账本。

当前已确认的平台化剩余缺口包括：

- Answer 已包含有界的持久化会话历史与本轮物化 Asset 文本，但尚不包含摘要或 Artifact 状态；
- Web BFF仍承担lease、取消、安全、引用与SSE兼容投影，后续可继续削薄，但已不拥有通用身份/路由或第二套循环；
- Node、MCP与AI SDK Provider Adapter尚未完成生产接线；MCP Credential和恶意输出边界仍需M5验收；
- 图片虽然可作为 Asset 保留原生引用，但当前文本 Provider 不消费原生图片、音频或视频；
- Asset、KnowledgeSource与课程Session仍有垂直耦合，虽然Space/Conversation/Gateway主干已建立，统一摄取仍未完成。

已完成的Web接入与循环收敛证据见 [Gateway-first 计划](../plan/completed/2026-07-gateway-first-personal-agent.md)。

## 当前后端接线状态

- 通用Asset：`assets / asset_versions / agent_message_parts` 已支持匿名归属、不可变版本、PDF文本物化、图片原生引用保留与刷新恢复；网页工具读取结果也复用Link AssetVersion，不维护平行正文；浏览器永远拿不到私有存储键；
- K1：审核资料不可变版本、PostgreSQL FTS、Session资料绑定、Turn资料快照、检索候选和引用防伪仓储已接入`retrieveKnowledge`工具、引用持久化编排和Web引用呈现；
- T1：可信状态转移、策略快照、事件回放、掌握度更新、误区与下一节点推荐服务已经实现；Canvas判分后的Web流程仅在当前可信状态为`ASSESS`时提交完成信号，其他状态事件仍需逐项接线；
- Artifact Runtime已实现：确认后在同一事务创建Artifact/任务账本并入
  graphile队列，worker生成不可变版本，Studio经列表/详情恢复。音频额外冻结
  AssetVersion来源并以checkpoint跨进程恢复；完整Artifact Model Run账本和跨轮
  Trace仍是后续工作；结构化Canvas跨轮共创和版本恢复已经接通。

该身份机制只服务阶段一匿名演示，不提供注册、登录、账号恢复、角色权限或跨设备身份，因此不能替代正式认证。

## 进程拓扑与独立后端的演进边界

**Turbo 严格环境模式是个必踩坑**：`turbo run` 默认剥离未在 `turbo.json` 声明的环境变量,`make dev` source 的 `.env` 若不经 `dev` 任务的 `passThroughEnv` 白名单根本到不了子进程——新增运行时环境变量时必须同步维护该白名单(通配 `EDUCANVAS_*`/`MODEL_GATEWAY_*` 已覆盖常规命名)。worker 另有兜底:启动时自行加载根 `.env`/`.env.local`,只填缺失键。

当前本地形态是“同一模块化单体、三个长期进程”：`apps/web`、`apps/gateway`与`apps/worker`。三者共享workspace和PostgreSQL，`make dev`只拉起这三个服务，不会误启交互式TUI、Telegram或Node。分钟级产物只在worker执行，任务经`graphile_worker.add_job()`在业务事务内原子入队。Gateway已是独立组合根，但选择云端拓扑不要求立即把Runtime或数据层拆成多个微服务。

worker 当前显式注册`maintenance:purge_anonymous_subjects`、`maintenance:reconcile_tool_approval_intents`与`knowledge:ingest_document`：匿名主体清理由Graphile crontab每日03:15 UTC触发；审批意图每五分钟以最多500条的有界批次收敛已过期prepared记录；资料任务只接受已解析、带内容hash和私有objectKey的受控资料，不提供URL抓取入口。worker使用esbuild打包内部workspace TypeScript，运行时仍由`node dist/index.js`启动。

除此之外不需要为了“独立后端”先拆服务。教育领域规则位于`teaching-core`，唯一通用编排位于`agent-runtime`，Provider位于`model-gateway`，持久化位于`db`；`teaching-runtime`只做教育Profile/Workflow适配。Next.js仍是兼容BFF，但不应重新吸收Gateway、Agent循环或领域判断。

当连接规模或团队发布边界产生可测压力时，再把现有Port/Adapter边界迁移到独立API服务。拆分目标包括：

- 后端可以单独扩容和发布；
- 避免长任务占用Web进程；
- 独立控制连接池、限流和模型并发；
- 支持未来独立实时网关和AI服务；
- 不依赖单一前端部署平台。

## 高并发策略

当前已落地的是PostgreSQL窗口限流、单Session活动Turn、租约/heartbeat、请求幂等和Provider超时/Abort。以下条目是shared dev到production的演进要求，不应描述为当前全部已启用：

- API保持无状态；
- 模型、数据库、检索分别设置并发舱壁；
- 所有外部调用设置超时与熔断；
- 请求使用幂等键；
- 热点内容缓存，但缓存不是事实源；
- 长任务立即入队，不占用请求连接；
- 采用背压和分级降级；
- 记录p50、p95、p99和错误预算。

## Python服务边界

只承担确实需要Python生态的任务，例如OCR、文档解析、Embedding、Rerank和离线评测。用户、课程、权限等核心业务逻辑留在TypeScript后端。
