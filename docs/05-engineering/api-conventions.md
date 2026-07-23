# API约定

- 状态：`draft`

## 基本原则

- 外部接口使用版本前缀，例如`/api/v1`；
- 请求和响应必须有Schema；
- 时间统一使用UTC ISO 8601；
- ID不使用可猜测的连续整数暴露给客户端；
- 分页默认使用Cursor；
- 错误返回稳定错误码，不让前端解析错误文本；
- 写操作支持幂等键；
- 长任务返回`job_id`；
- 流式文本使用SSE，双向实时音频使用WebRTC或WebSocket。

## Agent Turn SSE

### 内部 Turn Application v2

第二代运行内核先定义 `educanvas.turn.v2` 的 transport-neutral 命令与事件。命令只接受服务端解析后的 Actor/Agent、Notebook/Conversation、Profile、入口、消息 Parts 和有效能力清单；浏览器、TUI、Channel、模型或 Provider 不能提交可信主体。ID 采用非空、最多 256 字符的 opaque ID，能力名最多 64 字符，消息复用 `agentMessageInputSchema` 的 32 Parts/64000 文本总长边界，能力清单最多 128 项且不得重复。

应用事件包含 `turn.started`、消息 delta/引用、Tool 生命周期、approval、Artifact 生命周期和 `turn.completed/failed/cancelled`。已知事件使用 strict Schema；Tool 完成事件只允许最多 1000 字符的安全摘要，不接受原始参数、输出、异常或 Secret。一个事件前缀必须以唯一 `turn.started` 开始、全部属于同一 Operation，终态出现后不得再有事件。

该契约位于 `@educanvas/agent-core`，唯一调用边界 `TurnApplicationPort` 位于 `@educanvas/agent-runtime`。Web SSE 和 Gateway NDJSON 仍保持各自对外版本，只能投影内部事件，不能把传输字段或供应商类型反向写入应用契约。

当前 Web API/SSE 是 `gateway.v1` 的兼容投影。跨客户端协议由 [Gateway 与多入口架构](../02-architecture/02-Gateway与多入口.md)定义；TUI、Channel 和 Node 不调用 Next.js Route Handler。

Web Route 只把受控 Runtime 事件映射为 EduCanvas SSE，不能透传 AI SDK、DeepSeek 或其他供应商原始事件。当前浏览器已实现的 `schemaVersion=1` 事件为：

- `turn.accepted`；
- `message.delta`；
- `tool.started / tool.completed / tool.failed`；
- `message.citation`；
- `turn.completed / turn.failed / turn.cancelled`。

Artifact 生命周期事件已以 additive 方式定义（`schemaVersion=1`，旧浏览器按
未知事件忽略，不需要整体协议升版；Artifact 事件的当前边界见 [ADR-0019](../09-decisions/0019-modular-monolith-artifacts-and-durable-jobs.md)：

- `artifact.proposed / artifact.created`：`{type,schemaVersion,turnId,artifactId,kind,trustTier,title}`；
- `artifact.version_added`：`{type,schemaVersion,turnId,artifactId,version}`；
- `artifact.generation_progress`：`{type,schemaVersion,turnId,artifactId,jobId,progress}`；
- `artifact.failed`：`{type,schemaVersion,turnId,artifactId,jobId?,code}`。

断连恢复不依赖流：`GET /api/v1/chat/artifacts` 返回当前 Conversation 的产物
公开投影（id/kind/trustTier/title/status/latestVersion）。

产物创建、轮询与媒体读取：

- `POST /api/v1/chat/artifacts`：结构化产物使用`{kind,title}`（当前
  `mind_map/slides/flashcards`）；`audio_overview`使用
  `{kind,title,sources:[{assetId,versionId,kind}]}`且必须冻结1–8项已解析PDF/网页来源。
  产物行、任务账本与graphile队列行同事务原子提交，生成在worker内异步执行；
- `GET /api/v1/chat/artifacts/{artifactId}`：最新版本内容（结构化 JSONB；媒体
  版本只含受控读取URL和浏览器安全metadata）与最近生成任务状态，供轮询与
  Canvas打开；私有`objectKey/checksum`不返回浏览器，越权与不存在同错404；
