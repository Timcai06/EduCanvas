# Continuation 对照实验

- 状态：`verified`
- 适用范围：第二代架构研究，不是生产 continuation
- 最后验证时间：2026-07-21
- 复现入口：`make integration`

## 一、候选与版本

| 候选                     | 实验版本 | 2026-07-21 latest | 许可证 | 仓库状态 |
| ------------------------ | -------- | ----------------- | ------ | -------- |
| `@langchain/langgraph`   | 1.4.8    | 1.4.8             | MIT    | 仅 dev   |
| LangGraph Postgres Saver | 1.0.4    | 1.0.4             | MIT    | 仅 dev   |
| `graphile-worker`        | 0.16.6   | 0.17.3            | MIT    | 已生产   |

LangGraph 事实只依据官方 [Persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence)、[Interrupts](https://docs.langchain.com/oss/javascript/langgraph/interrupts)、[langgraphjs](https://github.com/langchain-ai/langgraphjs) 与 Postgres Saver 源码。graphile-worker 事实只依据官方 [可靠性说明](https://worker.graphile.org/docs)、[错误与进程退出](https://worker.graphile.org/docs/error-handling)和 [Task executor](https://worker.graphile.org/docs/tasks)。

本实验刻意不升级仓库已有的 graphile-worker 0.16.6，避免把“框架比较”和“队列升级”混成一个变量。LangGraph 两项依赖只在 `@educanvas/worker` 的 `devDependencies`，无生产导入。

## 二、相同工作流

两边运行同一个有界流程：

```text
prepare -> approval pause -> approved effect -> finalize
```

- `operationId` 是业务键，LangGraph `thread_id` 和 graphile payload 都只能引用它，不能取代 Operation；
- approval 结果由外部可信控制面写入，不采信模型；
- effect 用 `effectKey` 唯一约束，重复执行只返回既有结果；
- checkpoint/job 只保存控制状态，不写学生正文、Prompt、判分键或 Credential。

## 三、五个 kill point

测试通过抛错并重建 graph/checkpointer 或 task list，模拟进程内存完全丢失；恢复只读取 PostgreSQL。

| Kill point                               | LangGraph Saver | graphile-worker | 必要条件                             |
| ---------------------------------------- | --------------- | --------------- | ------------------------------------ |
| 1. 初始持久化提交前                      | 通过            | 通过            | 无 checkpoint/事务整体回滚后重新发起 |
| 2. durable start 后、prepare 前          | 通过            | 通过            | checkpoint / job 已持久化            |
| 3. prepare 完成后、approval 前           | 通过            | 通过            | 恢复等待态，不越过审批               |
| 4. approval 提交后、effect 前            | 通过            | 通过            | 批准与 continuation 指针持久化       |
| 5. effect 已提交、checkpoint/finalize 前 | 通过            | 通过            | effectKey 幂等；最终只产生一个副作用 |

第 5 点是决定性证据：LangGraph 从上一个 checkpoint 重跑 effect node；graphile-worker 把失败 job 再调度。两者都无法提供业务 exactly-once，必须依赖 EduCanvas 外层的唯一 effect ledger、事务与 outcome reconciliation。

## 四、数据兼容与滚动回退

仓库夹具验证：

- 当前实现读取 N-2、N-1 checkpoint/row 并完成流程；
- N-1 启动的流程可由 N 完成；
- N 启动的流程可由 N-1 完成，证明受控 rollback；
- 最终副作用每个 `operationId` 都只有一行。

该结果只对“节点名、边和状态兼容”的受控演进成立。LangGraph checkpoint 包含 channel/version/next-node 语义，删除或重命名 node、改变 reducer 与并行 super-step 都需要显式迁移夹具；不能把测试通过泛化为任意图版本兼容。

## 五、实现与运维成本

| 维度           | LangGraph + Postgres Saver                                       | 原生 graphile-worker continuation                         |
| -------------- | ---------------------------------------------------------------- | --------------------------------------------------------- |
| 新直接依赖     | 2 项，安装时新增约 20 个包                                       | 0，仓库已经使用                                           |
| 新持久表       | 4 张 checkpoint 专用表                                           | 队列表已存在；业务状态仍需显式表/现有 Operation           |
| 状态表达       | graph、super-step、interrupt、checkpoint                         | 显式状态、step payload、事务入队                          |
| 副作用恢复     | node 可能重跑，必须外层幂等                                      | job 至少一次，必须外层幂等                                |
| Schema 演进    | graph state + node topology + Saver migrations                   | payload/state 版本解码 + 业务迁移                         |
| 当前团队运维面 | 新增 checkpointer schema、迁移、清理、容量和 checkpoint 可观测性 | 延续现有 worker；仍需处理异常退出后 job 最长锁定约 4 小时 |

实验文件共 590 行，包含两套实现、五点故障注入和兼容性断言；它不能当作生产 LOC 预测。当前证据没有显示 LangGraph 能在相同信任、迁移和运维约束下把总成本降低 30%。

## 六、结论

1. **approval continuation 继续采用 graphile-worker + PostgreSQL 业务状态**：它已经在仓库运行，能与业务事务原子入队，且不会产生第二 Operation/Notebook 事实源。
2. **LangGraph 保持 `adapt/defer`**：仅当未来出现分支、并行、循环、长暂停都明显的有界 Workflow，并且图语义相对显式状态机达到 30% 总成本优势时再评估。
3. **不用于普通 Turn**：正常 Agent Turn 继续由 `AgentLoopEngine` 运行，不能为每轮对话创建 checkpoint thread。
4. **不把 checkpoint 当业务账本**：即使采用 LangGraph，Operation Event、审批、学习事实与 effect ledger 仍由 EduCanvas 唯一写者持久化。
5. **原生方案仍有待办**：生产 continuation 必须补 job heartbeat/异常锁恢复策略、approval 后原子入队和 effect reconciliation；这些进入第二代实施计划，而不是用框架名掩盖。
