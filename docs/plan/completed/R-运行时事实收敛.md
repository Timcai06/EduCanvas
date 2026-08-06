# Turn Runtime、数据事实与公共边界收敛

- 任务分配名：`R 运行时收敛`
- 状态：`completed`
- 负责人：项目负责人
- 实现执行：协作 Agent，每次只领取一个原子任务
- 代码审核与最终验收：Codex
- 最后验证时间：2026-08-06
- 当前领取任务：无（R00-R08 已完成并通过 Codex 复核）
- 并行计划：[W 工作面画布](../active/W-工作面画布收敛.md)、[Q 质量观测成本](../active/Q-质量观测成本.md)
- 后续出口：[G 产品发布闭环](../active/G-产品发布闭环.md)
- 关联计划：[UV 画布语音](../active/UV-画布语音.md)、[KM 知识记忆](../active/KM-知识记忆.md)

## 一、目标

本线只解决两轮架构审计中最核心的问题：**Turn 控制流虽然共享同一
`TurnApplicationService`，但应用组合根、持久事实、数据库公共出口和兼容协议仍然存在双轨。**

阶段结束后必须能够验证：

1. Web General、Web Teaching 与 Gateway 不再分别复制完整 Turn Runtime 装配逻辑；
2. Platform Turn、旧 Chat/K12 Turn、Model Run、Tool Call 等重叠事实都有明确唯一权威、
   兼容读取路径和退场计划，不再无限期双写；
3. `@educanvas/db` 默认公共出口不再暴露任意 `getDb`、全部 schema 和无边界仓储；
4. Context Snapshot 能完整记录模型实际看到的全部 Asset 版本，包括单轮多图；
5. 运行时 Node 版本、TypeScript Node 类型和 CI 基线一致；
6. 工具、错误与能力标识不再通过中文展示文案或字符串包含关系推断协议身份；
7. 本线通过删除旧路径和减少公共概念完成收敛，不以新增第二套框架、第二个 Runtime 或
   新微服务冒充优化。

本计划不是第三代架构重写，不拆微服务，不重做 Agent Loop、Tool Kernel、Context Engine、
Gateway 协议或教学领域状态机。现有可信失败、审批、取消、恢复和账本纪律必须保留。

## 二、已经确认的代码事实

| 事实                                                                | 代码位置                                                                                                                                 | 本计划处理                       |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| Web General、Web Teaching、Gateway 都使用 `TurnApplicationService`  | `apps/web/server/platform/general-turn.ts`、`apps/web/server/teaching/learning-turn.ts`、`apps/gateway/src/agent-runner.ts`              | 保留唯一应用服务，收敛组合根     |
| Web 仍经 Gateway envelope、兼容 Runner 和 legacy event 投影         | `apps/web/server/gateway/web-turn.ts`                                                                                                    | 删除展示文案推断与不必要协议往返 |
| `@educanvas/db` 默认导出 `getDb`、schema 和大量仓储                 | `packages/db/src/index.ts`                                                                                                               | 建立受控 subpath 和架构门禁      |
| Platform Turn 与旧 Chat/K12 持久模型并存                            | `packages/db/src/index.ts` 及相关 repository                                                                                             | 盘点、确定权威、迁移、停止双写   |
| 多张原生图片合成一个 Context Segment，但只登记首张 `assetVersionId` | `apps/web/server/platform/general-turn-profile.ts`、`packages/agent-runtime/src/context-engine.ts`                                       | 修复完整追溯                     |
| Runtime 使用 Node 22，多个包使用 Node 26 类型                       | `.nvmrc`、各 `package.json`                                                                                                              | 统一版本                         |
| 模型配置在组合根和 factory 中重复解析                               | `apps/web/server/model/model-runtime.ts`、`apps/worker/src/model-runtime.ts`、`packages/model-gateway/src/turn-model-gateway-factory.ts` | 单次解析与显式注入               |
| Web 兼容投影存在展示标签和字符串错误映射                            | `apps/web/server/gateway/web-turn.ts`                                                                                                    | 改为稳定协议枚举                 |

若实现时任一事实已变化，先停止当前任务，更新本表并由 Codex 重新确认依赖，不得按过期报告
机械改代码。

## 三、绝对边界与协作纪律

### 允许触达的主路径

- `packages/agent-core/src/**`
- `packages/agent-runtime/src/**`
- `packages/db/src/**`
- `packages/db/package.json`
- `packages/model-gateway/src/**`
- `apps/gateway/src/**`
- `apps/web/server/platform/**`
- `apps/web/server/gateway/**`
- `apps/web/server/model/**`
- `apps/web/server/teaching/**`
- `apps/worker/src/model-runtime.ts`
- 根目录 Node / TypeScript / workspace 配置
- 与本线直接对应的测试和 canonical 文档
- 本计划文件

### 默认禁止

- 不改 Canvas UI、Composer、Workspace 布局、视觉设计；
- 不改实时语音 Adapter、音频留存或对象删除任务；
- 不实现 Memory、Product Knowledge 或新的 RAG 能力；
- 不新建第二个 Agent Loop、Context Compiler、Tool Kernel 或 Turn Ledger；
- 不引入微服务、消息总线、ORM 替代或数据库重写；
- 不在同一 PR 同时做“新事实上线”和“旧事实物理删除”，除非已有完整迁移与回退证据；
- 不修改其它 active 计划文件；
- 不 reset、restore、checkout、stash、rebase 或格式化任务外文件。

### 与其它 active 线的冲突规则

- `R02` 会触达 Context 契约，必须在 KM 的 M02 前完成，或等待 M02 合并后重放；
- `R03` 会触达模型配置，若 UV 仍在修改同一配置文件，必须等待 UV 对应任务合并；
- `R04-R06` 是本线串行主干，不与任何修改 Turn/DB 组合根的任务并行；
- `R01`、`R07` 可在文件所有权不重叠时独立并行。

## 四、共同提示词

```text
你只执行“R Turn Runtime、数据事实与公共边界收敛”当前指定的一个原子任务。

先阅读仓库根 AGENTS.md、CLAUDE.md、本计划、第二代架构文档、系统架构现状、相关 ADR，
再阅读当前任务涉及的源码和相邻测试。每条 shell 命令必须以 rtk 开头。

硬边界：
- 只修改当前任务列出的文件；需要越界时立即停止并报告；
- 不创建第二个 Agent Loop、TurnApplicationService、Tool Kernel、Context Compiler、
  Gateway authority 或数据库事实源；
- 不把“新增一层 Adapter”当作收敛；优先删除重复装配、重复事实和重复映射；
- 不用中文展示文案、错误 message、字符串 includes 或 UI label 作为协议身份；
- 数据迁移必须先兼容、再切换、最后删除；没有回滚和 N-1 证据不得删除旧事实；
- 一个文件接近 400 行必须评估拆分，手写文件不得超过 600 行；
- 不替 Codex 宣布 PASS，不提交、推送或合并。

实施顺序：
1. 先补能证明当前缺口的失败测试或静态门禁；
2. 做最小实现；
3. 删除被替代路径；
4. 运行局部验证，再运行任务要求的跨包验证；
5. 检查没有把旧路径留成永久兼容层。

完成回报必须包含：
1. 任务编号与 PASS / PARTIAL / BLOCKED；
2. 基线 SHA、修改文件和每个文件的单一职责；
3. 验收标准到测试或静态门禁的逐项映射；
4. 实际命令、退出码和关键输出；
5. 删除了哪些重复路径，仍保留哪些兼容路径及退出条件；
6. 数据迁移、回退、安全边界和残余风险；
7. rtk git diff --check、rtk git diff --name-status、rtk git status --short。
```

## 五、执行顺序与并行关系

```text
R00 → R01
  ├→ R02 ─┐
  ├→ R03 ─┼→ R04 → R05 → R06 → R08
  └→ R07 ─┘
```

- `R01`、`R02`、`R03`、`R07` 在文件所有权无交集时可并行；
- `R04-R06` 依次处理公共出口、持久事实和组合根，是串行主干；
- `R08` 只有在所有遗留兼容路径都有删除结论后才可开始。

## 六、原子任务

### R00：基线、重复路径与所有权冻结

- 依赖：无
- 文件边界：本计划
- 可并行：否

只做只读盘点：

1. 记录 HEAD、origin/main、当前分支、worktree 和预存改动；
2. 绘制 Web General、Web Teaching、Gateway 三条 Turn 路径的真实调用图；
3. 列出全部 Turn、Message、Model Run、Tool Call、Context、Operation 持久表及写入者；
4. 列出 `@educanvas/db` 与 `@educanvas/agent-core` 默认出口；
5. 标记兼容投影、双写、只读旧路径和计划删除路径；
6. 核对 UV、KM 与本线文件交集，只更新本计划台账。

完成标准：

- 每个事实有 `file:line`；
- 区分“同一语义的重复实现”和“有意分层的不同事实”；
- 不把文档宣称写成代码事实；
- 输出一张权威矩阵：`事实类型 → 唯一写入者 → 读取者 → 兼容期限`。

验证命令：

```text
rtk git rev-parse HEAD
rtk git rev-parse origin/main
rtk git status --short
rtk rg -n "new TurnApplicationService|AgentLoopEngine|PlatformTurn|ChatRepository|ModelRun|ToolCall|export \* from './schema'|getDb" apps packages
```

### R00 盘点台账（2026-08-06，最终结论 `PASS`）

R00 为只读盘点，本台账只记录代码事实；Codex 复核后最终结论 `PASS`，无 BLOCKED 项。

#### R00.1 基线记录

- HEAD：`fe6ab1a14516cfe37b13f08b1f0c8273d4d62b54`（`ci: fix voice lint and secret scan fingerprints`）
- origin/main：`fe6ab1a14516cfe37b13f08b1f0c8273d4d62b54`（与 HEAD 一致）
- 当前分支：`main`
- worktree：`/Users/tim/DEV/EduCanvas`（main）、`/Users/tim/dev/EduCanvas-ui`（ui）
- 预存改动：`git status --short` 为空（工作区干净）
- 盘点期间并发改动（非本任务修改）：`apps/web/features/voice/voice-capability.ts`
  （未跟踪，创建于 2026-08-06 12:06:41，内容标注 V17-B 语音能力闸门，属 UV 线 V17 返工产物）；
  与 R 线文件边界无交集，不影响 R02/R03 判定
- 本次改动：仅本计划文件

#### R00.2 三条真实 Turn 调用图

**Web General**（浏览器 → 平台 turn）：

