# 数据设计

- 状态：`draft`
- 最后验证时间：2026-07-24

## 数据原则

- PostgreSQL是阶段一业务事实源；缓存或进程状态丢失不能改变消息、Artifact或可信学习事实；
- 通用Space、Conversation、Message、Asset、Artifact和Model Run不能以K12课程/掌握度为父实体；
- K12状态、掌握度和判分只由可信领域事件更新，大模型文本和浏览器事件不是事实；
- 原始内容、派生表示、Chunk、Embedding和引用Anchor分层、版本化保存；
- 用户可见消息与Provider/Tool执行Trace分层；
- 未成年人数据最小化收集，保留与删除必须是可执行流程而不是文档承诺。

## 当前物理数据层

阶段一继续使用一个PostgreSQL数据库，但按职责区分四组逻辑数据。物理同库不代表领域同层，字段、约束和迁移仍以`packages/db/src/schema.ts`与`packages/db/drizzle/`为准。

### 通用平台主干

- `platform_users / personal_agents`：正式/匿名兼容主体与当前一人一Agent映射；
- `spaces`：Assets、Conversations与未来Artifacts的所有权和生命周期容器；
- `conversations`：Chat主叙事线程与Agent Profile选择，不包含课程或掌握度字段；
- `notebook_memberships / delegated_grants`：私人/共享Notebook角色及可到期、撤销的委托授权；
- `agent_operations`：通用Turn/Artifact Generation/Gateway操作信封，保存Actor、Agent、Notebook、Conversation、请求指纹和终态；
- `gateway_operation_events / gateway_approvals`：可按sequence恢复的标准事件与主体范围审批；
- `gateway_channel_* / gateway_deliveries`：渠道账号/线程绑定和出站投递回执；账号 Binding 的 `activation_expires_at` 只用于有界 pending，激活或撤销后清空；
- `gateway_node_pairings / gateway_node_invocations`：Node配对、心跳、撤销、调用和结果；
- `gateway_handoff_tokens`：跨客户端短期交接授权，只保存原始 token 的 SHA-256 摘要、主体、Conversation、到期与消费时间；条件更新保证一次性消费；
- `conversation_messages`：可脱离K12持久化和恢复的通用消息骨架；
- `lesson_sessions.conversation_id`：K12 Vertical Context到通用Conversation的关联。0011迁移为旧会话回填同ID Space/Conversation，新会话在同一事务双写。

Gateway Operation 与通用/K12 Turn 复用同一个operation/turn ID，不创建平行运行账本。K12可见消息、知识引用与安全决策继续使用`chat_messages`及其教育外键；新模型、Context与Tool审计写统一Agent Ledger，旧`teaching_turn`模型记录只保留兼容读取。在删除旧形状前仍须保持additive migration和回放等价。

### K12垂直领域

- `lesson_sessions`：教学状态、中断状态、课程范围、事件序号和乐观锁版本；
- `learning_events`：严格领域事件信封的只追加事实；
- `mastery_states`：学生×知识节点的掌握度投影；
- `canvas_artifact_grading_keys`：与公开题面物理分离的私有判分键。
- `learner_profiles`：显式年龄段、默认学段、声明人和固定闭集教学偏好；不保存出生日期、人格、生物特征或模型推断；
- `learning_goals / learning_objectives`：Notebook 当前或历史目标与 6–12 节点冻结目标图；每个 Notebook 同时最多一个活动 Goal；
- `diagnostic_attempts / diagnostic_responses`：不可变短诊断、答案 SHA-256 指纹、逐题选择与服务端判分；答案键不入表。

详细所有权、幂等、公开投影与事务规则见[学习计划与诊断数据契约](02-学习计划与诊断.md)。

### 对话与Agent执行账本

