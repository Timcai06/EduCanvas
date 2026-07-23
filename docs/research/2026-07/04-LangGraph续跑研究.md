# LangGraph 续跑研究

- 状态：`research`
- 核验日期：2026-07-21
- 研究范围：LangGraph v1 的 persistence、checkpoint 与 interrupt 语义
- 结论级别：候选 Adapter，不是第二代框架决策

## 一、问题定义

EduCanvas 当前能持久化 Gateway Operation Event 并按 sequence 恢复读取，但不能在审批、外部等待或进程崩溃后统一继续未完成计算。研究 LangGraph 的目的，是判断它是否能降低“有界 Workflow continuation”的实现与运维成本，不是替换 Agent Loop、Notebook、Operation 或教育事实源。

## 二、官方语义带来的约束

LangGraph checkpoint 以 thread 标识运行状态，interrupt 可以暂停并在后续输入后恢复。恢复时相关 node 可能从头重新执行，而不是从函数中断的那一行继续。因此 interrupt 之前的副作用必须幂等，或通过独立 effect ledger 判定已经提交。

对 EduCanvas 来说：

- `thread_id` 只能是执行游标，不能成为用户认证或 Notebook 授权；
- checkpoint 不能成为 Operation 终态、Tool Call 或学习事实的第二写者；
- 每次恢复前仍需重新校验 Actor、Membership、approval 与能力；
- Tool/Domain 副作用必须有稳定 idempotency key 和 `outcome_unknown` 处理；
- 普通短 Turn 不因“可持久化”就全部进入图执行。

## 三、适用与不适用场景

| 场景                             | 当前判断   | 原因                                            |
| -------------------------------- | ---------- | ----------------------------------------------- |
| 高风险工具等待人工审批           | 候选       | 有明确等待点，需要恢复并重新鉴权                |
| 跨进程等待外部 Node/Channel 回执 | 候选       | 需要 checkpoint、超时和补偿                     |
| 多阶段 Artifact 流程             | 有条件候选 | 现有 graphile-worker 已覆盖一部分，需证明净收益 |
| 普通聊天 Turn                    | 不采用     | 当前 Loop 足够小，图化增加状态与故障面          |
| Notebook/Conversation 持久化     | 不采用     | 它们是产品事实，不是框架 thread                 |
| 掌握度和课程判分                 | 不采用     | 必须由确定性教育领域服务维护                    |

## 四、对照实验

应使用同一组 fixture 比较原生 PostgreSQL lease + graphile-worker continuation 与 LangGraph PostgreSQL Saver：

1. 模型完成前进程退出；
2. Tool 副作用提交后、结果落账前退出；
3. `approval.required` 写入后退出；
4. approval 通过后、runner 领取前退出；
5. 最终事件写入前后分别退出。

每个 kill point 都验证唯一终态、无重复副作用、Actor/Notebook 重新鉴权、N-1/N-2 数据兼容、滚动升级、回滚、可观测性、代码量和运维成本。只有候选在相同约束下产生可验证净收益，才进入 proposed ADR。

## 五、集成边界

若采用，LangGraph 应位于 `OperationContinuationPort` 后：

```text
Gateway Operation + approval + effect ledger
  -> OperationContinuationPort
  -> native executor OR LangGraph adapter
  -> canonical Operation Events
```

Gateway 继续拥有身份、Operation 和事件；Tool Kernel 继续拥有授权与副作用语义；教育 Domain Services 继续拥有学习事实。Saver 中的 checkpoint 是可替换执行状态，不能成为外部 API 的永久契约。

## 六、主要来源

- [LangGraph JavaScript persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence)
- [LangGraph interrupts](https://docs.langchain.com/oss/python/langgraph/interrupts)
- [LangGraph v1 release notes](https://docs.langchain.com/oss/javascript/releases/langgraph-v1)

进入正式决策前必须固定 package 版本、PostgreSQL Saver 版本与验证日期，并确认许可证、升级和回滚边界。