- `GET /api/v1/chat/artifacts/{artifactId}/audio`：按主体重新校验版本归属，完整
  SHA-256校验后返回`audio/mpeg`，支持单段HTTP Range；对象缺失、损坏与越权均
  不泄露私有key。

SSE `artifact.*` 事件保留为additive协议；当前生成进度经上述端点轮询，刷新
后以列表/详情恢复，不依赖浏览器保持连接。

约束：

1. SSE `data` 必须通过版本化 Schema，不包含 system Prompt、学生身份内部 ID、API Key、供应商推理或原始异常；
   `data.type`必须与SSE的`event`字段完全一致；首版浏览器已知事件拒绝缺失、错版、空delta和超限字段；
2. `message.delta` 必须来自 `TurnModelEvent.text_delta`，不能在浏览器或服务端用定时器切分完整文本伪造流式；
3. 同一 Turn 恰有一个 `turn.*` 终态，终态之后不能再发送 delta；
4. Provider `failed` 先映射为稳定错误码，再由 Route 选择学生可理解文案；客户端不能解析异常文本判断分支；
5. 浏览器断连不等于学生取消。只有服务端记录了显式取消请求，Provider `aborted` 才能收敛为 `turn.cancelled`；
6. 模型运行圈数由唯一 `AgentLoopEngine` 的 `TurnBudget/maxToolRounds` 管理；K12默认一圈工具后可选synthesis，通用Profile默认最多三圈。任何客户端事件都不暴露供应商模型 ID 作为业务控制字段。
7. Provider函数名与公共能力名是两个边界：模型Adapter可以使用供应商兼容的`fetchWebPage/webSearch`，Tool Kernel按`web.fetch/web.search`授权，Turn/Gateway/Web事件只投影公共能力或本地化label。客户端不能据Provider函数名授予权限。
8. Profile输入策略必须在Context/Model/Tool前执行；流式输出策略必须位于Provider delta与公开事件之间。策略命中只公开固定安全回应并使用稳定`POLICY_BLOCKED`，不得透传detector payload、被拦截正文或伪装为模型/网络失败。

首版浏览器消费契约：

- `turn.accepted`：`{type,schemaVersion,turnId,studentMessageId,assistantMessageId,replayed}`；
- `message.delta`：`{type,schemaVersion,turnId,messageId,delta}`；
- `message.citation`：公共字段为`{type,schemaVersion,turnId,messageId,citationId,marker?,label,pageStart,pageEnd}`；K12知识引用附加`kind?:"knowledge",sourceId,documentId,chunkId`（旧流缺省`kind`仍按knowledge解析），通用网页引用附加`kind:"web",assetId,assetVersionId,url`且页码字段必须为`null`。`marker`为正文实际出现的`[n]`编号（1..99），网页`url`只允许服务端验证后的公开HTTP(S)原文定位；
- `turn.completed / turn.cancelled`：`{type,schemaVersion,turnId,messageId}`；
- `turn.failed`：`{type,schemaVersion,turnId,messageId,code,message,retryable}`，`code=interrupted`映射刷新可恢复的中断态；
- `tool.started / tool.completed / tool.failed`：只允许`{type,schemaVersion,turnId,toolCallId,label?}`，`tool.failed`可额外包含安全`code?`，禁止参数、输出和内部异常。

浏览器发起轮次的 JSON 正文只能是以下两个形态之一：

- 兼容文本形态：`{clientMessageId,text}`；
- 结构化形态：`{clientMessageId,parts}`，其中 parts 必须通过
  `agentMessageInputSchema`，Asset 引用仍由服务端重新校验归属与可用状态。

请求不接收可信身份、session、私有存储键或模型选择字段；显式停止调用
`POST /api/v1/learn/turn/{turnId}/cancel`。内联重试必须生成新的
`clientMessageId`。当前 UI 重试只保留文本，没有恢复原始 Asset parts；这是
多模态会话完整性缺口，应在平台 P0 中修复。

SSE 示例：

```text
event: message.delta
data: {"type":"message.delta","schemaVersion":"1","turnId":"turn_x","messageId":"message_x","delta":"我们先观察耳朵形状。"}

event: turn.completed
data: {"type":"turn.completed","schemaVersion":"1","turnId":"turn_x","messageId":"message_x"}
```

