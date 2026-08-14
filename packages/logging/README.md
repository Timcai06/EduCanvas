# @educanvas/logging

统一事件日志协议（`educanvas.log.v1`）的 TypeScript 实现：结构化记录、JSONL sink、终端 pretty rendering、安全错误序列化与敏感字段脱敏。

## 包职责

| 模块 | 职责 |
| --- | --- |
| `src/types.ts` | 日志信封类型、级别、统一事件名、运行会话元数据 |
| `src/logger.ts` | `Logger`：产生标准信封；`event`（稳定机器接口）与 `message`（人类可读）分离 |
| `src/safe-error.ts` | 安全错误序列化：只保留 name/code/message/retryable，防循环引用/深度/长度失控 |
| `src/redaction.ts` | 递归脱敏：密码/Token/Authorization/Cookie/Prompt/DATABASE_URL 等 |
| `src/json-sink.ts` | JSONL 写出：每行可独立 `JSON.parse`，无 ANSI，超长截断不破坏 JSON |
| `src/pretty-renderer.ts` | 终端渲染：中文宽度对齐、TTY 颜色、NO_COLOR、克制样式 |
| `src/context.ts` | AsyncLocalStorage 关联链（requestId/operationId/traceId/jobId）传播 |
| `src/testing.ts` | 测试辅助（MemorySink/StringSink），生产代码禁止依赖 |
| `protocol.json` | 协议常量单一事实源，tooling（.mjs）通过 JSON import 共享 |

## 职责边界

- **logging ≠ telemetry**：OpenTelemetry traces/metrics 归 `@educanvas/telemetry`；logging 不承担 trace 生命周期，telemetry 不承担终端渲染与文件轮转。
- **logging ≠ 业务事实源**：持久化操作状态以数据库 operation store 为准，日志只做关联与诊断。
- 禁止记录：Prompt、正文、Token、Credential、数据库连接串、未经清洗的第三方响应正文。

## 常用命令

```bash
pnpm --filter @educanvas/logging test        # vitest 单元测试
pnpm --filter @educanvas/logging typecheck   # tsc --noEmit
pnpm --filter @educanvas/logging lint        # prettier 检查
```

## 改动前必读

- `docs/09-decisions/` 中统一日志协议与本地运行时重构 ADR
- `docs/08-collaboration/02-文档维护规则.md`