- `chat_messages`：用户可见消息、发送幂等、流式终态、取消和lease；
- `turn_context_snapshots`：本轮实际选用的历史消息ID、AssetVersion ID、Builder版本和预算计数；`agent_turn` 通过 `agent_operation_id` 绑定Operation，可信加载器允许同一Conversation内的通用消息或K12消息，旧教学记录继续通过 `session_id + turn_id` 可读；不复制正文；
- `agent_message_parts`：文本、不可变Asset引用和Artifact引用；
- `model_runs`：Provider、模型、Prompt版本/hash、usage、latency和终态；`agent_turn` 始终绑定 `agent_operation_id`，通用Profile引用`conversation_message_id`，Teaching Profile引用同Conversation下的`session_id + assistant_message_id`且`turn_id=agent_operation_id`；旧 `teaching_turn` 继续兼容读取；
- `tool_calls`：脱敏参数/结果摘要、权限判定、幂等执行和终态；`agent_turn` 通过 `agent_operation_id + answer_model_run_id` 关联通用账本，旧教学调用继续通过 `session_id + turn_id` 可读；
- `tool_effects`：write工具在调用前写入的effect intention，以及`committed/failed/outcome_unknown`唯一终态；只保存Operation、Tool Call、effect key、语义/回执hash、可空的服务端冻结reconciliation verifier身份和稳定code，旧行及无可信查询能力的Adapter保持null；
- `tool_effect_reconciliations`：对`outcome_unknown` Effect追加的唯一权威决议；只保存Effect引用、`confirmed_committed/confirmed_not_committed`、`manual/adapter`来源、resolver稳定身份、证据/回执hash、稳定code与时间；
- `tool_approval_intents`：L2/L3 Adapter已完成耐久准备、Gateway尚未公开审批之间的版本化最小意图；只保存Operation、Actor、Tool Call、Adapter source/resume ref、expiry和可空W3C `trace_parent`，状态仅为`prepared/bound/abandoned`；
- `operation_continuations`：审批或外部等待的版本化控制游标与跨进程lease；同一Operation允许按`sequence`保留多个历史等待点，但同一时刻最多一个活动等待点。只保存approval、Tool Call、Adapter耐久意图的稳定引用和可空W3C `trace_parent`，不保存任意checkpoint JSON、Prompt、正文、工具参数、Credential、Secret、外部回执或effect结果；
- `turn_safety_decisions`：输入/输出安全决策的审计投影。

当前迁移状态：`model_runs`、`turn_context_snapshots` 与 `tool_calls` 已 additive 支持统一 `agent_turn` 和旧教学记录；三个通用 Ledger 都按 Actor/Operation 重新鉴权。Context Snapshot 会验证消息属于 Operation 的 Conversation（包括该Conversation唯一所属学生的K12消息）、AssetVersion 属于 Operation 的 Notebook，并拒绝重复ID和同Operation上下文漂移；Model Run根据Profile稳定`taskAlias`验证可见assistant消息的真实外键，Context 与 Tool Call 只保存不可变ID、计数或不可逆摘要，不保存正文。Web Teaching新Turn已停止预写旧`teaching_turn` Model Run和旧Context Snapshot，教学消息角色仍是 `student/assistant`。旧记录暂不回填或物理删除，待保留期验证后再收口。

Gateway文本Turn、Web General与Web Teaching均写通用Context Snapshot和Model Run；General与Teaching模型工具都写通用Tool Call，write工具先写`tool_effects`。Gateway创建Operation时生成的`trace_id`原样传给Turn Application；取消先以Actor条件更新`cancel_requested_at`，再由进程信号或Web数据库watcher中止。三条入口都已拆成明确单写：Turn Application只更新可见assistant消息，Gateway事件循环追加唯一Operation终态；Teaching另外保存脱敏安全决策、检索候选与教材引用，不复制模型运行审计。

Web General物化文本Asset时保留逐`AssetVersion`片段，Context Snapshot的`selected_asset_version_ids`因此记录实际进入Prompt的不可变版本，而不是只审计一个无法追溯的拼接字符串。`settleTurn`在更新assistant消息的同一事务插入正文实际引用的`conversation_message_citations`并返回引用快照，避免提交后第二次必需查询失败而把已完成消息误报为失败。历史消息`limit`定义为“最新N条、返回时恢复时间正序”，长Conversation不会把当前Turn挤出Context。

