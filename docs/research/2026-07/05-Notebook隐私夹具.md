# Notebook 隐私夹具

- 状态：`research`
- 核验日期：2026-07-21
- 适用分支：`test/20260721-notebook-privacy-fixture`
- 测试入口：`packages/db/src/notebook-privacy.integration.test.ts`
- 决策状态：hard gate 未通过，不授权第二代生产迁移

## 一、要证明的边界

Notebook Membership 只共享 Notebook 内显式资源，不传播个人 Agent 的私人能力。fixture 最终必须同时证明：

1. Source、Conversation 与 Artifact 按 Membership 可见；
2. 每个参与者继续使用自己的 Personal Agent；
3. 私人 Memory、Credential、Node 与 default Tool Grant 对其他 Actor 不可见；
4. Operation、Approval 与 Node invocation 的 Actor/Agent/Notebook 在同一事务中一致；
5. 归属错误时整个调用 fail closed，不能过滤后继续或依赖客户端自报。

## 二、第一条可执行纵切

| 场景                                                     | 当前证据                                                                                        | 结果     |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | -------- |
| Contributor 回复共享 Notebook                            | `DrizzleGatewayRouteResolver` 返回 contributor 自己的 `actorUserId + agentId`                   | 通过     |
| Contributor 的 Operation 调用 Notebook owner 的私人 Node | `enqueue()` 在同一事务锁定 Node pairing，并从 Operation 读取可信 Actor/Agent 与 Node owner 比较 | 通过     |
| 私人 Memory                                              | 尚无稳定的 Actor-bound Schema/Port                                                              | 无法验证 |
| Credential                                               | 尚无 Credential Broker 或持久归属模型                                                           | 无法验证 |
| default Tool Grant                                       | Capability Manifest 已有形状，但没有个人默认 grant 的唯一事实模型                               | 无法验证 |

PR #101 曾用 `it.fails` 固化该安全缺口；修复后已删除 `.fails`，同一断言成为永久回归测试。调用方仍只提交 `operationId + nodeId`，不能通过新增主体字段伪造归属。

## 三、已定位的失败路径

```text
Contributor principal
  -> shared Notebook route
  -> Contributor agent_operation
  -> enqueue(owner nodeId)
  -> lock pairing + read Operation Actor/Agent
  -> owner mismatch
  -> forbidden
```

Node pairing 已持久化 owner `userId + agentId`，Operation 也持久化 `actorUserId + agentId + notebookId`。`enqueue()` 现在在同一事务连接两侧事实、锁定 pairing，并在写 invocation 前比较 Actor/Agent；并发 revoke 会等待该锁，后续调用看到 revoked 后 fail closed。

## 四、当前结论

Notebook 路由的“共享资源但不共享 Agent 身份”和 Node 私有能力隔离已经通过 fixture。Memory、Credential 与 default grant 还没有可供端到端验证的权威数据模型；当前没有相应生产能力或外部入口，因此它们保持 unavailable，而不能被描述成已实现。

因此 active 计划中的完整 Notebook Privacy fixture 仍保持未完成。下一步要为尚未实现的 Memory、Credential 与 default grant 冻结 Actor-bound 契约和 fail-closed fixture；在这些能力进入生产前，必须先有 owner 模型、撤销/删除语义和跨 Actor 回归测试。