## Gateway v1

`gateway.v1` 使用严格 Zod Schema 和 `application/x-ndjson` 流。标准输入由服务端认证边界构造，包含 connection、principal、route hint、parts、capability manifest 与 reply target；公共Client请求不允许提交principal。capability manifest只描述该入口可收发或渲染的协议能力，不是Tool授权源；Tool grant必须由服务端对Actor、Notebook、Profile、Channel与Environment分别解析，入口声明至多继续收窄。

核心语义：

- `envelopeId` 标识原生输入，`idempotencyKey + requestFingerprint` 决定replay或409冲突；
- `operationId + sequence` 是持久事件cursor，`after=-1`读取全部，断线后按序恢复；
- `operation.accepted` 后可有message/tool/artifact/approval事件，并且只能出现一个operation终态；
- 审批decision端点只调用Operation Store的原子决策方法：denied与失败终态同事务，approved与`approval.resolved + continuation ready + graphile job`同事务；HTTP层不得拆成多次append；
- Turn遇到L2/L3时，`approval.required`必须位于已验证参数和Adapter耐久准备之后，且该轮暂时没有`turn.failed/completed/cancelled`；客户端应显示等待审批，不能把无终态当作网络失败；
- Gateway持久化`approval.required`前必须原子消费匹配的prepared Tool approval intent；缺少意图、expiry漂移、跨Operation/Actor或重复消费统一拒绝，不能留下只有事件或只有Approval的半状态；
- 取消端点先持久化`cancelRequestedAt`；响应`cancelling`表示本进程或跨进程Worker已收到可收敛请求，`cancelled`表示等待中的continuation与Operation已原子终结，`not_running`不得伪装已取消；
- 恢复接口必须重新验证actor，越权与不存在不泄露目标内容；
- Event和错误只使用稳定码，不返回Provider异常、Secret或消息正文；
- Web兼容层把`message.started`映射为`turn.accepted`，确保Gateway Operation与既有Turn复用同一ID。
- `POST /v1/internal/tool-effects/reconciliations`只在Internal token开启且鉴权通过后可用；正文只接受Operation/Actor/Effect稳定标识、决议、原因code和SHA-256证据/回执摘要。审计主体来自`x-educanvas-reconciliation-principal: operator:<id> | service:<id>`的受信Internal上下文，缺省为固定Gateway service，正文提交`principal`会被严格Schema拒绝。归属隐藏为404，既有决议冲突或非`outcome_unknown`生命周期返回409，未注入控制面返回503，不把预期业务结果伪装成500；

完整HTTP入口、认证和能力边界见[Gateway 与多入口架构](../02-architecture/02-Gateway与多入口.md)。

## Turn Application v2 投影纪律

`educanvas.turn.v2` 是第二代 Runtime 的 transport-neutral 边界：入口只能提交服务端已解析的 Actor、Agent、Notebook、Conversation、Profile 与有效能力交集；Web SSE 与 Gateway Event 只能投影其输出，不能自行产生另一套运行终态。已知事件严格校验，单个 Turn 必须以唯一 `turn.started` 开始并最多出现一个终态；工具完成事件只允许安全摘要，不允许透传原始工具输出。`POLICY_BLOCKED` 表示确定性Profile策略已阻止当前输入或输出，默认不可自动重试；具体安全分类只进入受控审计，不进入公共协议。

迁移期由 `gateway-runtime` 维护 Turn Application 到 Gateway payload 的唯一失败码与审批映射，Web 只维护兼容 SSE 展示投影。Gateway、Web General与Web Teaching均从同一服务投影；scripted golden fixture证明投影对文本、引用、工具、失败、取消和终态语义等价。生产构造点扫描测试禁止重新出现入口私有Loop或第三套Tool Runtime，遗留无调用教学实现将在清理纵切删除。

## 错误结构

```json
{
  "error": {
    "code": "COURSE_NOT_FOUND",
    "message": "课程不存在或无权访问",
    "request_id": "req_xxx"
  }
}
```

## 版本变化

破坏兼容的API、事件或Artifact Schema变化必须：

1. 增加版本；
2. 更新文档；
3. 提供迁移方式；
4. 在PR中标出影响范围。