`model_runs` 迁移保留 PostgreSQL `uuid` 外键，并用CHECK区分三种受控形状：旧`teaching_turn`、通用Profile的`agent_turn + conversation_message_id`、Teaching Profile的`agent_turn + assistant_message_id`。没有改成无外键的多态text ID；Teaching Profile还强制`turn_id=agent_operation_id`，仓储再次校验Session的学生、Conversation与Operation Actor一致。`operation_kind + operation_id + phase + attempt` 继续作为幂等唯一键，attempt上限100用于防止异常重试无限扩张审计行；后续停止旧写入后再以独立迁移收紧非空约束。

`turn_context_snapshots` 同样以可空 `agent_operation_id` 和旧 `session_id / turn_id` 的互斥 CHECK 表达双形状，并对通用Operation建立部分唯一索引。每类消息和AssetVersion引用上限100、字符预算上限128000，用于限制异常请求的查询和审计膨胀；引用顺序参与SHA-256，保证重放时能检测实际Prompt上下文顺序变化。N-1迁移测试证明旧教学快照无需改写仍可读取。

`tool_calls` 以可空 `agent_operation_id` 和旧 `session_id / turn_id / teaching_state` 的互斥 CHECK 表达双形状，并继续用全局 `execution_id` 与 `answer_model_run_id + provider_tool_call_id` 两道唯一键阻止重复执行。通用仓储每次读取和状态迁移都重新校验Actor；参数和成功结果最多各接受1000000字节用于生成摘要，数据库只落类型、字节数、元素数和SHA-256。`outcome_unknown` 只允许write调用进入，但它仍是调用审计而非副作用提交证据；独立`tool_effects`负责记录intention与可验证提交。

`tool_effects` 只服务通用write调用，以 `agent_operation_id + effect_key` 和 `tool_call_id` 双唯一键保证一次调用只有一个副作用语义。effect key上限160、稳定code上限128，语义与外部回执只接受SHA-256；这些上限既阻止异常Adapter扩张索引，也保证标识能安全进入日志与对账工具。只有处于`running`的write Tool Call可以创建intention；超时、取消或Adapter显式报告无法确认时必须保持`outcome_unknown`，不能自动重试或伪装提交。原始参数、输出、Credential、异常和回执正文在Schema中没有字段。

`tool_effect_reconciliations` 以 `effect_id` 主键保证每个未知Effect最多追加一个权威决议，并以预期effect key与语义hash执行CAS，防止对错对象或漂移语义下结论。仓储只接受仍为`outcome_unknown`的write Effect并重新校验Operation与Actor；决议不会更新原 `tool_effects`、`tool_calls` 或 `agent_operations`，读取方需要显式联合原事实与追加决议形成当前投影。`adapter`来源只能使用Effect intention中已冻结且与resolver逐值相等的受信查询核验器，调用方不能替换；没有绑定或绑定漂移必须拒绝，不能通过invoke/replay来试探。MCP v1当前没有可信查询契约，自动核验保持fail closed。`manual`来源只允许已鉴权operator或service principal，学生和模型不能把自身陈述写成证据。表内没有参数、输出、证据正文、远端错误、Credential或Secret字段，只有稳定code、resolver身份、SHA-256证据/回执摘要和服务端时间。

`tool_approval_intents`以approval、Tool Call、`adapter_source + resume_ref`三道唯一身份阻止同一耐久动作漂移；准备时重验Actor、running Operation、取消事实和pending Tool Call，expiry必须位于未来24小时内。Gateway追加`approval.required`时必须找到仍为prepared且expiry逐值一致的意图，并在同一事务写Gateway事件、`gateway_approvals`、`operation_continuations`和intent bound；缺失、过期、跨Actor或已消费都会回滚，包括已经分配的事件序号。可空`trace_parent`只允许服务端生成的W3C v00小写格式，首次准备后的carrier漂移不参与业务幂等判定，也不覆盖首次值。表中没有summary、参数、Prompt、Credential、Secret或结果字段。

