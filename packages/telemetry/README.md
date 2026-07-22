# @educanvas/telemetry

## 职责

`telemetry`是第二代Hybrid Ports的基础设施Adapter：把稳定`TurnApplicationTracePort`
映射到OpenTelemetry，同时把SDK、Exporter、采样和资源类型隔离在本包。它不是Operation
事实源，不拥有业务重试，也不记录学生正文、Prompt、模型输出、工具参数或Credential。

生产模块按职责拆分：

- `config.ts`：显式环境、Endpoint、Header、采样和导出超时闸门；
- `turn-trace-adapter.ts`：span属性、静态事件和risk白名单；
- `resilient-exporter.ts`：Exporter失败到安全健康状态的隔离层；
- `runtime.ts`：Node Provider、比例采样、有界Batch、OTLP与NOOP组合；
- `health.ts`：`disabled | ready | degraded`低基数状态。

## 默认与失败语义

- 默认`EDUCANVAS_OTEL_ENABLED=false`，不注册Provider、不连接网络；
- 显式启用但配置非法时返回`degraded/invalid_configuration` NOOP，不阻断Turn；
- 初始化失败返回`degraded/initialization_failed`；
- 运行期导出失败返回`degraded/export_failed`，后续成功可恢复`ready`；
- Runtime不保留Exporter异常、Header值或响应正文。

## 当前范围

Gateway、Web General与Web Teaching已注入相同Turn Trace Port。跨进程W3C carrier、Worker
continuation父子关系和正式Collector/SLO仍是下一纵切，不能以研究fixture代替生产事实。

## 验证

```bash
pnpm --filter @educanvas/telemetry lint
pnpm --filter @educanvas/telemetry typecheck
pnpm --filter @educanvas/telemetry test
```

本包生产与测试文件由仓库tooling执行300行上限门禁。