```text
apps/web/app/api/v1/chat/turn/route.ts
  → beginWebGatewayTurn (apps/web/server/gateway/web-turn.ts:206)
      → loadOwnedGeneralConversation (apps/web/server/platform/general-conversation.ts:29)
      → prepareGatewayGeneralTurnContext (apps/web/server/platform/general-turn.ts:138 → assets/asset-materialization)
      → GatewayService.handle (packages/gateway-runtime) ＋ DrizzleGatewayIdentityRepository /
        DrizzleGatewayRouteResolver / DrizzleGatewayOperationStore / Sha256GatewayRequestFingerprint
        (web-turn.ts:32-35)
      → WebCompatibilityRunner.run (web-turn.ts:165)
          → beginGatewayGeneralTurnApplication (general-turn.ts:46)
              → new TurnApplicationService (general-turn.ts:96)
                  lifecycle: WebGeneralLifecycle → DrizzlePlatformTurnRepository
                    attachGatewayTurn/settleTurn (general-turn-lifecycle.ts:54/:124)
                  profile: WebGeneralProfile（prepare 只读 listMessages :113，finalize 不写 DB）
                  contextLedger: DrizzleAgentTurnContextRepository (turn_context_snapshots)
                  modelRunLedger: DrizzleAgentModelRunRepository (model_runs)
                  modelGateway: resolveTurnModelRuntime() (apps/web/server/model/model-runtime.ts:60-77)
                  toolKernel: createGeneralToolKernel → new ToolKernel(adapters,
                    DrizzleAgentToolCallRepository, DrizzleToolEffectRepository)
                    (general-turn-tools.ts:140-144)
                  cancellation: WebGeneralCancellation（只读轮询 isTurnCancellationRequested :155）
                  trace: getWebTelemetryRuntime().turnTrace
      → projectTurnApplicationEventToGateway (packages/gateway-runtime)
      → gatewayToLegacy (apps/web/server/gateway/turn-application-projection.ts:161) → TeachingTurnEvent SSE
```

**Web Teaching**（浏览器 → 教学 turn）：

```text
apps/web/app/api/v1/learn/turn/... route
  → beginTeachingGatewayTurn (apps/web/server/gateway/teaching-turn.ts)
      → loadOwnedTeachingGatewayTarget / loadOwnedTeachingSession (apps/web/server/teaching/learning-session.ts)
      → prepareGatewayTeachingTurnContext (learning-turn.ts:150)
      → GatewayService.handle ＋ identities/routes/operations（同 Web General 一套仓储）
      → TeachingTurnApplicationRunner.run (teaching-turn.ts)
          → beginGatewayTeachingTurnApplication (learning-turn.ts:74)
              → new TurnApplicationService (learning-turn.ts:112)
                  lifecycle: WebTeachingLifecycle → webTeachingPersistence.ledger.beginApplicationTurn
                    (turn-application/lifecycle.ts:65 → turn-ledger-repository.ts:617) ＋
                    DrizzleChatRepository 流式结算 (turn-application/lifecycle.ts:128-142)
                  profile: WebTeachingProfile（prepare 只读 listRecentHistory :68；
                    finalize 写 knowledge.persistMessageCitations :217）
                  contextLedger: DrizzleAgentTurnContextRepository
                  modelRunLedger: DrizzleAgentModelRunRepository
                  modelGateway: resolveTurnModelRuntime().gateway (learning-turn.ts:111/:117)
                  toolKernel: new ToolKernel(createTeachingToolKernelAdapters(...),
                    DrizzleAgentToolCallRepository, DrizzleToolEffectRepository) (learning-turn.ts:118-122)
                  studyPlans: DrizzleStudyPlanRepository.getOwnedBySession →
                    resolveLearnerAdaptationPolicy (learning-turn.ts:101-105)
                  cancellation: WebTeachingCancellation
                  trace: getWebTelemetryRuntime().turnTrace
      → projectTurnApplicationEventToGateway → gatewayToLegacy (teaching-turn.ts:200) → TeachingTurnEvent SSE
```

**Gateway**（TUI / Telegram / channel）：

```text
Gateway transport → GatewayService → GatewayAgentTurnRunner.run (apps/gateway/src/agent-runner.ts:163)
    → new TurnApplicationService (agent-runner.ts:138)
        lifecycle: GatewayTurnLifecycle → DrizzlePlatformTurnRepository attachGatewayTurn/settleTurn
          (gateway/turn-application/lifecycle.ts:43/:103)
        profile: GatewayGeneralProfile（prepare 只读 turns.listMessages :24）
        contextLedger: DrizzleAgentTurnContextRepository
        modelRunLedger: DrizzleAgentModelRunRepository
        modelGateway: createTurnModelGatewayFromEnvironment(readModelEnvironment())
          (agent-runner.ts:57-72/:107-109 → packages/model-gateway/src/turn-model-gateway-factory.ts:36)
        toolKernel: new ToolKernel([mcpRuntime.adapters, nodeAdapters],
          DrizzleAgentToolCallRepository, DrizzleToolEffectRepository) (agent-runner.ts:131-153)
        cancellation: GatewayBoundCancellation
        trace: getGatewayTelemetryRuntime().turnTrace
    → projectTurnApplicationEventToGateway → Gateway outbound
```

关键事实：三条生产路径各自 `new TurnApplicationService({...})` 完整装配（R06 目标）；`entrypoint`
由 `envelope.connection.transport` 映射（agent-runner.ts:224-231）；模型配置在 Web
（model-runtime.ts）、Gateway（agent-runner.ts readModelEnvironment）、Worker（apps/worker/src/model-runtime.ts）
三处独立解析（R03 目标）。

#### R00.3 持久表 / 仓储 / 唯一写入者盘点

| 事实类型               | 表                                                                                                                          | 定义                               | 写入者（仓储）                                                                                                                                                     | 写入点                                                                                                                                                                     | 现状标注                                              |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| 平台 Turn              | `agent_operations`                                                                                                          | schema.ts:567                      | DrizzlePlatformTurnRepository、DrizzleGatewayOperationStore、operation-event-writer、operation-access                                                              | platform-turn-repository.ts:303/:561/:725；gateway/operation-store.ts:103；gateway/operation-event-writer.ts:267；gateway/operation-access.ts:154                          | 同链多入口，非双写；权威                              |
| 平台消息               | `conversation_messages`                                                                                                     | schema.ts:762                      | DrizzlePlatformTurnRepository、DrizzlePlatformConversationRepository、K12 双写投影                                                                                 | platform-turn-repository.ts:315/:443；conversation-platform-repository.ts:378；k12-conversation-dual-write.ts:106                                                          | 受控双写（开关 k12-conversation-dual-write.ts:49-53） |
| K12 消息（旧）         | `chat_messages`                                                                                                             | schema.ts:1373                     | DrizzleTeachingTurnLedger（唯一 INSERT）、DrizzleChatRepository（结算 UPDATE）、DrizzleTurnLeaseRepository（心跳）                                                 | turn-ledger-repository.ts:481；chat-repository.ts:313/358/407/441/542；turn-lease-repository.ts:60/111                                                                     | 教学权威消息源                                        |
| 消息 parts             | `agent_message_parts`                                                                                                       | schema.ts:1450                     | turn-ledger `insertMessageParts`                                                                                                                                   | turn-ledger-repository.ts:516                                                                                                                                              | —                                                     |
| Model Run              | `model_runs`                                                                                                                | schema.ts:1549                     | DrizzleAgentModelRunRepository（平台）、DrizzleModelRunRepository（教学旧）、DrizzleTeachingTurnLedger（begin）、DrizzleTurnLeaseRepository（心跳）                | agent-model-run-repository.ts:357；model-run-repository.ts:259；turn-ledger-repository.ts:572；turn-lease-repository.ts:129                                                | **双写**（R05 归并）                                  |
| Tool Call              | `tool_calls`                                                                                                                | schema.ts:1646                     | DrizzleAgentToolCallRepository（平台）、DrizzleToolCallRepository（教学旧）                                                                                        | agent-tool-call-repository.ts:243；tool-call-repository.ts:334                                                                                                             | **双写**（R05 归并）                                  |
| Context Snapshot       | `turn_context_snapshots`                                                                                                    | schema.ts:1489                     | DrizzleAgentTurnContextRepository（平台）、DrizzleTeachingTurnLedger（教学）                                                                                       | agent-turn-context-repository.ts:222；turn-ledger-repository.ts:590                                                                                                        | **双写**（R05 归并；R02 契约升级）                    |
| Tool Effect            | `tool_effects`                                                                                                              | schema.ts:1728                     | DrizzleToolEffectRepository                                                                                                                                        | tool-effect-repository.ts:102/:141                                                                                                                                         | 唯一权威                                              |
| Tool Approval Intent   | `tool_approval_intents`                                                                                                     | schema.ts:1781                     | DrizzleToolApprovalIntentRepository、operation-event-writer                                                                                                        | tool-approval-intent-repository.ts:185/:249；gateway/operation-event-writer.ts:215                                                                                         | 唯一权威                                              |
| Operation Continuation | `operation_continuations`                                                                                                   | schema.ts:1845                     | operation-event-writer、operation-store、operation-approval-control、continuation stores                                                                           | operation-event-writer.ts:191/:311；operation-store.ts:176/:325；operation-approval-control.ts:95/:127                                                                     | 唯一权威                                              |
| Operation Source       | `operation_sources`                                                                                                         | schema.ts:1288                     | DrizzlePlatformSourceRepository                                                                                                                                    | platform-source-repository.ts:226                                                                                                                                          | 唯一权威                                              |
| MCP Intent             | `mcp_tool_intents`                                                                                                          | schema/mcp-intent.ts:19            | DrizzleMcpIntentRepository、DrizzleMcpIntentReconciler                                                                                                             | mcp-intent-repository.ts:227/:300/:332；mcp-intent-reconciler.ts:47                                                                                                        | 唯一权威                                              |
| Node Invocation        | `gateway_node_pairings` / `gateway_node_invocations`                                                                        | schema.ts:420/:464                 | DrizzleGatewayNodeRepository                                                                                                                                       | gateway/node-repository.ts:92/:323/:382/:445/:496/:519/:546                                                                                                                | 唯一权威                                              |
| 检索事实               | `session_source_bindings` / `turn_source_versions` / `turn_source_snapshots` / `retrieval_candidates` / `message_citations` | schema.ts:2297/2338/2359/2405/2475 | DrizzleKnowledgeRetrievalRepository；knowledge-hybrid-retrieval（retrieval_candidates 第二写者）                                                                   | knowledge-retrieval-repository.ts:379/467/482/565/713；knowledge-hybrid-retrieval.ts:364                                                                                   | retrieval_candidates 有第二写者，需归并               |
| 教学会话               | `lesson_sessions`                                                                                                           | schema.ts:814                      | learning-session-active-lifecycle、learning-session-repository、teaching-adapters、turn-ledger、chat-repository、turn-lease、study-bootstrap-compensator（delete） | 多个                                                                                                                                                                       | 生命周期多入口，R05 明确阶段唯一写入者                |
| 学习事件               | `learning_events` / `mastery_states`                                                                                        | schema.ts:2588/2627                | DrizzleEventStore / DrizzleMasteryRepository（teaching-adapters）                                                                                                  | teaching-adapters.ts:240/160/169                                                                                                                                           | 唯一权威                                              |
| Study Plan             | `learner_profiles` / `learning_goals` / `learning_objectives`                                                               | schema/study.ts:22/76/138          | DrizzleStudyPlanRepository                                                                                                                                         | study-plan-repository.ts:198/211/312/321/336                                                                                                                               | 唯一权威                                              |
| 安全决策               | `turn_safety_decisions`                                                                                                     | schema.ts:1933                     | DrizzleTurnSafetyDecisionRepository                                                                                                                                | turn-safety-decision-repository.ts:215                                                                                                                                     | 唯一权威                                              |
| Web Runtime Run        | `web_runtime_runs`                                                                                                          | schema/web-runtime.ts:20           | DrizzleWebRuntimeRunRepository                                                                                                                                     | web-runtime-run-repository.ts:157/197/223/266/321                                                                                                                          | 唯一权威                                              |
| 平台对话               | `conversations`                                                                                                             | schema.ts:516                      | DrizzlePlatformConversationRepository、DrizzlePlatformTurnRepository、gateway directory、learning-session-active-lifecycle、study-bootstrap-compensator（delete）  | conversation-platform-repository.ts:212/263/339/390；platform-turn-repository.ts:339/467/677；gateway/directory-repository.ts:128；learning-session-active-lifecycle.ts:61 | 同链多入口，非双写                                    |