异常Worker恢复不新增业务表，也不把Graphile锁复制进`operation_continuations`。恢复仓储复用`(status, lease_expires_at, updated_at)`索引，只扫描业务lease已过期且Operation仍为running的行，并在同一事务用稳定job key重新投递`{ continuationId }`；扫描本身不更新status、owner、expiry、heartbeat或generation，真正换代只由后续claim执行。generation达到协议上限的行不自动重投，只进入低基数健康计数与人工处置。队列重投失败会整笔回滚并由下一轮重试，不能留下“已恢复”假状态。

`mcp_tool_intents`是MCP Adapter自有的短期耐久意图，不是第二套任务系统。它只接受L2/L3 write工具，明文字段限于Operation/Tool Call/Actor/Agent、可信注册身份、capability、risk、带密钥语义摘要和生命周期；参数与不透明Credential Handle使用AES-256-GCM密文保存，Secret不进入本表。`text`承载base64密文是为了保持postgres-js往返类型稳定，数据库检查把密文限制在350000字符以内，对应应用层256 KiB明文上限。外呼前推进`dispatching`并清空key version、nonce、ciphertext和tag；过期prepared行也由有界维护任务清空。payload与语义摘要使用从主密钥HKDF派生的HMAC密钥，只用于幂等和漂移比对。

每五分钟的有界reconciliation会以`FOR UPDATE SKIP LOCKED`领取最多500条已到期prepared意图并标记为abandoned；多个Worker可安全并发，bound事实不会回退，积压由后续批次继续收敛。

`operation_continuations` 使用独立UUID身份和每Operation递增的`sequence`，避免一次Turn恢复后遇到第二个高风险动作时复用或覆盖历史等待点。活动状态部分唯一索引阻止双worker并行推进同一Operation；`lease_generation`上限1000000，单Operation等待点上限1000，用于阻断异常循环造成无界控制账本增长。claim只能领取ready或已过期running行，heartbeat、release与settle必须同时匹配owner、generation和未过期lease；取消会清空lease。可空`trace_parent`从已绑定意图原子复制，仅用于Worker恢复因果Trace，不参与授权、lease、幂等或终态判定。审批、Operation终态、Tool effect与学习事实仍由各自权威表维护，本表不会因checkpoint或Trace状态自行宣布它们成立。

批准决策不再由HTTP层分三次写入：Operation Store在同一事务中追加`approval.resolved`、更新`gateway_approvals`、推进continuation为`ready`并调用`graphile_worker.add_job()`；队列payload只有continuation UUID，不携带carrier。Worker领取时从当前`agent_operations / personal_agents / conversations / notebook_memberships / gateway_approvals`联表重算范围，Membership撤销、Agent停用或Conversation归属漂移都不会进入Adapter。重验成功后才从continuation行提取W3C父上下文；Adapter完成消息与Tool/effect账本后，continuation lease终态和Gateway Operation终态再次同事务提交，避免任一账本单独成功。

`agent_operations.cancel_requested_at`是跨进程取消事实。`waiting_approval / ready` continuation在请求事务中直接变为`cancelled`；`running` continuation由Worker观察后清空owner/expiry/heartbeat并与`operation.cancelled`同事务提交。Adapter完成与取消竞速时，结算事务重新读取该字段并让取消赢得唯一Operation终态。未过期running lease不是成功no-op：Worker返回可重试错误，避免Graphile提前删除唯一恢复任务；lease过期后新owner必须递增generation。

### 通用Asset

- `assets`：所有者、Space标识、Turn/Space范围、类型、来源和生命周期；
- `asset_versions`：不可变内容版本、hash、私有storage key、解析文本和处理终态。

