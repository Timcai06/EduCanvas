# Tool Kernel 夹具

- 状态：`verified`
- 适用范围：第二代架构研究，不是生产 Runtime
- 最后验证时间：2026-07-21
- 复现入口：`pnpm test:tooling`

## 一、要回答的问题

EduCanvas 当前同时存在通用 `AgentToolRegistry` 与教学 `TeachingToolExecutor`。第二代架构若要收敛为一个 Tool Kernel，必须先证明本地 Tool、Teaching Tool、MCP Tool 与 Node Tool 可以只通过 Adapter 表达差异，并共享以下可信语义：

1. Actor、Notebook、Profile、入口 Channel 与运行环境的能力交集；
2. L2/L3 工具在执行前进入统一审批边界；
3. 写操作先记录 intention，再记录 committed 或 `outcome_unknown`；
4. 相同 `executionId` 幂等重放，冲突调用 fail closed；
5. timeout 与 cancellation 向 Adapter 传播 `AbortSignal`；
6. 原始参数、输出和异常不进入失败结果与 effect ledger。

## 二、夹具结构

`tooling/tool-kernel-fixture.mjs` 是研究专用、无生产调用者的最小语义模型。四类 Adapter 只声明：

- `source`：`local | teaching | mcp | node`；
- `capability`、`risk` 与 `effect`；
- timeout 和实际 `invoke()`。

Adapter 不拥有身份、Notebook、审批、幂等或终态判定权。Kernel 从可信上下文计算五个集合的交集；任一集合拒绝都不会调用 Adapter，也不会写入 effect ledger。

## 三、故障注入结果

| 场景                               | 预期终态             | 结果 |
| ---------------------------------- | -------------------- | ---- |
| 四类 Adapter 通过同一 Kernel       | `succeeded`          | 通过 |
| 五个权限维度逐一移除 capability    | `denied`             | 通过 |
| L2 write 未审批                    | `approval_required`  | 通过 |
| 相同 executionId、相同语义参数重放 | replay，不二次调用   | 通过 |
| read timeout                       | 可重试 `timed_out`   | 通过 |
| write timeout                      | `outcome_unknown`    | 通过 |
| read/write cancellation            | cancelled / unknown  | 通过 |
| Adapter 抛出含敏感信息的错误       | 稳定码、敏感信息为零 | 通过 |

复现命令：

```bash
pnpm test:tooling
```

## 四、结论与边界

实验支持一个统一 Tool Kernel 加四类 Adapter 的方向，也证明 Teaching Tool 不需要保留第二套执行内核；教学状态白名单应成为能力策略输入，而不是独立超时、幂等和审计实现。

该实验在当时尚未授权生产迁移；随后已由接受的ADR-0020明确唯一写者与迁移边界，并落地生产Tool Kernel契约和持久effect ledger。Gateway approval continuation、远端MCP/Node生命周期、Credential Broker以及两套旧Runtime的逐入口迁移仍按active计划推进，不能因Kernel类已经存在而宣称完成。
