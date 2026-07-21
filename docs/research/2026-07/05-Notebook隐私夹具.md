# Notebook 隐私夹具

- 状态：`research`
- 核验日期：2026-07-21
- 适用分支：`test/20260721-notebook-privacy-fixture`
- 测试入口：`packages/db/src/notebook-privacy.integration.test.ts`、`tooling/notebook-privacy-fixture.test.mjs`
- 决策状态：研究契约通过；尚未实现的能力保持 unavailable，不等于生产能力已完成

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
| 私人 Memory                                              | 研究 Port 固定 `ownerActorId + ownerAgentId`；缺少生产模型时显式 unavailable                     | 通过     |
| Credential                                               | 研究 Port 固定双 owner 与 fail-closed；Credential Broker 仍未实现                                | 通过     |
| default Tool Grant                                       | 研究 Port 固定为个人 Agent 私有资源；不存在时不得推断空 grant 或继承 Notebook owner              | 通过     |

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

Notebook 路由的“共享资源但不共享 Agent 身份”和 Node 私有能力隔离已有真实数据库证据。纯逻辑 fixture 进一步冻结 Memory、Credential、Node 与 default grant 的共同最小契约：只有可信 Actor 对应的 Personal Agent 且资源双 owner 同时匹配才允许使用；Notebook Membership 不参与个人能力授权；客户端伪造 Agent id、资源缺失或能力尚未实现都 fail closed。

这完成的是第二代 ADR 前的隐私契约，不是 Memory、Credential Broker 或 default grant 的生产实现。未来任何一项进入生产，必须把同一 fixture 下沉为仓储集成测试，并补齐撤销、删除、审计与并发语义；在此之前产品必须诚实返回 unavailable。
