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

