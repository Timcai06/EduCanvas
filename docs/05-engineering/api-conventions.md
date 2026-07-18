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

Web Route 只把受控 Runtime 事件映射为 EduCanvas SSE，不能透传 AI SDK、DeepSeek 或其他供应商原始事件。当前浏览器已实现的 `schemaVersion=1` 事件为：

- `turn.accepted`；
- `message.delta`；
- `tool.started / tool.completed / tool.failed`；
- `message.citation`；
- `turn.completed / turn.failed / turn.cancelled`。

Artifact 生命周期事件已以 additive 方式定义（`schemaVersion=1`，旧浏览器按
未知事件忽略，不需要整体协议升版；ADR-0012）：

- `artifact.proposed / artifact.created`：`{type,schemaVersion,turnId,artifactId,kind,trustTier,title}`；
- `artifact.version_added`：`{type,schemaVersion,turnId,artifactId,version}`；
- `artifact.generation_progress`：`{type,schemaVersion,turnId,artifactId,jobId,progress}`；
- `artifact.failed`：`{type,schemaVersion,turnId,artifactId,jobId?,code}`。

断连恢复不依赖流：`GET /api/v1/chat/artifacts` 返回当前 Conversation 的产物
公开投影（id/kind/trustTier/title/status/latestVersion）。

产物创建与轮询（M1 PR-J5a 已接通后端链路）：

- `POST /api/v1/chat/artifacts`：`{kind,title}`（当前仅 `mind_map`）——产物行、
  任务账本与 graphile 队列行同事务原子提交，生成在 worker 内异步执行；
- `GET /api/v1/chat/artifacts/{artifactId}`：最新版本内容（结构化 JSONB；媒体
  版本只含引用与校验和）与最近生成任务状态，供轮询与 Canvas 打开；越权与
  不存在同错 404。

SSE `artifact.*` 事件的生产者与浏览器 UI/全链路 E2E 随 PR-J5b 接线；当前
生成进度经上述端点轮询获取。

约束：

1. SSE `data` 必须通过版本化 Schema，不包含 system Prompt、学生身份内部 ID、API Key、供应商推理或原始异常；
   `data.type`必须与SSE的`event`字段完全一致；首版浏览器已知事件拒绝缺失、错版、空delta和超限字段；
2. `message.delta` 必须来自 `TurnModelEvent.text_delta`，不能在浏览器或服务端用定时器切分完整文本伪造流式；
3. 同一 Turn 恰有一个 `turn.*` 终态，终态之后不能再发送 delta；
4. Provider `failed` 先映射为稳定错误码，再由 Route 选择学生可理解文案；客户端不能解析异常文本判断分支；
5. 浏览器断连不等于学生取消。只有服务端记录了显式取消请求，Provider `aborted` 才能收敛为 `turn.cancelled`；
6. 正常 Turn 的内部模型运行最多为 `answer` 与可选 `synthesis` 两次，SSE 不暴露供应商模型 ID 作为业务控制字段。

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
