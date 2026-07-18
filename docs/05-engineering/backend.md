# 后端工程

- 状态：`draft`

## 当前主选

- 阶段一部署形态：Next.js Web/BFF组合根 + workspace内的Core、Runtime、Provider和Drizzle适配器，保持模块化单体部署；
- 浏览器入口：Next.js Server Component、Server Action和Route Handler；
- 阶段二核心API候选：NestJS + Fastify；
- 数据访问：Drizzle配合原生SQL（ADR-0003已确定）；
- AI计算：Python Worker；
- 长任务：Temporal；
- 缓存和限流：Redis；
- 数据库：PostgreSQL + pgvector；
- 观测：OpenTelemetry。

除阶段一Next.js BFF、Drizzle和PostgreSQL外，Python Worker、Temporal、Redis、pgvector检索适配器和OpenTelemetry仍是目标能力，尚未实现。

## 阶段一已实现边界

- 匿名身份使用32-byte随机base64url bearer，仅保存在HttpOnly、SameSite=Lax Cookie中；数据库只保存`anon:v1:<sha256>`派生标识；
- 课程bootstrap在一个PostgreSQL事务内创建或复用Session，并保存公开Artifact与私有判分键；并发请求通过事务级advisory lock收敛到同一会话；
- Server Action不接受客户端session或student字段，而是从Cookie和固定课程范围恢复归属；
- `GradeCanvasSubmissionService`在事务内再次校验可信学生对session的归属，再判分、追加可信事件并更新掌握度投影；
- 页面读取只返回公共Artifact和Progress DTO，私有判分键不进入浏览器。

## 真实 Agent Turn 已实现边界

- `POST /api/v1/learn/turn`只接受受限正文和`clientMessageId`，从服务端匿名身份恢复Session，不接受浏览器声明学生或Session归属；
- Web组合根通过`packages/model-gateway`创建可配置的OpenAI-compatible SSE Adapter；未配置或配置非法时写入诚实失败态，不回退到脚本回答；
- `TeachingTurnOrchestrator`支持`answer → tools → synthesis`两阶段编排；当前生产组合注册只读`getStudentState`与`retrieveKnowledge`，工具可见性仍由可信教学状态、注册Handler和exposure共同收敛；
- Provider事件先归一为`teaching-core`协议，再由Route映射成版本化EduCanvas SSE；供应商chunk、模型ID、Key和原始异常不进入浏览器；
- 学生消息、老师消息、Model Run、Tool Call、安全决策和Turn Context Snapshot分别持久化；同一`clientMessageId`具备幂等/冲突语义，成功老师消息必须能够追溯到成功Model Run；
- `agent-runtime`按消息数/字符预算选择最新完整历史，Web在创建Turn时把选择的消息ID、AssetVersion ID、builder版本和计数与消息/Model Run原子落账；历史不能注入`system`角色；
- 已实现单Session活动Turn约束、PostgreSQL窗口限流、Turn租约/heartbeat、显式取消、过期收敛和刷新消息恢复；浏览器断连不等同于学生取消；
- 输入在Provider前经过确定性K12安全判断，输出delta在发给浏览器前经过流式安全Gate；这只是阶段一工程基线，不等于生产级未成年人治理已经完成。

通用对话 Turn 已接入受验证的工具循环(M3):`agent-runtime` 的 `validateModelRun` 引擎 + `AgentToolRegistry`(编译期清单、双向 Zod、超时硬边界),圈数配额 3;`webSearch`负责发现候选，只有`fetchWebPage`实际读取成功的网页才会落为不可变Link AssetVersion并进入`operation_sources`本轮白名单。Runtime为跨轮读取分配稳定`citationMarker`，完成消息时只把最终正文真实出现的合法`[n]`与终态原子写入`conversation_message_citations`；刷新、历史切换和SSE都从该投影恢复，网页徽章只暴露经服务端验证的公开原网址。搜索摘要不会被提升为已读来源。通用工具调用与模型运行的完整Trace账本化仍属 P1 Operation 迁移承接债务。

