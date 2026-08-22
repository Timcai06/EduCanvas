# CX02 RM/CA 跨计划契约审计

- CA 候选：`8fa9d6b143e33a75038de608cbc730966c9ea3d4`
- RM 只读候选：`ae7c82276c4d44fa2d7821947513eb5e3a4db4b5`
- 方式：两工作树静态只读审计；没有 cherry-pick、复制 RM 代码或修改 RM worktree
- 边界：本文件保留单线静态审计；联合运行项已由 integration reviewer 在 `908489b` 验证

## 契约矩阵

| 接缝                             | CA 事实                                                                                                                          | RM accepted 事实                                                                                                                     | 结论                                                                     |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| Artifact identity/version/status | Turn parts 与 operation reference 保持稳定 ID；终态恢复不新建 Artifact                                                           | `resourceId=artifact.id`，version 使用真实 immutable version ID/sequence；latest job 决定生命周期，version job 决定该版本 provenance | 静态对齐；失败 revision 不抹掉可用旧版本，也不把 Turn 伪完成             |
| provenance                       | CA terminal/ledger 不授予资源访问                                                                                                | 所有 production projection caller 都传 displayed version 的 nullable `versionJob`；source refs 由 owning job 冻结                    | 已对齐；两线集成后复查 historical version + failed revision              |
| allowedActions/reauth            | subject/operation/citation 权限由服务端事实决定                                                                                  | actions 由服务端按 kind/status/version/role 派生；Web/Gateway/Telegram 打开或动作时重新 Notebook 鉴权                                | 已对齐；provenance 不是授权，浏览器 action 也不是授权                    |
| Context Snapshot                 | Agent/runtime 持久化实际 selected version 与同序 representation；服务端重验 owner/Notebook/ready version                         | 浏览器 builder 只冻结 ready+immutable version 的选择意图，普通 Turn 与 Live 共用                                                     | 分层对齐；浏览器 snapshot 不是服务端权威物化                             |
| Turn terminal                    | assistant/citation/intent 同事务；Gateway event lock 下唯一收敛 completed/failed/cancelled；内部 interrupted 对外归一 failed     | Web/Gateway 消费同一闭集 terminal，Worker continuation 失败/撤权不冒充 completed                                                     | 静态对齐；canonical 不得把 interrupted 写成公开第四种 Gateway event      |
| effective subject                | profile/session/data owner 分离；公开 DTO 去 ID；无自动 ownership migration；Gateway separate session                            | RM routes/read model 使用可信 data owner 与 Notebook，cache key 含哈希主体；不信任 profile 授权                                      | 已对齐；local+registered 仍归 local owner                                |
| ledger/citation/rollback         | K12 platform 可见字段全量 parity 后读取；公开 legacy ID/turn/client/cursor/citation 保留；runtime 仍 legacy；回退 legacy+restart | RM Artifact/Live projection 不改变消息 authority 或创建第二 ledger                                                                   | 已对齐；只有 Web K12 history 已切 adapter，不能虚构所有入口都切 platform |
| Live resource projection         | 单 Agent loop、单 terminal/ledger；服务端仍重验版本与 Notebook                                                                   | Live 与普通 Turn 共用浏览器 context builder；资源 summary/renderer/action 来统一 RM 合约                                             | 静态对齐；真实麦克风/Safari/Provider 仍是外部证据                        |
| 多入口                           | Gateway/Worker 按持久 actor/conversation/notebook 重验；CA 不接受客户端 principal                                                | Web/Gateway/Telegram 复用 artifact projection；Telegram 由 binding userId 再验 notebook.read                                         | 已对齐；集成后仍需撤权与跨 Notebook conformance                          |

## 已对齐事实

1. Artifact 可用版本与最新生成任务是两层事实：最新 revision failed/cancelled 时，已有 immutable
   version 仍可 ready；其 provenance 必须来自该 version 的 owning job。
2. Context Snapshot 的浏览器对象只表达选择；服务端 `conversation.reply`、owner、space、ready
   immutable version 校验才是入模授权。
3. K12 platform cutover 不改变公开消息、citation 或 runtime identity；不一致整页 fail closed，
   不混读也不静默 fallback。
4. effective subject 的 data owner 不由资料页、Cookie 显示名或客户端 payload 推导，也不触发自动
   迁移。
5. Web、Gateway、Worker、Telegram 都从服务端或持久 binding/scope 取得主体，资源读取再次鉴权。

## Reviewer-owned integration conflicts（已解决）

1. `apps/web/features/workspace/general/general-workspace-layout.tsx` 已同时保留 CA Studio→Canvas
   焦点边界和 RM Dock/Studio 资源打开行为。
2. `docs/09-decisions/0028-Turn终态持久收敛边界.md` 已保留 accepted CA reconciliation 的
   fail-closed 终态语义，并整合 RM 资源事实。
3. 两线已进入同一候选树。Reviewer 补充 typed Turn outcome，保留失败/取消/拒绝/中断时的
   一次性输入，并通过真实 Artifact API→Worker→Studio→Canvas 纵切与 Desktop Chromium 50/50。

联合门禁、命令设置失败归因与未验证范围见
[RM/CA 最终集成交付与结档证据](22-RM-CA最终集成交付与结档证据.md)。

## 不属于 CA 本轮的缺口

- KM：长期 Memory/RAG、跨 Notebook citation/retrieval 扩展；
- O：生产观测窗口、成本与远端 nightly/release；
- LC：真实 Live Provider、真人麦克风、Safari 产品验收；
- RM：Dock、Studio、Canvas renderer、Workspace controller 的产品演进；
- CA06：Desktop/Gateway Client，继续 `DEFERRED`。

本审计没有发现需要 CA 越权修改 RM 代码才能解决的 blocker，也不把上述未来能力写成已闭环。
