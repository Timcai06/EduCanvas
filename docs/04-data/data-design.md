# 数据设计

- 状态：`draft`
- 最后验证时间：2026-07-16

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

- `spaces`：Assets、Conversations与未来Artifacts的所有权和生命周期容器；
- `conversations`：Chat主叙事线程与Agent Profile选择，不包含课程或掌握度字段；
- `agent_operations`：通用Turn/Artifact Generation操作信封；
- `conversation_messages`：可脱离K12持久化和恢复的通用消息骨架；
- `lesson_sessions.conversation_id`：K12 Vertical Context到通用Conversation的关联。0011迁移为旧会话回填同ID Space/Conversation，新会话在同一事务双写。

当前仍处additive migration：生产K12 Turn继续使用`chat_messages/model_runs`，通用消息尚未承载SSE、工具、Message Parts与Model Run。不得删除旧表或宣称迁移完成。

### K12垂直领域

- `lesson_sessions`：教学状态、中断状态、课程范围、事件序号和乐观锁版本；
- `learning_events`：严格领域事件信封的只追加事实；
- `mastery_states`：学生×知识节点的掌握度投影；
- `canvas_artifact_grading_keys`：与公开题面物理分离的私有判分键。

### 对话与Agent执行账本

- `chat_messages`：用户可见消息、发送幂等、流式终态、取消和lease；
- `turn_context_snapshots`：本轮实际选用的历史消息ID、AssetVersion ID、Builder版本和预算计数；不复制正文；
- `agent_message_parts`：文本、不可变Asset引用和Artifact引用；
- `model_runs`：Provider、模型、Prompt版本/hash、usage、latency和终态；
- `tool_calls`：脱敏参数/结果摘要、权限判定、幂等执行和终态；
- `turn_safety_decisions`：输入/输出安全决策的审计投影。

当前限制：这些表仍以`lesson_sessions`为会话父实体，消息角色仍是`student/assistant`，Model Run只允许`teaching_turn`的`answer/synthesis`。它们是K12 v1可运行账本，不是通用Conversation最终模型。

### 通用Asset

- `assets`：所有者、Space标识、Turn/Space范围、类型、来源和生命周期；
- `asset_versions`：不可变内容版本、hash、私有storage key、解析文本和处理终态。

当前限制：通用路径已有一等`spaces`/`conversations`，但K12组合根在迁移期仍以`lessonSession.id`映射`spaceId`；`turn/space`目前主要是标签，缺少创建Turn绑定和长期升级授权。worker 已每日 03:15 UTC 调度匿名数据库主体清理，但仍未通过对象删除Outbox删除磁盘/对象存储内容。

### 知识与引用

- `knowledge_sources`、`knowledge_documents`、`knowledge_chunks`：审核资料、不可变文档版本和检索Chunk；
- `session_source_bindings`：K12课程会话对Source的显式选择；
- `turn_source_snapshots`、`turn_source_versions`：本轮冻结的Source集合与版本；
- `retrieval_candidates`：本轮实际检索候选白名单；
- `message_citations`：用户可见引用投影。

当前限制：用户上传Asset不会自动进入该Source/Chunk链路；中文检索使用PostgreSQL`simple`配置，需用冻结中文评测验证并升级。K12 synthesis 已按最终安全回答中的`[n]`保存实际candidate子集和原始稀疏编号；模型未输出合法编号时为避免丢失来源仍回退候选全集。通用Conversation尚未接入这条引用投影，引用也尚未绑定claim/span或来源原文定位。

受控资料版本可由worker任务`knowledge:ingest_document`写入；该入口只接受显式Source元数据、私有`objectKey`、parser版本、内容hash和已解析Chunk，不抓取任意URL，也不等同于用户上传自动摄取。

### Artifact

- `canvas_artifacts`：当前K12公开Artifact投影和版本；
- `canvas_artifact_grading_keys`：可判分Artifact的私有答案；
- `agent_message_parts.artifact_*`：为通用Artifact引用预留的消息Part字段。

当前限制：尚无通用`artifact_proposals`、`artifact_versions`和`generation_jobs`生命周期；当前Studio只能展示预置K12 Artifact。

## 目标通用对象模型

```text
Space / Notebook
├── Conversations
│   ├── Messages
│   │   └── MessageParts
│   └── Operations
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

### 迁移原则

1. 新增`spaces`与`conversations`，为现有lesson session回填默认Space和Conversation；
2. 新旧外键采用additive migration和兼容读，验证完成后再收紧约束；
3. `lesson_sessions`改为K12 Vertical Context，关联Conversation但不再拥有通用消息；
4. 消息角色迁移为`user/assistant/tool/system`，展示层由Vertical Agent决定“学生/老师”等名称；
5. `model_runs.operation_kind/phase`允许通用Turn、Artifact Generation和后续任务，但仍用严格业务枚举/Schema；
6. AssetVersion成为Source、Representation、Chunk和Provider文件引用的统一根，不维护平行内容副本；
7. Artifact Proposal、确认、生成和版本分别持久化，不把额外模型调用塞进原Teaching Turn。

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

## K12可信学习事实

`learning_events`是事实源，`mastery_states`是投影。Canvas客户端事件、模型文字、工具原始输出都不能直接写入掌握度。

- 事件序号由数据库原子递增分配；
- 幂等键防止客户端、网络和Worker重试重复计数；
- 每种事件使用与`event_type`绑定的严格payload Schema；
- 状态、答案和归属由服务端验证后才产生可信事件；
- 完整回放后必须与在线投影一致。

事件集合与信任提升规则见[学习事件契约](learning-event-contract.md)、[ADR-0004](../09-decisions/0004-state-machine-runtime.md)、[ADR-0005](../09-decisions/0005-mastery-modeling.md)和[ADR-0006](../09-decisions/0006-trusted-learning-events.md)。

## 生产门禁

以下是进入production前的要求，不代表当前已经部署：

- 正式认证、租户/学校边界和授权审计；
- 备份、PITR与恢复演练；
- Transactional Outbox与对象删除残留巡检；
- 连接池、容量测试和慢查询治理；
- 数据保留、导出、更正和删除流程；
- Provider与Tool Trace脱敏、OpenTelemetry和SLO告警。