当前限制：通用与K12路径都通过一等`spaces`/`conversations`校验Notebook归属；`lessonSession`只保留教学纵向状态，Asset归属使用关联Conversation的真实Space。`turn/space`目前主要是标签，缺少创建Turn绑定和长期升级授权。worker 已每日 03:15 UTC 调度匿名数据库主体清理，但仍未通过对象删除Outbox删除磁盘/对象存储内容。

### 知识与引用

- `knowledge_sources`、`knowledge_documents`、`knowledge_chunks`：审核资料、不可变文档版本和检索Chunk；
- `session_source_bindings`：K12课程会话对Source的显式选择；
- `turn_source_snapshots`、`turn_source_versions`：本轮冻结的Source集合与版本；
- `retrieval_candidates`：本轮实际检索候选白名单；
- `message_citations`：用户可见引用投影。
- `operation_sources`：通用Operation实际读取的来源白名单；当前`kind=web`，绑定不可变AssetVersion、稳定ordinal和公开原文定位；
- `conversation_message_citations`：通用assistant消息实际引用的`operation_sources`子集。

当前限制：用户上传Asset不会自动进入K12 Source/Chunk链路；中文检索使用PostgreSQL`simple`配置，需用冻结中文评测验证并升级。K12 synthesis 已按最终安全回答中的`[n]`保存实际candidate子集和原始稀疏编号；模型未输出合法编号时为避免丢失来源仍回退候选全集。通用网页路径只提升`fetchWebPage`经Tool Kernel实际读取并持久化的页面，搜索摘要不能成为引用；正文无合法`[n]`时不伪造引用。两条路径都尚未绑定claim/span或页内字符Anchor。

受控资料版本可由worker任务`knowledge:ingest_document`写入；该入口只接受显式Source元数据、私有`objectKey`、parser版本、内容hash和已解析Chunk，不抓取任意URL，也不等同于用户上传自动摄取。

### Artifact

- `artifacts`：平台Artifact身份、Space/Conversation归属、kind、trust tier与当前版本计数；
- `artifact_versions`：不可变版本。结构化产物存`content`；媒体产物只存私有
  `object_key + checksum`，可另存浏览器安全metadata（音频文字稿、模型/voice/用量）；
- `artifact_generation_jobs`：队列外的长期事实源，保存状态、进度、稳定失败码、
  冻结输入`params`与可恢复`checkpoint`；一个job由唯一索引约束最多提交一个版本；
- `canvas_artifacts / canvas_artifact_grading_keys`：K12可判分题面与私有答案，
  与平台Tier 2音频/闪卡不共享可信学习事件；
- `agent_message_parts.artifact_*`：通用消息中的不可变Artifact引用。

当前已实现思维导图、Slides、闪卡和音频概览的提议→确认→持久任务→版本→
Studio恢复。音频二进制不进PostgreSQL；Worker写对象后先保存key/checksum/metadata
checkpoint，crash重投校验对象后继续append version。结构化Canvas修改会冻结
`baseVersion + instruction`到新任务，Worker读取基线版本与Notebook对话后追加不可变版本；
并发任务或过期基线以冲突拒绝。仍缺正式对象删除Outbox与S3兼容生产适配器。

## 当前通用对象模型

```text
User ── owns ── Personal Agent
  ├── Private Memory / Credentials / Node Grants
  └── Notebook Memberships

Space / Notebook (private or shared)
├── Owner / Memberships / Role Grants
├── Conversations
│   ├── Messages
│   │   └── MessageParts
│   └── Operations
│       ├── Actor User / Personal Agent
│       ├── ModelRuns
│       └── ToolCalls
├── Assets
│   └── AssetVersions
│       ├── Representations
│       ├── Chunks / Embeddings
│       └── CitationAnchors
├── Artifacts
│   └── ArtifactVersions
└── VerticalContexts
    └── K12 LessonSession / Mastery / TrustedEvents
```

### 已完成的迁移与后续原则

