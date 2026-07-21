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

| 场景                                                     | 当前证据                                                                                                  | 结果                       |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------- |
| Contributor 回复共享 Notebook                            | `DrizzleGatewayRouteResolver` 返回 contributor 自己的 `actorUserId + agentId`                             | 通过                       |
| Contributor 的 Operation 调用 Notebook owner 的私人 Node | `DrizzleGatewayNodeRepository.enqueue()` 只校验 Node active 与 capability，没有核对 Operation Actor/Agent | 失败，已用 `it.fails` 固化 |
| 私人 Memory                                              | 尚无稳定的 Actor-bound Schema/Port                                                                        | 无法验证                   |
| Credential                                               | 尚无 Credential Broker 或持久归属模型                                                                     | 无法验证                   |
| default Tool Grant                                       | Capability Manifest 已有形状，但没有个人默认 grant 的唯一事实模型                                         | 无法验证                   |

`it.fails` 表达“安全断言应成立，但当前实现确实失败”。这样 CI 可以保存可执行失败证据；当生产修复使断言意外通过时，Vitest 会要求删除 `.fails`，把它转成永久回归测试。它不是跳过测试，也不是把当前行为描述为安全。

## 三、已定位的失败路径

```text
Contributor principal
  -> shared Notebook route
  -> Contributor agent_operation
  -> enqueue(owner nodeId)
  -> only checks node status + approved capability
  -> invocation accepted
```

Node pairing 已持久化 owner `userId + agentId`，Operation 也持久化 `actorUserId + agentId + notebookId`；缺口在于 `enqueue()` 没有在同一事务连接并比较两侧归属。因此它不是 Prompt 或 UI 能修复的问题。

## 四、当前结论

Notebook 路由的“共享资源但不共享 Agent 身份”已经通过第一条 fixture；Node 私有能力隔离明确失败。Memory、Credential 与 default grant 还没有可供端到端验证的权威数据模型。

因此 active 计划中的完整 Notebook Privacy fixture 仍保持未完成。下一步先提出最小 Actor-bound `NodeInvocationPort` 与数据库约束方案，连同迁移/回滚和失败测试进入负责人评审；在研究阶段获准前，不修改生产 Schema 或 Repository 行为。