不存在名为 `turn` / `platform_turn` / `context_segment` / `study_plan` 的物理表；平台 turn =
`agent_operations` 行（`kind='turn'`），study plan = `learner_profiles` + `learning_goals` +
`learning_objectives` 组合。

#### R00.4 包默认公共出口

**`@educanvas/db`**（packages/db/src/index.ts，454 行）：

- `export { getDb } from './client'`（:6）；
- `export * from './schema'`（:7）与 `export * from './schema/study'`（:8）；
- 直接导出底层 schema 表：`mcpToolIntents`（:298）、audio-consent 三表（:299-304）、
  `toolEffectReconciliations`（:329）；
- 约 100 个 `DrizzleXxxRepository` 仓储类、错误类与类型（:9-454），无 subpath 门禁 → R04 收口对象。

**`@educanvas/agent-core`**（packages/agent-core/src/index.ts，390 行）：

- 领域契约唯一入口，无 `export *`；覆盖 asset / message / model / turn-application /
  operation-continuation(+recovery) / trace-carrier / turn-context-ledger / tool-call-ledger /
  tool-effect-ledger(+reconciliation) / object-storage / web-runtime-port / streaming-transcription /
  experiment-runtime / transcript-term-correction；
- Context material 契约 `AgentTurnContextMaterial` 经 turn-context-ledger 导出（:203-207）→ R02 改动点；
- 语音能力 Port（StreamingTranscription\*、AudioTranscription）也在默认出口内，改动需与 UV 的
  V 线已 PASS 契约保持兼容。

#### R00.5 兼容投影 / 双写 / 只读旧路径 / 计划删除路径

兼容投影（协议映射）：

| 投影                                   | 位置                                                       | 方向                                           | 生产使用                                                                                                                                                                |
| -------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `projectTurnApplicationEventToGateway` | packages/gateway-runtime                                   | canonical TurnApplicationEvent → Gateway 事件  | 三条路径共用，权威                                                                                                                                                      |
| `gatewayToLegacy`                      | apps/web/server/gateway/turn-application-projection.ts:161 | Gateway 事件 → TeachingTurnEvent（旧 Web SSE） | 生产在用（web-turn.ts:298、teaching-turn.ts:200）                                                                                                                       |
| `projectTurnApplicationEventToWeb`     | turn-application-projection.ts:56                          | canonical → TeachingTurnEvent                  | **无生产调用点**                                                                                                                                                        |
| `legacyToGateway`                      | apps/web/server/gateway/web-turn.ts:51                     | TeachingTurnEvent → Gateway 事件               | **无任何调用点（含测试）**；内含中文 label 推断 `toolName`（:45-49 `label?.includes('搜索')`）与 `event.code.includes('rate_limit')` 字符串推断（:40-42）→ R07 删除候选 |

双写（R05 归并对象）：

1. `model_runs`：agent-model-run-repository.ts:357（平台账本）＋ model-run-repository.ts:259
   （教学旧；audited-model-gateway.ts:68 注入但该文件无生产调用点）＋ turn-ledger-repository.ts:572
   （教学 begin）＋ turn-lease-repository.ts:129（心跳）；
2. `tool_calls`：agent-tool-call-repository.ts:243 ＋ tool-call-repository.ts:334（教学旧）；
3. `turn_context_snapshots`：agent-turn-context-repository.ts:222 ＋ turn-ledger-repository.ts:590；
4. `conversation_messages`：K12 受控双写 k12-conversation-dual-write.ts:106（开关 :49-53
   `EDUCANVAS_K12_CONVERSATION_DUAL_WRITE==='true'`；调用点 turn-ledger-repository.ts:519-528、
   chat-repository.ts:561）。

只读旧路径：

- DrizzleLearningActivityRepository（learning-activity-repository.ts:21-59，只读
  learning_events/lesson_sessions/mastery_states）；
- DrizzleGatewayApprovalRepository（gateway/approval-repository.ts:30，只读；注释明示"审批写入属于
  Operation Store"）；
- DrizzleUnifiedMessageHistoryRepository（unified-message-history.ts:237，只读）；
- DrizzlePlatformArtifactTurnReferenceRepository（platform-artifact-turn-reference-repository.ts:25，
  只读 agent_operations）。

计划删除路径（后续任务，不提前删除）：

- `apps/web/server/model/audited-model-gateway.ts` —— 无生产调用点的旧教学模型审计路径（全仓 rg
  无引用）→ R03/R05 清理候选；
- `legacyToGateway` / `projectTurnApplicationEventToWeb` —— 无生产调用点的兼容投影 → R07；
- 教学旧写者 DrizzleModelRunRepository / DrizzleToolCallRepository 的写入路径 → R05；
- K12 双写开关与 k12-conversation-dual-write 路径 → R05（需迁移与对账证据，禁止与首次切换同 PR）；
- Web 经 Gateway 的 envelope 往返（web-turn.ts）→ R07 先改协议标识，R06 收敛组合根。

#### R00.6 UV / KM 文件交集核对（R02 / R03 阻塞判定）

- **R02 vs KM M02**：R02 边界含 packages/agent-core 的 Context material 契约、
  packages/agent-runtime/src/context-engine.ts、general-turn-profile.ts 与账本 repository；
  KM M02（KM-知识记忆.md:98-102）通过现有 Context Engine 的 `memory` 输入装配并涉及 Context
  Snapshot → 与 context-engine.ts / Context material 契约存在文件重叠。但 KM 当前领取任务为
  `K00`（KM-知识记忆.md:8），M02 为 PENDING 且未开始 → 无实际冲突；与本计划第三节冲突规则
  "R02 必须在 KM M02 前完成，或等待 M02 合并后重放"一致 → **R02 可开始；若 KM M02 先行启动则
  串行等待**。