1. 已新增`spaces/conversations`并为现有lesson session回填默认Space/Conversation；
2. 已新增 User、Personal Agent、Notebook Membership、Delegated Grant 与Gateway账本；共享Operation保存Actor User与Agent；
3. 已用additive迁移保持K12账本、通用消息和Gateway事件兼容；收紧或删除旧表前必须继续做回放/归属验证；
4. `lesson_sessions`继续作为K12 Vertical Context并关联Conversation，不成为通用Gateway的父实体；
5. 私人Memory、Credential与Node Pairing以个人Agent/User为父实体，不因Notebook Membership自动共享；
6. 后续让AssetVersion成为Source、Representation、Chunk和Provider文件引用的统一根，不维护平行内容副本；
7. Artifact Proposal、确认、生成和版本继续分别持久化，不把额外模型调用塞进Teaching Turn。

## 内容与检索

一个AssetVersion可以产生多种派生表示：

```text
original
text_extraction
ocr
transcript
thumbnail
provider_file
```

每种表示记录处理器、版本、状态、内容hash和生成时间。Chunk记录表示版本、字符/页码/时间轴Anchor、切块策略和语言；Embedding记录模型、维度、指令、归一化和Embedding空间版本。

中文检索至少需要：

- 冻结查询/资料/相关性标注集；
- 可解释关键词或n-gram召回；
- 可选Embedding召回；
- Rerank与去重；
- Recall@K、MRR、nDCG、引用覆盖率与无依据回答率；
- retriever、embedding和reranker版本随候选持久化。

## 引用可信度

- Retrieval Candidate只是本轮允许引用的白名单；K12最终回答只把实际出现的合法`[n]`提升为Message Citation，缺少标记时走显式全集降级；
- Synthesis必须显式选择候选子集，Runtime拒绝白名单外ID；
- Citation至少绑定`sourceVersionId/chunkId/anchor`，并逐步增加message part或claim/span；
- Source换版后旧消息继续指向旧不可变版本；新Turn默认只使用当前ready版本；
- Source删除后历史引用显示tombstone投影，不伪造仍可访问的原文。

## 生命周期与删除

- 上传前在反向代理和Route限制Content-Length，并设置主体/Space配额和速率；
- PDF/OCR/音视频解析进入隔离Worker，限制页数、时长、解压量和执行时间；
- 摄取执行MIME解码、恶意文件和Prompt Injection风险标注；
- 数据库删除采用tombstone+outbox，两阶段幂等删除对象，再确认完成；
- 匿名保留策略必须有定时调度、重试、残留扫描和指标；
- 日志不得保存Secret、完整未成年人资料、Provider原始请求或私有storage key。

匿名保留任务以`lesson_sessions.last_activity_at`与`conversations.last_activity_at`的主体级最大值共同判定；general-only主体也进入候选扫描。通用Citation/Source/Artifact/Message/Operation/Conversation/Space与K12账本、Asset均在同一可回滚逐表删除闭包中，任一表失败则整个主体不产生部分删除。

## K12可信学习事实

`learning_events`是事实源，`mastery_states`是投影。Canvas客户端事件、模型文字、工具原始输出都不能直接写入掌握度。

- 事件序号由数据库原子递增分配；
- 幂等键防止客户端、网络和Worker重试重复计数；
- 每种事件使用与`event_type`绑定的严格payload Schema；
- 状态、答案和归属由服务端验证后才产生可信事件；
- 完整回放后必须与在线投影一致。

事件集合与信任提升规则见[学习事件契约](learning-event-contract.md)和 [ADR-0018](../09-decisions/0018-capability-trust-and-learning-evidence.md)。五阶段课程与现有掌握度公式属于教育领域当前实现，不是通用 Agent 数据前置条件。

## 生产门禁

以下是进入production前的要求，不代表当前已经部署：

- 正式认证、租户/学校边界和授权审计；
- 备份、PITR与恢复演练；
- Transactional Outbox与对象删除残留巡检；
- 连接池、容量测试和慢查询治理；
- 数据保留、导出、更正和删除流程；
- Provider与Tool Trace脱敏、OpenTelemetry和SLO告警。