这里的执行链目前仍由 `teaching-runtime` 与 Web BFF 共同承载，能够服务
K12 纵切，但尚不能据此宣称已经形成通用 Agent Runtime。当前已确认的
平台化缺口包括：

- Answer 已包含有界的持久化会话历史与本轮物化 Asset 文本，但尚不包含摘要或 Artifact 状态；
- Web BFF 同时承担 lease、replay、安全、审计、引用和 SSE 映射，应用服务边界过宽；
- Tool Registry、Provider Registry 与 Artifact Plugin 仍是编译期闭集，缺少能力元数据和统一扩展契约；
- 图片虽然可作为 Asset 保留原生引用，但当前文本 Provider 不消费原生图片、音频或视频；
- Asset、KnowledgeSource 与课程 Session 仍有垂直耦合，尚未建立正式的 Space/Conversation 主干。

上述事实以 [Gemini + NotebookLM 产品复刻计划](../plan/active/2026-07-gemini-notebooklm-replica.md)
为实施入口。

## 当前后端接线状态

- 通用Asset：`assets / asset_versions / agent_message_parts` 已支持匿名归属、不可变版本、PDF文本物化、图片原生引用保留与刷新恢复；网页工具读取结果也复用Link AssetVersion，不维护平行正文；浏览器永远拿不到私有存储键；
- K1：审核资料不可变版本、PostgreSQL FTS、Session资料绑定、Turn资料快照、检索候选和引用防伪仓储已接入`retrieveKnowledge`工具、引用持久化编排和Web引用呈现；
- T1：可信状态转移、策略快照、事件回放、掌握度更新、误区与下一节点推荐服务已经实现；Canvas判分后的Web流程仅在当前可信状态为`ASSESS`时提交完成信号，其他状态事件仍需逐项接线；
- C1尚未实现：Artifact proposal、学生确认、独立生成Model Run、proposal到Artifact幂等提交和真实Studio查询仍是下一阶段工作。

该身份机制只服务阶段一匿名演示，不提供注册、登录、账号恢复、角色权限或跨设备身份，因此不能替代正式认证。

## 进程拓扑与独立后端的演进边界

**Turbo 严格环境模式是个必踩坑**：`turbo run` 默认剥离未在 `turbo.json` 声明的环境变量,`make dev` source 的 `.env` 若不经 `dev` 任务的 `passThroughEnv` 白名单根本到不了子进程——新增运行时环境变量时必须同步维护该白名单(通配 `EDUCANVAS_*`/`MODEL_GATEWAY_*` 已覆盖常规命名)。worker 另有兜底:启动时自行加载根 `.env`/`.env.local`,只填缺失键。

当前部署形态是"同一单体、两个进程"：`apps/web`（Next.js UI + BFF）与 `apps/worker`（graphile-worker 持久任务进程，[ADR-0012](../09-decisions/0012-artifact-runtime-durable-jobs.md)）。两者共享全部 workspace 包与同一个 PostgreSQL；`make dev` 一条命令同时拉起。分钟级产物生成只允许在 worker 内执行，任务经 `graphile_worker.add_job()` 在业务事务内原子入队。

worker 当前显式注册`maintenance:purge_anonymous_subjects`与`knowledge:ingest_document`：前者由Graphile crontab每日03:15 UTC触发，后者只接受已解析、带内容hash和私有objectKey的受控资料，不提供URL抓取入口。worker使用esbuild打包内部workspace TypeScript，运行时仍由`node dist/index.js`启动。

除此之外不需要为了"独立后端"先拆服务。领域规则位于`teaching-core`、应用编排位于`teaching-runtime`、Provider位于`model-gateway`、持久化位于`db`，已经与Next.js组件解耦；Next.js只是当前部署组合根。

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