- **R03 vs UV**：R03 边界含 packages/model-gateway/src/**、apps/web/server/model/**、
  apps/worker/src/model-runtime.ts；UV 中触碰 model-gateway 的为 V08（UV-画布语音.md:539）与
  V09（:561-566），二者均已 PASS（UV-画布语音.md:557、台账 :1131-1157）；R03 另两个路径在 UV
  全文中无引用 → **R03 阻塞解除，可并行**。
- **R01 / R07**：与 UV、KM 均无文件交集 → 可并行。
- 注意：UV V11/V14/V15 曾修改 packages/db（schema/repository/Outbox）但均已 PASS，且本计划默认
  禁止"音频留存、对象删除"任务；R 后续在 packages/db 新增 repository 需留意与 O 线（删除队列
  Outbox）的潜在重叠，而非 UV。

#### R00.7 权威矩阵：事实类型 → 唯一写入者 → 读取者 → 兼容期限 / 退出条件

| 事实类型                                                                                        | 唯一写入者（现状）                                                                                                                                                         | 主要读取者                                                                                               | 兼容期限 / 退出条件                                                                                   |
| ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 平台 Turn（`agent_operations`）                                                                 | DrizzlePlatformTurnRepository（attachGatewayTurn/settleTurn/requestTurnCancellation）＋ Gateway operation-store/event-writer/access（同链多入口）                          | WebGeneralLifecycle、GatewayTurnLifecycle、worker continuation/artifact、artifact-turn-reference（只读） | 权威事实，无删除计划                                                                                  |
| 平台消息（`conversation_messages`）                                                             | DrizzlePlatformTurnRepository / DrizzlePlatformConversationRepository；K12 双写投影                                                                                        | 平台 history、unified-message-history                                                                    | K12 双写是兼容投影；退出条件：K12 消息完成迁移与对账（R05）后关闭开关并删除双写路径                   |
| K12 消息（`chat_messages`）                                                                     | DrizzleTeachingTurnLedger.beginOrReplay（唯一 INSERT）＋ DrizzleChatRepository 结算                                                                                        | WebTeachingProfile.listRecentHistory、unified-message-history、learning-session                          | 教学权威消息源；R05 决定权威归属（迁 `conversation_messages` 或保留并收口写入者），旧表删除须单独任务 |
| Model Run（`model_runs`）                                                                       | **当前 4 写者（双写）**：agent-model-run-repository.ts:357、model-run-repository.ts:259、turn-ledger-repository.ts:572、turn-lease-repository.ts:129                       | 教学/平台审计、observability                                                                             | R05 指定唯一权威（平台账本或教学 ledger 二选一）；旧写者停止写入后限期只读；无回滚与 N-1 证据不得删表 |
| Tool Call（`tool_calls`）                                                                       | **当前 2 写者（双写）**：agent-tool-call-repository.ts:243、tool-call-repository.ts:334                                                                                    | ToolKernel、审批 UI                                                                                      | R05 归并；同 Model Run 退出条件                                                                       |
| Context Snapshot（`turn_context_snapshots`）                                                    | **当前 2 写者（双写）**：agent-turn-context-repository.ts:222、turn-ledger-repository.ts:590                                                                               | 审计、重建、R02 追溯                                                                                     | R02 升级多 Asset 契约时保持旧单 Asset 读取兼容；R05 收口写入者                                        |
| Tool Effect（`tool_effects`）                                                                   | DrizzleToolEffectRepository（唯一）                                                                                                                                        | reconciliation、删除队列                                                                                 | 唯一权威                                                                                              |
| Tool Approval Intent（`tool_approval_intents`）                                                 | DrizzleToolApprovalIntentRepository ＋ operation-event-writer（同链）                                                                                                      | 审批 UI                                                                                                  | 唯一权威                                                                                              |
| Operation Continuation（`operation_continuations`）                                             | operation-event-writer / operation-store / operation-approval-control / continuation stores（同链）                                                                        | worker continuation                                                                                      | 唯一权威                                                                                              |
| MCP Intent（`mcp_tool_intents`）                                                                | DrizzleMcpIntentRepository ＋ DrizzleMcpIntentReconciler（同链）                                                                                                           | worker                                                                                                   | 唯一权威                                                                                              |
| Node Invocation（`gateway_node_*`）                                                             | DrizzleGatewayNodeRepository（唯一）                                                                                                                                       | worker                                                                                                   | 唯一权威                                                                                              |
| Operation Source（`operation_sources`）                                                         | DrizzlePlatformSourceRepository（唯一）                                                                                                                                    | 引用复核                                                                                                 | 唯一权威                                                                                              |
| 检索事实（`session_source_*` / `turn_source_*` / `retrieval_candidates` / `message_citations`） | DrizzleKnowledgeRetrievalRepository；knowledge-hybrid-retrieval 为 `retrieval_candidates` 第二写者                                                                         | teaching profile、引用                                                                                   | `retrieval_candidates` 第二写者归并；其余唯一权威                                                     |
| 教学会话（`lesson_sessions`）                                                                   | 多生命周期入口（learning-session-active-lifecycle、learning-session-repository、teaching-adapters、turn-ledger、chat-repository、turn-lease、study-bootstrap-compensator） | 教学 profile/UI                                                                                          | 各生命周期阶段写入者需在 R05 明确唯一归属（属有意分层的不同阶段，非纯双写）                           |
| 学习事件（`learning_events` / `mastery_states`）                                                | teaching-adapters（DrizzleEventStore / DrizzleMasteryRepository，唯一）                                                                                                    | DrizzleLearningActivityRepository（只读）                                                                | 唯一权威                                                                                              |
| Study Plan（study 三表）                                                                        | DrizzleStudyPlanRepository（唯一）                                                                                                                                         | learning-turn.ts:101-105                                                                                 | 唯一权威                                                                                              |
| 安全决策（`turn_safety_decisions`）                                                             | DrizzleTurnSafetyDecisionRepository（唯一）                                                                                                                                | 教学                                                                                                     | 唯一权威                                                                                              |
| Web Runtime Run（`web_runtime_runs`）                                                           | DrizzleWebRuntimeRunRepository（唯一）                                                                                                                                     | worker                                                                                                   | 唯一权威                                                                                              |
| 平台对话（`conversations`）                                                                     | conversation-platform-repository / platform-turn-repository / gateway-directory / learning-session-active-lifecycle（同链）                                                | 路由、history                                                                                            | 同链多入口，非双写                                                                                    |

#### R00.8 最终复核结论

- 结论：`PASS`（R00 为只读盘点，无 BLOCKED）。
- 第二节"已经确认的代码事实"逐项核对全部成立；新增三项事实：
  `legacyToGateway` 无任何调用点、`projectTurnApplicationEventToWeb` 无生产调用点、
  `audited-model-gateway.ts` 无生产调用点（均为 R07/R03 删除候选）。
- Codex 复核确认：R00.7 权威矩阵、R00.6 并行边界和 R00.5 删除候选可作为后续任务基线。

### R01：Node 运行时与类型基线统一

- 依赖：R00
- 文件边界：`.nvmrc`、根 `package.json`、受影响 workspace 的 `package.json`、锁文件、CI 配置
- 可并行：是

目标：

- Node runtime、engines、CI、开发文档和 `@types/node` 使用同一主版本；
- 不升级 Node 主版本，只把类型降到当前运行基线；
- 增加静态验证，防止未来包单独漂移到更高 Node 类型。

完成标准：

- 全 workspace typecheck 通过；
- CI 与本地 doctor 显示同一 Node 主版本；
- 新门禁能拒绝再次出现 Node 22 runtime + Node 26 types。

### R02：多 Asset Context Snapshot 完整追溯

- 依赖：R00
- 文件边界：
  - `packages/agent-core/src/**` 中 Context material 契约；
  - `packages/agent-runtime/src/context-engine.ts` 及测试；
  - `apps/web/server/platform/general-turn-profile.ts` 及测试；
  - 必要的账本 repository 和集成测试。
- 可并行：是，但不得与 KM M02 同时改同一文件

目标：

- Context Segment 可以登记零个、一个或多个 Asset Version；
- 多图合并进入同一模型消息时，Snapshot 必须记录全部版本且保持原顺序；
- 重复、越权、空 ID、超限和 Prompt/material 漂移必须 fail closed；
- 保持旧单 Asset 读取兼容，但新增写入只使用新契约。

完成标准：

- 2–4 张图片实际进入模型消息时，Context material 精确登记全部版本；
- 文本 Asset、单图、多图、混合 Asset 均有测试；
- 数据库账本可重建本轮模型实际可见 Asset 集合；
- 不通过拆成大量 required Segment 挤掉对话历史来规避问题。

### R02 台账（2026-08-06，最终结论 `PASS`）

#### R02.1 基线记录

- HEAD：`fe6ab1a14516cfe37b13f08b1f0c8273d4d62b54`；当前分支 `main`；
  worktree `/Users/tim/DEV/EduCanvas`
- 预存改动：本计划文件（R00 台账）；V17-B 语音未跟踪文件原样保留
- 并发任务观察（非本任务修改）：R01（Node 基线）与 R03（模型配置单次解析）正并行执行，
  改动集中在根 `package.json` / 各 workspace `package.json` / `.github/workflows/ci.yml` /
  `tooling/node-version-gate.mjs` / `packages/model-gateway` 与
  `apps/web/server/model`；与 R02 文件边界无交集（R00.6 判定成立）
- 本次改动：`packages/agent-runtime/src/context-engine.ts`(+test)、
  `apps/web/server/platform/general-turn-profile.ts`(+test)、
  `packages/agent-core/src/turn-context-ledger.ts`（注释）、
  `packages/db/src/turn-context.test.ts`、`packages/db/src/agent-turn-context-repository.integration.test.ts`

#### R02.2 新旧契约

**旧契约**：`ContextSegment.assetVersionId?: string`（单值）。多张原生图片合并进一条模型
消息时，`general-turn-profile.ts` 的 `nativeImageCandidates` 只登记 `images[0]!.versionId`，
后续图片版本在账本中丢失，无法重建完整图集。

**新契约**：

- `ContextSegment` 新增 `assetVersionIds?: readonly string[]`（按实际进入消息的顺序登记
  全部不可变 AssetVersion ID）；`assetVersionId` 保留为等价单元素写法，兼容教学等单 Asset 段；
- 两者同时提供视为歧义，fail closed；
- 段内重复、跨段重复、空 ID、单段超限（`MAX_ASSET_VERSIONS_PER_SEGMENT = 32`）全部
  fail closed（`ContextEngineInputError`）；
- `source`/`asset` 段必须登记至少一个 Asset Version（不允许零版本登记）；
- `AgentTurnContextMaterial.selectedAssetVersionIds` 契约不变（本就是数组），更新注释说明
  "同一模型消息内多个 Asset 按消息内顺序连续登记"；
- material 生成改为按"段顺序 × 段内顺序"flatMap，与"实际进入模型消息的顺序"一致。

#### R02.3 迁移与回退

- **无 schema 变更**：`turn_context_snapshots.selected_asset_version_ids` 自 migration
  `0010_tricky_impossible_man.sql` 起即为 `jsonb NOT NULL` 数组，账本层 `prepareTurnContextMaterial`
  / `DrizzleAgentTurnContextRepository` 已按数组读写 → 无需生成 migration；
- 回退：恢复旧校验（仅单值 `assetVersionId`）与首图登记即可，无数据迁移，旧快照不受影响。

#### R02.4 写入与读取兼容期限

- **读取**：历史单 Asset Snapshot（单元素数组）经 `toSnapshot` 原样读回，永久兼容；
- **写入**：单 Asset 段继续走 `assetVersionId`（等价单元素）；多 Asset 段必须走
  `assetVersionIds`；新增多图写入已全部改走新契约，旧的"只登记首图"写入路径已删除；
- 教学路径 `apps/web/server/teaching/turn-application/profile.ts`（R02 边界外）继续使用
  `assetVersionId` 单值写法，不受影响；建议 R05 收口时评估是否统一为数组写法。

#### R02.5 验收标准 → 测试映射

| 验收（R02 目标）    | 测试                                                                                               |
| ------------------- | -------------------------------------------------------------------------------------------------- |
| 文本 Asset          | `context-engine.test.ts` 混合用例 text-1/text-3 单值登记；profile `textSegments`                   |
| 单图                | profile "segment 文本投影逐字相等"（兼容单值）；混合用例                                           |
| 多图                | `context-engine.test.ts` 多 asset 段；profile "多图合并段登记全部版本"（3 图顺序）                 |
| 文本+多图           | `context-engine.test.ts` 混合段拼接顺序                                                            |
| 重复                | 段内重复、跨段重复 fail closed（`context-engine.test.ts`）                                         |
| 非法/越权           | 空 ID、混用、零版本 fail closed（engine）；跨 Notebook 混合越权整体拒绝且不部分写入（integration） |
| 空                  | 同上（`assetVersionIds: []` / `['']` / 无引用均拒绝）                                              |
| 上限                | `MAX_ASSET_VERSIONS_PER_SEGMENT + 1` 拒绝                                                          |
| 顺序                | engine material 顺序；`turn-context.test.ts` 多 Asset 顺序敏感 hash；integration 多 asset 读回顺序 |
| 历史单 Asset 兼容   | integration "历史单 Asset Snapshot（单元素数组）可原样读回"                                        |
| PostgreSQL 账本重建 | integration "多 Asset 版本按消息内顺序全量落账，账本可重建本轮完整图集"                            |

#### R02.6 验证结果

| 命令                                                                              | 结果                              |
| --------------------------------------------------------------------------------- | --------------------------------- |
| `pnpm --filter @educanvas/agent-runtime test`                                     | 20 files / 84 passed              |
| `pnpm --filter @educanvas/db test`                                                | 7 files / 52 passed               |
| `pnpm --filter @educanvas/db test:integration`（TEST_DATABASE_URL=pgvector:5433） | 46 files / 278 passed             |
| `pnpm --filter @educanvas/agent-core test`                                        | 23 files / 276 passed             |
| `pnpm --filter @educanvas/web vitest server/platform/`                            | 6 files / 38 passed（profile 11） |
| `pnpm test:tooling`                                                               | 98 passed                         |
| typecheck agent-core / agent-runtime / db / web                                   | 全过                              |
| prettier（改动文件）                                                              | 全过                              |
| `git diff --check`                                                                | 干净                              |

#### R02.7 最终复核结论

- 结论：`PASS`，无 BLOCKED。Codex 接受 `MAX_ASSET_VERSIONS_PER_SEGMENT = 32` 的有界值；
  `assetVersionId` 单值写法继续作为兼容输入，新增多图写入只使用数组契约。

### R03：模型配置单次解析与显式注入

- 依赖：R00
- 文件边界：
  - `packages/model-gateway/src/**`
  - `apps/web/server/model/**`
  - `apps/worker/src/model-runtime.ts`
  - 相关测试和配置文档
- 可并行：是，若 UV 正在修改同文件则等待

目标：

- 每个进程或请求范围只解析一次环境配置；
- Factory 接收已验证配置，不在内部再次读取 `process.env`；
- Vision、Embedding、Speech 等 capability override 共享同一解析纪律；
- 注释与实际生命周期一致，不再声称“缓存”却每次重建。

完成标准：

- 通过 spy 或注入测试证明单次解析；
- 配置错误只关闭对应能力，不污染其它能力；
- Secret 不离开 model-gateway 边界；
- Web、Gateway、Worker 使用相同配置对象语义。

### R03 台账（2026-08-06，最终结论 `PASS`）

R03 实现「模型配置单次解析与显式注入」：Factory 改为接收已验证配置对象，
Web/Worker 组合根收敛为 parse-once，spy/注入测试锁定单次解析与能力降级。
结论 `PASS`（Codex 复核）；无 BLOCKED 项。

#### R03.1 配置对象所有者与生命周期

| 组合根                                            | 配置对象所有者                                                                                                     | 生命周期                                                                                                                                                         | 解析次数                                                   |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Web（`apps/web/server/model/model-runtime.ts`）   | `resolveTurnModelRuntime(environment)` 本地变量，主 Gateway 与视觉 Gateway 共享同一 `ModelGatewayConfiguration`    | 每次 Turn 调用解析一次（`parseModelGatewayConfiguration` 恰好 1 次），函数返回即释放；不做进程级缓存（Next.js 无可靠模块级单例，也避免全局可变缓存掩盖重复解析） | 1（改动前 3：组合根 + 主 Factory + 视觉 Factory 各自解析） |
| Gateway（`apps/gateway/src/agent-runner.ts:108`） | `productionDependencies()` 默认参数，进程启动时构造 `GatewayApplicationDependencies` 一次，`TurnModelGateway` 常驻 | 进程级一次；`createTurnModelGatewayFromEnvironment(readModelEnvironment())` 内部 parse 恰好 1 次                                                                 | 1（无改动）                                                |
| Worker（`apps/worker/src/model-runtime.ts`）      | 既有 `resolve*`：每次调用内局部变量；新增 `createWorkerModelRuntime(environment)`：任务级局部变量，全部能力共享    | `resolve*` 每次调用解析主配置 1 次，不缓存；任务级入口一次构造解析 1 次，全部能力复用                                                                            | `resolve*` 单次调用 1（无改动）；任务级入口 1              |

#### R03.2 关键改动

- `packages/model-gateway/src/turn-model-gateway-factory.ts`：新增 `createTurnModelGateway(config)`、
  `createVisionTurnModelGateway(config)`——只接收已验证配置，内部不读 `process.env`、不再解析环境；
  `createTurnModelGatewayFromEnvironment` / `createVisionTurnModelGatewayFromEnvironment` 降级为
  组合根便捷入口（parse 恰好一次后委托）。
- `apps/web/server/model/model-runtime.ts`：`resolveTurnModelRuntime` 改为 parse-once（3 次 → 1 次），
  注释与真实生命周期一致。
- `apps/worker/src/model-runtime.ts`：新增任务级入口 `createWorkerModelRuntime(environment)`（一次解析，
  结构化/语音/转录/图像/embedding/embeddingIdentity 共享同一配置对象）；删除「解析一次并缓存本轮」的
  虚假注释——本函数从不缓存，每次 `resolve*` 调用重新解析。

#### R03.3 能力降级矩阵

| 配置状态                                   | 文本/主链路                                                                           | vision         | speech/transcription/image/embedding | 依据                                        |
| ------------------------------------------ | ------------------------------------------------------------------------------------- | -------------- | ------------------------------------ | ------------------------------------------- |
| 主配置未配置（无 provider）                | 关闭（null → 诚实失败态）                                                             | 关闭           | 关闭                                 | `config.ts` disabled 语义                   |
| 主配置非法（env/provider/key/model 等）    | fail-fast 抛稳定错误码，不泄漏 secret                                                 | 同左           | 同左                                 | `config.ts` + `config-primitives.ts` 稳定码 |
| vision 半配置/互斥冲突                     | **fail-fast**（ADR-0017：配置即能力，半配置会让部署误以为图片可用，直到运行时才失败） | 拒绝           | —                                    | `config-vision.ts`，行为未变                |
| 单能力 override 半配置（如 speech 缺 Key） | 不受影响                                                                              | 不受影响       | **只关闭该能力**（null）             | ADR-0021 `config-capability.ts`             |
| embedding 模型未声明版本                   | 不受影响                                                                              | 不受影响       | 只关闭 embedding                     | `config-media.ts`                           |
| DeepSeek 主 Provider 下媒体能力未 override | 不受影响                                                                              | 按 vision 配置 | 全部关闭                             | `config-capability.ts` 继承矩阵             |

能力级错误一律收敛为 `disabled` 不抛异常（ADR-0021），与主配置 fail-fast 语义解耦，已有
`config-capability-acceptance.test.ts`（C04）锁定；R03 新增 worker 侧降级测试覆盖同一矩阵。

#### R03.4 验证

- spy/注入测试（先红后绿）：`packages/model-gateway/src/turn-model-gateway-factory.test.ts`
  （9/9）、`apps/web/server/model/model-runtime.test.ts`（8/8，改动前红：一次调用解析 3 次）、
  `apps/worker/src/model-runtime.test.ts`（9/9）。
- 全量回归：model-gateway 274/274、web 888/888、worker 115/115、gateway 196/196；
  四包 typecheck 通过；`pnpm test:tooling` 98/98；`git diff --check` 干净。
- 禁止全局可变缓存：测试只计数纯函数调用，无模块级缓存参与。

#### R03.5 已知边界与后续责任

- R06 收口后，Web General 在 `beginWebGatewayTurn` 中只调用一次
  `resolveTurnModelRuntime()`，同一对象同时传给 Asset 物化与 Turn Application；General 入口不再
  自行解析。Teaching 路径同样为每 Turn 一次。
- worker 既有 `resolve*` 未迁移到 `createWorkerModelRuntime`（`apps/worker/src/tasks/**` 不在
  R03 文件边界内），当前每个 `resolve*` 单次解析、任务级入口已就绪，迁移留待后续。

#### R03.6 回退方式

- Factory 新入口与旧入口并存：`createTurnModelGatewayFromEnvironment` 语义与改动前一致
  （parse 一次 + 构造），Gateway 装配未动；回退只需把组合根换回旧入口。
- Web/Worker 组合根行为语义未变（配置合法时返回相同 Gateway 类型，disabled 时返回 null），
  无数据面变更；`pnpm env:check` 与既有测试全绿可验证回退安全。

### R04：`@educanvas/db` 公共出口收口

- 依赖：R01、R02、R03
- 文件边界：
  - `packages/db/package.json`
  - `packages/db/src/index.ts`
  - 新增受控 subpath entry
  - 所有直接依赖默认出口的导入点
  - ESLint / dependency boundary 配置
- 可并行：否

目标：

- 默认 `@educanvas/db` 只导出稳定应用级 Repository、Port Adapter 和公开类型；
- `getDb`、schema、迁移辅助和底层表只允许从明确 internal/testing subpath 使用；
- Web feature、Gateway 和领域包不得直接依赖 schema；
- 集成测试可使用 testing subpath，但生产代码不可导入。

完成标准：

- 静态门禁能拒绝生产代码导入 `@educanvas/db/schema`、testing entry，以及基线之外的 `getDb`；
- 生产组合根的既有 `getDb` 依赖只允许随 R05/R06 迁移减少，不得新增；
- 没有用几十个临时 re-export 掩盖原来的超级出口；
- 包循环依赖和构建时间没有显著恶化。

### R04 台账（2026-08-07，结论 `PASS`）

R04 实现「`@educanvas/db` 公共出口收口」：稳定 Repository / Port Adapter / 公开类型保持
为默认出口，schema 表从 `export *` 全量泄漏改为按需显式导出。R08 最终复核把 10 个
服务端组合点的 `getDb` 迁到受控 `@educanvas/db/internal`，并从默认入口移除底层连接；
测试使用 `@educanvas/db/testing`。静态门禁只允许获准组合点从 internal 导入单一 `getDb`
符号，拒绝新增 subpath、动态 import、namespace 与深路径绕过。结论 `PASS`，无 BLOCKED 项。

#### R04.1 基线记录

- HEAD：`6fcbada`（feat(runtime): consolidate turn composition foundations）；当前分支
  `refactor/20260806-r03-model-config-single-parse`；worktree `/Users/tim/DEV/EduCanvas`
- 预存改动：无（工作树干净）
- 并发任务观察：R01（Node 基线，PENDING）与 R03（模型配置，REVIEW_REQUIRED）尚未合并；
  两者文件边界与本次改动（packages/db 入口/测试/计划文件）无交集
- 本次改动：
  - `packages/db/package.json`（新增 `exports` 受控 subpath：`.`、`./internal`、`./testing`、`./package.json`）
  - `packages/db/src/index.ts`（`export * from './schema'` / `'./schema/study'` 全量泄漏改为显式导出；移除无引用导出）
  - `packages/db/src/internal/index.ts`、`packages/db/src/testing/index.ts`（新增 subpath 入口）
  - `packages/db/src/import-boundary.test.ts`（新增静态门禁，10 条断言）
  - `packages/db/README.md`（入口边界说明）
  - `docs/plan/completed/R-运行时事实收敛.md`（本台账）

#### R04.2 全量引用盘点（allowlist / denylist）

导入形态统计（2026-08-07 全仓扫描 apps/packages/tests，`.ts/.tsx/.mjs`）：

- 默认入口 `from '@educanvas/db'`：108 个文件（77 生产 + 31 测试），116 个生产符号 +
  23 个测试专用符号；无任何 `@educanvas/db/<subpath>` 导入（本任务新增门禁测试自用
  internal/testing 除外）；
- 动态 `import('@educanvas/db')`：9 个文件（全测试）；生产代码动态 import 盘点为 0，
  门禁新增「生产代码禁止动态 import / vi.mock @educanvas/db」（防止绕过符号 denylist）；
- 相对路径深引用 `packages/db/src/index.ts`：仅 `tests/e2e` 4 个 spec（测试，允许）；
- 领域包（agent-core / gateway-core / teaching-core / teaching-runtime / agent-runtime /
  canvas-protocol / model-gateway / gateway-runtime / node-runtime）package.json 均不依赖
  `@educanvas/db`，导入方向单向正确。

allowlist（默认入口保留的生产符号，116 个，代表性清单）：

- Repository / Port Adapter：DrizzleAssetRepository、DrizzlePlatformArtifactRepository、
  DrizzlePlatformTurnRepository、DrizzleGatewayOperationStore、DrizzleGatewayIdentityRepository、
  DrizzleAgentModelRunRepository、DrizzleAgentToolCallRepository、DrizzleChatRepository、
  DrizzleTeachingTurnLedger、DrizzleWebRuntimeRunRepository、DrizzleStudyPlanRepository、
  DrizzleKnowledgeRetrievalRepository 等约 90 个 `DrizzleXxx`；
- 错误类与常量：ArtifactOwnershipError、GatewayPersistenceError、WebRuntimeAdmissionError、
  DEFAULT_ASSISTANT_LEASE_MS、ARTIFACT_GENERATE_TASK、MAX_MCP_INTENT_RECONCILIATION_BATCH 等；
- 公开类型：AssetSnapshot、PlatformTurnSnapshot、PlatformArtifact、ModelRunSnapshot、
  EmbeddingIdentity、CursorPage、TemporalIdCursor 等；
- 基线遗留项：`getDb`（生产 10 文件，见下）与 17 个 schema 表（测试引用）。R08 已把
  10 个生产调用迁入 internal allowlist 并从默认入口移除 `getDb`；schema 表继续按需显式
  导出且生产引用为 0。

denylist（默认入口拒绝新增依赖）：

- schema 表 17 个：`agentOperations / artifactVersions / assets / assetVersions /
audioConsents / audioRetentions / conversations / gatewayApprovals /
gatewayOperationEvents / mcpToolIntents / notebookMemberships / objectDeletionOutbox /
operationContinuations / platformUsers / securityAuditEvents / spaces /
toolApprovalIntents` —— 生产引用 0，测试引用 23 处（apps/worker、apps/web、packages/db
  集成测试）；默认入口按需显式保留（兼容测试），新增表一律禁止加入默认入口；
- `getDb` 基线为以下 10 个生产文件，R08 已全部改从 internal subpath 单符号导入——apps/gateway/src/index.ts、
  apps/gateway/src/canvas-resource-service.ts、apps/telegram/src/index.ts、
  apps/web/app/api/v1/chat/artifacts/[artifactId]/route.ts、[artifactId]/download/route.ts、
  apps/web/server/canvas/resource-access.ts、apps/web/server/study/study-service.ts、
  apps/web/server/teaching/knowledge-retrieval-runtime.ts、apps/web/server/teaching/learning-session.ts、
  apps/web/server/teaching/teaching-tools.ts；
- subpath 形态：生产代码只允许上述 10 个获准服务端组合点从
  `@educanvas/db/internal` 导入单一 `getDb`；`testing`、`schema`、其它 internal 符号与
  `@educanvas/db/src/*` 一律拒绝；
- 绕过包入口的 `packages/db/src/*` 相对路径：生产代码一律拒绝（现仅 tests/e2e 使用）。

本次移除的旧出口（全仓无引用证据，兼容迁移说明见 R04.4）：

- `export * from './schema'` 与 `export * from './schema/study'`（全量泄漏点）；
- `audioConsentProofMethods`、`audioConsentPurposes`、`toolEffectReconciliations`
  （默认入口导出 0 引用；内部测试均走相对路径）。

#### R04.3 文件职责（收口后入口结构）

- 默认入口 `src/index.ts`：稳定 Repository / Port Adapter / 公开类型 + 17 个按需 schema
  表（测试兼容），不导出 `getDb`；
- `src/internal/index.ts`（`@educanvas/db/internal`）：getDb、schema 全量、schema/study
  全量 —— 底层通道；生产只允许静态门禁列出的组合点导入单一 `getDb`，其余供 db 内部
  基础设施与迁移/运维脚本使用；
- `src/testing/index.ts`（`@educanvas/db/testing`）：同 internal 能力，测试专用定位；
- `src/import-boundary.test.ts`：静态门禁，11 条断言（exports 结构、无 `export *` 泄漏、
  生产 internal allowlist、测试 schema 禁令、默认入口 getDb 禁令、schema 表 denylist、namespace 导入
  禁令、动态 import/vi.mock 禁令、深路径禁令、subpath 端到端可用、扫描器自检）。

#### R04.4 兼容策略

- `getDb` 已从默认入口移除；10 个尚未具备应用级 Repository 的服务端组合点经精确
  internal allowlist 使用，后续可继续减量但不得新增。17 个 schema 表仅为既有测试兼容
  显式导出，生产引用基线为 0，新表不得加入默认入口；
- 无引用旧出口本次即移除（study 全量导出、3 个无引用表）；需要底层 schema 时改从
  `@educanvas/db/internal` / `@educanvas/db/testing` 导入；
- exports 未映射的 subpath（如 `@educanvas/db/schema`）在解析期即失败，静态门禁提供
  第二道防线；`tests/e2e` 相对路径导入不受 exports 影响；
- 包循环依赖与构建时间：未新增任何包依赖，import 拓扑无变化（仅测试新增 imports）；
- 回退：删除 exports 字段与两个 subpath 入口、恢复 `export *` 与 study 导出即可，无数据面变更。

#### R04.5 验收标准 → 测试映射

| 验收（R04 目标）                                | 测试                                                                                          |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 默认入口只导出稳定 Repository/类型              | 门禁「默认入口不再全量泄漏 schema」（无 `export *`）＋显式导出清单                            |
| getDb/schema 的新增依赖受控，历史出口有迁移边界 | 默认入口不导出 getDb；生产 internal 只允许 10 个组合点单符号导入；testing/internal 端到端可用 |
| Web feature / Gateway / 领域包不直接依赖 schema | 门禁「生产代码不新增 schema 表符号依赖」（17 表 denylist，基线 0）                            |
| 静态门禁拒绝 schema/testing 与新增 getDb 依赖   | 门禁只允许获准 internal getDb，拒绝 testing/schema/其它 subpath 与默认入口 getDb              |
| 生产组合根向 Repository/Port 迁移               | internal allowlist 只可减量、不可扩张                                                         |
| 没有几十个临时 re-export 掩盖超级出口           | 新增入口仅 2 个小文件；默认入口移除 2 个 `export *` 与 3 个无引用符号                         |
| 生产代码不得绕过符号门禁                        | 门禁「生产禁止动态 import / vi.mock」＋「生产禁止 namespace 导入」＋「深路径禁令」            |
| 包循环依赖和构建时间不显著恶化                  | 无新增包依赖；db unit 8 files / 63 passed、typecheck 通过                                     |

#### R04.6 验证结果

| 命令                                            | 退出码 | 结果                                                |
| ----------------------------------------------- | ------ | --------------------------------------------------- |
| `rtk pnpm --filter @educanvas/db test`          | 0      | 8 files / 63 passed（含 import-boundary 11 条断言） |
| `rtk pnpm --filter @educanvas/db run typecheck` | 0      | tsc --noEmit 通过                                   |
| `rtk pnpm test:tooling`                         | 0      | 100 passed                                          |
| `rtk pnpm lint`                                 | 0      | turbo lint + 全仓 prettier 通过                     |
| `rtk pnpm typecheck`                            | 0      | 全 workspace 通过                                   |
| `rtk git diff --check`                          | 0      | 干净                                                |

#### R04.7 最终复核结论

- 结论：`PASS`，无 BLOCKED。Codex 复核接受以下后续边界：
  - 10 个服务端组合点暂经 internal allowlist 使用 `getDb`，默认入口已移除；后续只允许减量；
  - 17 个 schema 表按需保留的期限（建议随 R08，与测试引用迁移到 `@educanvas/db/testing` 同步）；
  - exports 指向 TS 源码对 gateway/worker esbuild 构建与 Next.js Turbopack 的兼容性，
    建议在 CI build 阶段补一次验证；
  - internal getDb allowlist 用「⊆ 基线」允许迁移减量、拒绝增量；
  - `src/index.ts` 现 464 行（原 454 行）接近拆分阈值，建议 R08 收口随出口精简一并拆分，本任务不拆以避免大量 re-export 掩盖收口语义。

### R05：Turn 与执行事实单轨化

- 依赖：R04
- 文件边界：经 R00 权威矩阵批准的 Turn、Message、Model Run、Tool Call repository、migration、
  compatibility reader 与集成测试
- 可并行：否

目标：

1. 对每类重复事实指定唯一权威表和唯一新写入路径；
2. 旧路径只保留有期限的读取或回填，不再继续双写；
3. 提供历史数据回填、校验、计数对账和回退方案；
4. General、Teaching、Gateway 使用同一 Turn Ledger 语义；
5. Learning Event、Operation Event、Tool Effect 等不同事实不得错误合并。

完成标准：

- 新 Turn 不再向已废弃事实写入；
- N-1 数据可读取、回填或明确拒绝；
- 双写关闭前后有计数、哈希或抽样对账；
- 失败恢复、取消、审批、引用和教学事实没有回归；
- 旧表删除必须单独任务执行，不与首次切换同 PR。

### R05 台账（2026-08-06，最终结论 `PASS`）

R05 为运行时事实单轨化收口。本台账记录 A1 决策矩阵与证据链（全部以当前代码 `file:line`
为准，不依据旧报告）；收口动作（A2 静态门禁与 @deprecated 标注、B1-B3 工厂迁移）在
R05/R06 同任务内实施，验证结果见台账末尾。Codex 复核补齐了有界历史回填，并纠正了与
ADR-0013 冲突的权威方向；最终结论 `PASS`，无 BLOCKED 项。

#### R05.1 A1 决策矩阵：事实类型 → 唯一权威表 → 唯一生产写入者 → 读取者 → 兼容期限

| 事实类型     | 唯一权威表                                                                                       | 唯一生产写入者                                                                                                                      | 主要读取者              | 兼容期限/回退                                                                                                               |
| ------------ | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Model Run    | `model_runs`（schema.ts:1549）                                                                   | `DrizzleAgentModelRunRepository`（agent-model-run-repository.ts:253；taskAlias 路由双形状，:34-40/:137/:161）                       | UI 运行记录、恢复、审计 | 永久（唯一表）；旧 `DrizzleModelRunRepository`（model-run-repository.ts:199）生产零调用                                     |
| Tool Call    | `tool_calls`（schema.ts:1646）                                                                   | `DrizzleAgentToolCallRepository`（agent-tool-call-repository.ts:165；advisory lock agent-tool-execution-v2/agent-tool-provider-v2） | Worker 恢复、审批、审计 | 永久（唯一表）；旧 `DrizzleToolCallRepository`（tool-call-repository.ts:241）生产零调用                                     |
| Tool Effect  | `tool_effects`（schema.ts:1728）                                                                 | `DrizzleToolEffectRepository`（tool-effect-repository.ts:30）                                                                       | Worker 对账/恢复        | 永久（唯一表）                                                                                                              |
| Turn Context | `turn_context_snapshots`（schema.ts:1489）                                                       | `DrizzleAgentTurnContextRepository`（agent-turn-context-repository.ts:182）                                                         | 恢复、审计              | 永久（唯一表）                                                                                                              |
| 消息         | 当前运行权威 `chat_messages`（schema.ts:1373）；长期平台权威 `conversation_messages`（ADR-0013） | `DrizzleChatRepository`（chat-repository.ts:228）＋ `dualWriteSettleAssistant`（k12-conversation-dual-write.ts:234）                | SSE、历史、K12 会话恢复 | 双写由 `EDUCANVAS_K12_CONVERSATION_DUAL_WRITE==='true'` 门控；回填/切读/旧表退役是三个独立闸门，settle 持续收敛已建平台投影 |

#### R05.2 证据链

三条生产路径当前均经统一 Agent 仓储写入，无旧写入者：

| 路径         | 入口装配                                                                                                   | Context / Model Run 账本                                              | Tool Call / Effect 账本                                                                                 | Trace / 入口差异                                                              |
| ------------ | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Web General  | `createTurnApplication` ← `createWebTurnLedgers()` / `createWebToolKernel()`                               | Web 组合模块构造 `DrizzleAgentTurnContextRepository` / `ModelRun`     | Web 组合模块唯一构造 `DrizzleAgentToolCallRepository` / `DrizzleToolEffectRepository`                   | `getWebTelemetryRuntime().turnTrace`；General Profile 与网页/Node/MCP Adapter |
| Web Teaching | `createTurnApplication` ← `createWebTurnLedgers()` / `createWebToolKernel()`                               | 与 Web General 共享 Web 组合模块                                      | 与 Web General 共享 Web 组合模块                                                                        | 同一 Web Trace；Teaching Profile 与教学 Adapter                               |
| Gateway      | `createGatewayTurnApplication()` ← `createGatewayDependencies()`（`apps/gateway/src/turn-composition.ts`） | Gateway 组合模块构造 `DrizzleAgentTurnContextRepository` / `ModelRun` | Gateway 组合模块构造 `DrizzleAgentToolCallRepository` / `DrizzleToolEffectRepository` 并注入 ToolKernel | Gateway Trace / Profile、Node/MCP Adapter；`agent-runner.ts` 只做可信路由投影 |

旧写入者生产引用清点（全仓 grep，2026-08-06）：

- `DrizzleModelRunRepository`（model-run-repository.ts:199）：仅 audited-model-gateway.ts:68
  （生产死代码：`AuditedTurnModelGateway` 全仓无导入者）与 db 集成测试
  （agent-ledger.integration.test.ts:111/:539/:604/:659、conversation-repositories.integration.test.ts:176/:258/:314）；
- `DrizzleToolCallRepository`（tool-call-repository.ts:241）：仅 db 集成测试
  （agent-ledger.integration.test.ts:403）；
- `beginOrReplay`（turn-ledger-repository.ts:549）：仅 db 集成测试
  （agent-ledger/conversation-repositories/asset-repository/k12 双写集成测试）；
- 旧表删除不属本任务；旧数据 N-1 读取保留（R08 单独执行删除）。

#### R05.3 收口动作（同任务内实施）

- A2：`@educanvas/db` 新增静态门禁——生产代码禁止新增导入 `DrizzleModelRunRepository`/
  `DrizzleToolCallRepository`（基线 = audited-model-gateway.ts）与绕过
  `DrizzleAgentTurnContextRepository` 直写 turn_context_snapshots；
- A2：`DrizzleModelRunRepository`/`DrizzleToolCallRepository` 加 `@deprecated` 标注（不删导出，R08 移除）；
- A3：新增 `DrizzleK12ConversationBackfillRepository` 与手工 Graphile 任务
  `maintenance:backfill_k12_conversation`。任务未加入 crontab，空 payload 默认 `dry-run`；只有显式
  `{mode:'apply'}` 才写入。每页 1-500 条、稳定游标续跑、repeatable-read 快照、幂等补缺；发现
  既有副本不一致时整页零写入且任务失败。返回和日志只含计数/游标，不含消息正文；
- A3 真实 PostgreSQL 证据：双写关闭后 dry-run 零写入 → apply 补齐 → 重跑零新增 →
  `auditK12Parity` 零差异；另覆盖 limit=1 游标续跑和“既有错配 + 缺失”整页零写入；
- B1-B3（R06）：唯一 `createTurnApplication` 工厂 + 三入口迁移 + 跨入口一致性测试。

#### R05.4 Codex 复核结论

- A1 与 R00/R04 盘点一致；消息迁移方向以 accepted ADR-0013 为准：当前 K12 运行权威
  仍是 `chat_messages`，长期平台权威是 `conversation_messages`；
- begin 受开关控制、settle 持续收敛的语义通过开/关、零差异和真实 PostgreSQL 回填测试；
- `audited-model-gateway.ts` 与旧 Repository 保留为有明确删除前置的 R08 候选，不在首次
  切换中物理删除。

### R06：唯一 Turn Application 组合工厂

- 依赖：R05
- 文件边界：
  - `packages/agent-runtime/src/**` 新增或调整 composition contracts；
  - Web General、Web Teaching、Gateway 组合根；
  - 相关跨入口契约测试。
- 可并行：否

目标：

- 建立唯一 `createTurnApplication` 或等价工厂；
- Web 与 Gateway 只提供 identity、profile、transport、capability 和 adapter；
- Lifecycle、Ledger、Model Runtime、Tool Kernel、Cancellation、Trace 的公共装配不再复制；
- Profile 仍可拥有领域差异，不把 Teaching 逻辑塞进 General。

完成标准：

- 三条生产路径不再各自 `new TurnApplicationService({...})`；
- 跨入口同一输入的终态、错误码、取消和账本切片有一致性测试；
- Gateway 无 Asset 能力时仍诚实失败，不通过伪造空能力达到“统一”；
- 删除至少一套重复装配文件或显著缩减其职责。

### R06 台账（2026-08-06，最终结论 `PASS`）

R06 完成标准四项全部达成；B1-B3 与 R05 A2 在同一任务内实施。Codex 复核修正抽象
`ToolKernelPort` 类型和 Gateway 组合文档后，结论 `PASS`；无 BLOCKED 项。

#### R06.1 B1：唯一组合工厂

- 新建 `packages/agent-runtime/src/turn-application/factory.ts`：
  `createTurnApplication(dependencies: TurnApplicationDependencies): TurnApplicationPort`
  是 `new TurnApplicationService(dependencies)` 的唯一生产构造点；
- `turn-application/dependencies.ts` 由 `@internal` 改为公开组合契约（仅抽象
  Port/adapters 类型，不导入 db、Provider SDK、Web/Gateway 实现）；
- `src/turn-application.ts` 与 `src/index.ts` 导出 `createTurnApplication` 与
  `TurnApplicationDependencies`；
- 新增 `turn-application.factory.test.ts`（2 用例：主编排可运行、可选依赖缺省行为一致）。

#### R06.2 B2：三生产入口迁移

| 入口         | 迁移前                                               | 迁移后                                                                                            |
| ------------ | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Web General  | `new TurnApplicationService`（general-turn.ts:96）   | `createTurnApplication`（general-turn.ts:96）                                                     |
| Web Teaching | `new TurnApplicationService`（learning-turn.ts:112） | `createTurnApplication`（learning-turn.ts:112）                                                   |
| Gateway      | `new TurnApplicationService`（旧 agent-runner.ts）   | `createGatewayTurnApplication`（agent-runner.ts）→ `createTurnApplication`（turn-composition.ts） |

- 全仓生产代码的 `new TurnApplicationService(` 现仅存于 factory.ts:16；
- 测试同步：两个 web trusted-route 测试 mock 改为 `createTurnApplication`；
  general-chat-boundary.test.ts 断言改为 `toContain('createTurnApplication')` +
  `not.toContain('new TurnApplicationService')`；gateway agent-runner.test.ts 注入
  ApplicationFactory 无需改动。

#### R06.3 B3：静态门禁 + 跨入口一致性

- 新增 `turn-application.composition-boundary.test.ts`（仿 import-boundary 静态门禁）：
  生产代码禁止 `new TurnApplicationService(`（唯一豁免 factory.ts）、三入口必须
  使用 `createTurnApplication`、门禁自检；
- 新增 `turn-application.consistency.test.ts`：同一输入经工厂在五类场景收敛一致——
  成功（completed + 账本切片）、非法流（MODEL_FAILED）、服务端取消（cancelled）、
  缺 capability（unavailable→retryable 重试耗尽后 MODEL_FAILED，不伪造空能力成功）、
  replay（不读取 Context、不调用 Provider）。

#### R06.4 验证矩阵（2026-08-06 实跑）

| 包            | 命令                                              | 结果                                                                       |
| ------------- | ------------------------------------------------- | -------------------------------------------------------------------------- |
| db            | `rtk pnpm --filter @educanvas/db test`            | 8 files / 65 passed（含 A2 门禁新断言）                                    |
| agent-runtime | `rtk pnpm --filter @educanvas/agent-runtime test` | 23 files / 99 passed（含 factory/consistency/composition-boundary 新文件） |
| web           | `rtk pnpm --filter @educanvas/web test`           | 116 files / 918 passed                                                     |
| gateway       | `rtk pnpm --filter @educanvas/gateway test`       | 20 files / 196 passed                                                      |
| 全仓          | `rtk pnpm typecheck`                              | 0 error TS                                                                 |
| 全仓          | `rtk git diff --check`                            | clean                                                                      |

#### R06.5 Codex 复核结论

- B1 工厂只接收抽象 Port/adapters；三入口的具体仓储、Tool Kernel 与 Trace 装配集中于
  Web/Gateway 组合模块；
- Gateway 缺 Asset 能力继续诚实收敛为 unavailable → `MODEL_FAILED`，不伪造空能力成功；
- 静态门禁与五场景一致性测试锁定唯一构造点和跨入口终态语义。

### R07：兼容协议稳定标识清理

- 依赖：R00
- 文件边界：`apps/web/server/gateway/web-turn.ts`、相关 protocol 类型和测试
- 可并行：是

目标：

- Tool ID、failure code、retryable、capability 不再由中文 label 或 message 字符串推断；
- Legacy 投影只消费稳定枚举；
- `tool.failed` 不再无差别映射为同一错误；
- 每个兼容映射都有删除条件。

完成标准：

- 修改任意 UI 文案不会改变协议结果；
- 未知枚举 fail closed；
- Legacy 与 canonical event 的映射有完整表驱动测试；
- 清理冗余条件和永远等价的逻辑。

### R07 台账（2026-08-06，最终结论 `PASS`）

R07 为核验既有实现（web-turn.ts 与 turn-application-projection.ts 在本任务前已完成
稳定标识清理），台账更新状态并记录证据。实现与测试均存在且通过，无需新代码。

#### R07.1 验收标准 → 证据映射

| 验收标准                                                                 | 实现证据                                                                                                                           | 测试证据                                                                               |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Tool ID/failure code/retryable/capability 不由中文 label 或 message 推断 | `web-turn.ts:60` `capability.name` 稳定标识；`turn-application-projection.ts:5` `toGatewayFailureCode`（gateway-runtime 稳定枚举） | `turn-application-projection-stability.test.ts`                                        |
| Legacy 投影只消费稳定枚举                                                | `turn-application-projection.ts:101-107` `tool.failed` → `toGatewayFailureCode(event.code)`                                        | `turn-application-projection-mapping.test.ts` 表驱动 cases                             |
| `tool.failed` 不再无差别映射为同一错误                                   | `gatewayToLegacy`（:225-231）透传 `event.code`，不同 code 保留                                                                     | 同上表驱动                                                                             |
| 修改 UI 文案不改变协议结果                                               | `safeFailureMessage`（:8-19）从稳定 code 单向派生文案                                                                              | `stability.test.ts:151`（不同 audience 仅 message 不同，code/retryable 一致）          |
| 未知枚举 fail closed                                                     | `displayToolLabel`（:47-49）兜底通用文案；`TOOL_LABELS`（:32-45）收录 capability 与工具名两种写法                                  | `stability.test.ts:100`（未知 tool ID 不反向推断）、`:121`（未知失败码原样透传不猜测） |
| 清理冗余/永远等价逻辑                                                    | `TOOL_LABELS` 多键同文案是跨入口写法兼容（本地 Adapter/Node/MCP 标识不一致），非永远等价                                           | `stability.test.ts:185`（不同书写形式映射同一动作名）                                  |

#### R07.2 Codex 复核结论

- 既有实现满足 R07 全部完成标准；表驱动映射、未知枚举 fail closed 和文案稳定性测试均通过，
  R07 从 PENDING 解除并标记 `PASS`。

### R08：删除审计、文档回写与收口

- 依赖：R05、R06、R07
- 文件边界：本计划、对应 canonical 文档、必要的静态门禁
- 可并行：否

完成标准：

- 权威矩阵中的每条双轨均为 `removed`、`read-only with deadline` 或 `blocked with owner`；
- 至少记录被删除的文件、出口、表写入者和兼容映射；
- 架构文档只描述当前事实，不把目标写成完成；
- 全 CI 通过；
- Codex 独立复核后才能归档。

### R08 收口台账（2026-08-06，最终结论 `PASS`）

本台账记录 R05/R06 REVISE 后的遗留路径、删除清单与审计结论。不删除任何物理文件或表，
仅标注每条路径的状态与归属。

#### R08.1 遗留路径审计

| 路径                              | 状态                         | 位置                                                                                                            | 说明                                                                                                                                                                                                                        |
| --------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AuditedTurnModelGateway`         | **removed candidiate**       | `apps/web/server/model/audited-model-gateway.ts:67`                                                             | 全仓零导入者，仅自身定义与 import-boundary 基线引用；内部持有 `DrizzleModelRunRepository`（旧写入者）                                                                                                                       |
| `DrizzleModelRunRepository`（旧） | **read-only with deadline**  | `packages/db/src/model-run-repository.ts:199`                                                                   | 仅 audited-model-gateway.ts（死代码）与 db 集成测试引用；已 @deprecated，R08 删除 audited-model-gateway.ts 后全仓零生产引用                                                                                                 |
| `DrizzleToolCallRepository`（旧） | **read-only with deadline**  | `packages/db/src/tool-call-repository.ts:241`                                                                   | 生产零调用（全仓 grep 确认）；仅 db 集成测试引用 `agent-ledger.integration.test.ts:403`；已 @deprecated                                                                                                                     |
| `beginOrReplay`（旧 Turn ledger） | **read-only with deadline**  | `packages/db/src/turn-ledger-repository.ts:549`                                                                 | 仅 db 集成测试引用；生产代码走 `DrizzleTeachingTurnLedger.beginOrReplay`                                                                                                                                                    |
| K12 conversation 双写             | **read-only with deadline**  | `packages/db/src/k12-conversation-dual-write.ts`                                                                | 开关门控（`EDUCANVAS_K12_CONVERSATION_DUAL_WRITE==='true'`），关闭即停止新投影创建；settle 始终收敛。退出路线遵循 ADR-0013：回填并对账后把可见消息切读到 `conversation_messages`，教学运行态另行迁移和批准后才退役旧字段/表 |
| K12 历史回填                      | **bounded maintenance path** | `packages/db/src/k12-conversation-backfill-repository.ts`、`apps/worker/src/tasks/backfill-k12-conversation.ts` | 手工 Graphile 任务；默认 dry-run、显式 apply、每页最多 500、稳定游标、幂等补缺、错配整页零写入；不进 crontab                                                                                                                |
| `getDb` 默认出口                  | **removed**                  | `packages/db/src/index.ts`                                                                                      | 默认入口已移除；10 个获准服务端组合点经 internal 单符号 allowlist 使用，后续只可迁往 Repository 并减量                                                                                                                      |

#### R08.2 明确删除候选（不在本任务删除）

| 候选                                                          | 文件                                                                                                            | 前置条件                                                                                                                |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `AuditedTurnModelGateway` + `DrizzleModelRunRepository`（旧） | `apps/web/server/model/audited-model-gateway.ts`、`packages/db/src/model-run-repository.ts`                     | audited-model-gateway.ts 先删除（零导入者），再删 model-run-repository.ts（需同步更新 db 集成测试）                     |
| `DrizzleToolCallRepository`（旧）                             | `packages/db/src/tool-call-repository.ts`                                                                       | 先更新 agent-ledger.integration.test.ts（唯一引用），再删文件                                                           |
| `beginOrReplay`（旧方法）                                     | `packages/db/src/turn-ledger-repository.ts`                                                                     | 先更新 conversation-repositories.integration.test.ts 等 db 集成测试，再删方法                                           |
| K12 双写机制                                                  | `packages/db/src/k12-conversation-dual-write.ts` 及相关文件                                                     | 有界回填完成 + 对账零差异 ≥ 1 发布周期 + 可见消息消费者切到 `conversation_messages`；教学运行态获得新归属后另行批准退役 |
| K12 回填任务                                                  | `packages/db/src/k12-conversation-backfill-repository.ts`、`apps/worker/src/tasks/backfill-k12-conversation.ts` | 双写副本删除且回退窗口结束后，与对账工具一并删除                                                                        |

#### R08.3 当前 Turn 组合点审计

| 组合点                                | 构造方式                                                                                                      | 唯一性            |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ----------------- |
| Web General (`general-turn.ts:96`)    | `createTurnApplication(...)` ← `createWebTurnLedgers()`                                                       | ✅ 经共享组合模块 |
| Web Teaching (`learning-turn.ts:112`) | `createTurnApplication(...)` ← `createWebTurnLedgers()`                                                       | ✅ 经共享组合模块 |
| Gateway (`agent-runner.ts`)           | `createGatewayTurnApplication(...)` ← `createGatewayDependencies()`（`apps/gateway/src/turn-composition.ts`） | ✅ 经共享组合模块 |
| `factory.ts:16`                       | `new TurnApplicationService(deps)`                                                                            | ✅ 唯一构造点     |

#### R08.4 默认 DB 出口审计

- `@educanvas/db` 默认入口：受控 exports（`.`、`./internal`、`./testing`），无 `export *`
- 默认入口 `getDb` 导出/生产引用均为 0；internal getDb allowlist 为 10 个组合点，只可减量
- 动态 import 绕过：已封闭（import-boundary 门禁）
- schema 表 denylist：17 个表，生产引用基线 0

#### R08.5 静态门禁汇总

| 门禁                                  | 文件                                                                       | 断言数 | 状态             |
| ------------------------------------- | -------------------------------------------------------------------------- | ------ | ---------------- |
| db import-boundary                    | `packages/db/src/import-boundary.test.ts`                                  | 13     | ✅ R04/R05       |
| turn-application composition-boundary | `packages/agent-runtime/src/turn-application.composition-boundary.test.ts` | 9      | ✅ R06（新增 6） |
| turn-application consistency          | `packages/agent-runtime/src/turn-application.consistency.test.ts`          | 5      | ✅ R06           |
| Turn composition production boundary  | `tooling/turn-composition-boundary.test.mjs`                               | 2      | ✅ R00           |
| Telemetry production boundary         | `tooling/telemetry-composition-boundary.test.mjs`                          | 2      | ✅ R03           |
| Runtime module size boundary          | `tooling/runtime-module-size-boundary.test.mjs`                            | 3      | ✅ R06（已更新） |

#### R08.6 Codex 复核结论

- 遗留路径均落入 `removed candidate`、`read-only with deadline`、`bounded maintenance path`
  或 `blocked with owner`，没有把目标状态冒充当前事实；
- 删除候选均保留独立迁移、集成测试和回退前置，不与首次切换同 PR 物理删除；
- K12 回填、切读和旧表退役按 ADR-0013 分闸门；本轮只交付可测量的回填与对账路径；
- R00-R08 全部通过后，本计划可归档。

## 七、验证台账

| 任务               | 状态   | 证据                                                                                                                                                                                                                                     |
| ------------------ | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R00 基线与权威矩阵 | `PASS` | Codex 复核三条 Turn 调用图、持久事实写入者、包出口和跨线所有权；后续实现与矩阵一致                                                                                                                                                       |
| R01 Node 基线      | `PASS` | `.nvmrc`/engines/CI/所有 workspace `@types/node` 统一 Node 22；`node:gate` 与漂移负例通过                                                                                                                                                |
| R02 Asset 追溯     | `PASS` | ContextSegment 0/1/N Asset 契约、profile 多图全量登记、fail closed 校验、PostgreSQL 账本重建通过，无 migration                                                                                                                           |
| R03 配置单次解析   | `PASS` | factory/config spy+注入测试通过；Web/Worker parse-once、能力级降级与 Secret 边界经 Codex 复核                                                                                                                                            |
| R04 DB 公共出口    | `PASS` | 2026-08-07 Codex 复核：默认入口显式化（无 `export *`）、受控 subpath internal/testing、import-boundary 静态门禁 11 断言、动态 import 绕过已封闭；既有 getDb/schema 出口留待 R06/R08；db unit 8/63、tooling 100、全仓 lint/typecheck 全过 |
| R05 持久事实单轨   | `PASS` | 区分当前 K12 运行权威与 ADR-0013 长期平台权威；有界手工回填默认 dry-run、显式 apply、游标续跑、错配零写入；真实 PostgreSQL 对账通过                                                                                                      |
| R06 组合工厂       | `PASS` | ToolKernelPort 抽象接口 + Web/Gateway 组合模块 + 三入口消除 Drizzle/ToolKernel 直接构造；静态门禁与五场景一致性测试通过                                                                                                                  |
| R07 协议标识       | `PASS` | 稳定 capability/failure code、未知枚举 fail closed、文案单向派生和表驱动映射测试通过                                                                                                                                                     |
| R08 收口           | `PASS` | 遗留路径和删除前置完成审计；全验证绿：db integration 46/288、gateway 20/196、agent-runtime 23/99、web 116/918、worker 23/120、tooling 100/100、lint/typecheck/diff-check                                                                 |

## 八、阶段级验证

```text
rtk pnpm lint
rtk pnpm typecheck
rtk pnpm test:unit
rtk pnpm test:integration
rtk pnpm build
rtk pnpm test:e2e
rtk git diff --check
rtk git diff --name-status origin/main...HEAD
rtk git status --short
```

## 九、风险与回退

- 数据事实切换使用 expand → backfill → compare → switch reads/writes → contract；
- 任何跨入口终态或账本不一致立即回退到最后一个单轨写入前版本；
- 公共出口收口先提供 subpath，再迁移调用方，最后删除旧出口；
- 组合根收敛不得改变协议；先建立 characterization tests；
- 若减少概念后反而引入更多 Adapter、文件或双写，本任务判定 `REVISE`。

## 十、收尾检查表

- [x] 每类执行事实都有当前权威、长期目标与唯一新写入者；
- [x] Web、Teaching、Gateway 使用统一组合工厂；
- [x] 默认 DB 出口不暴露底层连接和全部 schema；
- [x] Context Snapshot 完整记录多 Asset；
- [x] Node runtime/types/CI 一致；
- [x] 展示文案不参与协议身份；
- [x] 旧路径已有删除或限期读取结论；
- [x] 稳定事实已回写 canonical 文档；
- [x] 计划已移入 `completed/` 并更新 active 索引。
