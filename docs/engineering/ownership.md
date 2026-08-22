# 工程逻辑所有权

本页定义评审责任，不改变 GitHub 权限。当前 CODEOWNERS 仍由 `@Timcai06` 兜底；
`tooling/architecture/package-policy.json` 是包到逻辑 Owner 的机器可读事实源。

## 四个逻辑 Owner

| Owner                    | 责任                                                      | 包与组合根                                                                                                                                                                                           |
| ------------------------ | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent-runtime`          | 单一 Agent Loop、教学运行时、实验运行时和后台 Agent 任务  | `agent-core`、`agent-runtime`、`experiment-runtime`、`mcp-runtime`、`teaching-core`、`teaching-runtime`、`apps/worker`                                                                               |
| `gateway`                | `gateway.v1`、客户端入口、Canvas 协议与 Web/桌面/渠道组合 | `gateway-core`、`gateway-runtime`、`gateway-client`、`canvas-protocol`、`channel-telegram`、`apps/gateway`、`apps/web`、`apps/web-runtime`、`apps/desktop`、`apps/node`、`apps/telegram`、`apps/tui` |
| `data`                   | 数据库事实源、对象/资产处理与持久化适配                   | `db`、`asset-processing`                                                                                                                                                                             |
| `developer-productivity` | Provider 隔离、Node 宿主、日志、遥测和仓库治理            | `model-gateway`、`node-host`、`node-runtime`、`logging`、`telemetry` 以及 `tooling/*`                                                                                                                |

包名、`kind`、`domain`、公开入口和例外请直接读取
[`package-policy.json`](../../tooling/architecture/package-policy.json)。新增 workspace 必须先登记；
依赖和入口例外必须精确到 consumer/target，包含原因、追踪号和期限。

## 评审契约

- Owner 负责领域边界、公开入口、兼容性、失败行为和回滚证据；跨 Owner 改动需要双方视角。
- `agent-runtime` 决定 Agent Loop 与工具生命周期；`gateway` 决定公共协议和入口投影；
  `data` 决定 Schema、迁移和持久化语义；`developer-productivity` 决定 CI 与治理门禁。
- Provider SDK、原始响应和密钥止于 `model-gateway`；DB internal 入口只允许 policy 中有期限的精确例外。
- 逻辑 Owner 不是自动批准者。建立 GitHub Team 后，先验证团队存在和仓库权限，再由独立 PR
  把本表映射到 CODEOWNERS；不得预写不存在的 Team。

## 验证入口

```bash
pnpm file:check
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm build
```

数据库、迁移、运行时、浏览器和桌面改动还须执行 CI impact 决定要求的 lane。CI summary 会列出
Changed、Required、Skipped 及原因；分类失败时全矩阵 fail-open。
