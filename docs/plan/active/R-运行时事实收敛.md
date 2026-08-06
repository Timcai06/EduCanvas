# Turn Runtime、数据事实与公共边界收敛

- 任务分配名：`R 运行时收敛`
- 状态：`active`
- 负责人：项目负责人
- 实现执行：协作 Agent，每次只领取一个原子任务
- 代码审核与最终验收：Codex
- 最后验证时间：2026-08-06
- 当前领取任务：`R00`
- 并行计划：[W 工作面画布](W-工作面画布收敛.md)、[Q 质量观测成本](Q-质量观测成本.md)
- 后续出口：[G 产品发布闭环](G-产品发布闭环.md)
- 关联计划：[UV 画布语音](UV-画布语音.md)、[KM 知识记忆](KM-知识记忆.md)

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

### R00 盘点台账（2026-08-06，结论 `REVIEW_REQUIRED`）

R00 为只读盘点，本台账只记录代码事实，不宣布 PASS。结论 `REVIEW_REQUIRED`，等待 Codex
复核后解锁 R01；无 BLOCKED 项。

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

#### R00.8 结论与待复核项

- 结论：`REVIEW_REQUIRED`（R00 为只读盘点，不宣布 PASS，无 BLOCKED）。
- 第二节"已经确认的代码事实"逐项核对全部成立；新增三项事实：
  `legacyToGateway` 无任何调用点、`projectTurnApplicationEventToWeb` 无生产调用点、
  `audited-model-gateway.ts` 无生产调用点（均为 R07/R03 删除候选）。
- 待 Codex 复核：R00.7 权威矩阵"唯一写入者"判定、R00.6 R02/R03 可并行结论、R00.5 删除路径清单。

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

### R02 台账（2026-08-06，结论 `REVIEW_REQUIRED`）

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

| 验收（R02 目标） | 测试 |
| --- | --- |
| 文本 Asset | `context-engine.test.ts` 混合用例 text-1/text-3 单值登记；profile `textSegments` |
| 单图 | profile "segment 文本投影逐字相等"（兼容单值）；混合用例 |
| 多图 | `context-engine.test.ts` 多 asset 段；profile "多图合并段登记全部版本"（3 图顺序） |
| 文本+多图 | `context-engine.test.ts` 混合段拼接顺序 |
| 重复 | 段内重复、跨段重复 fail closed（`context-engine.test.ts`） |
| 非法/越权 | 空 ID、混用、零版本 fail closed（engine）；跨 Notebook 混合越权整体拒绝且不部分写入（integration） |
| 空 | 同上（`assetVersionIds: []` / `['']` / 无引用均拒绝） |
| 上限 | `MAX_ASSET_VERSIONS_PER_SEGMENT + 1` 拒绝 |
| 顺序 | engine material 顺序；`turn-context.test.ts` 多 Asset 顺序敏感 hash；integration 多 asset 读回顺序 |
| 历史单 Asset 兼容 | integration "历史单 Asset Snapshot（单元素数组）可原样读回" |
| PostgreSQL 账本重建 | integration "多 Asset 版本按消息内顺序全量落账，账本可重建本轮完整图集" |

#### R02.6 验证结果

| 命令 | 结果 |
| --- | --- |
| `pnpm --filter @educanvas/agent-runtime test` | 20 files / 84 passed |
| `pnpm --filter @educanvas/db test` | 7 files / 52 passed |
| `pnpm --filter @educanvas/db test:integration`（TEST_DATABASE_URL=pgvector:5433） | 46 files / 278 passed |
| `pnpm --filter @educanvas/agent-core test` | 23 files / 276 passed |
| `pnpm --filter @educanvas/web vitest server/platform/` | 6 files / 38 passed（profile 11） |
| `pnpm test:tooling` | 98 passed |
| typecheck agent-core / agent-runtime / db / web | 全过 |
| prettier（改动文件） | 全过 |
| `git diff --check` | 干净 |

#### R02.7 结论

- 结论：`REVIEW_REQUIRED`，无 BLOCKED。
- 待 Codex 复核：`MAX_ASSET_VERSIONS_PER_SEGMENT = 32` 取值；`assetVersionId` 兼容字段的
  收口期限（建议随 R05）；并发 R01/R03 与 R02 合并时 `pnpm-lock.yaml` 与 `package.json`
  可能产生冲突，需按依赖顺序合并。

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

### R03 台账（2026-08-06，结论 `REVIEW_REQUIRED`）

R03 实现「模型配置单次解析与显式注入」：Factory 改为接收已验证配置对象，
Web/Worker 组合根收敛为 parse-once，spy/注入测试锁定单次解析与能力降级。
结论 `REVIEW_REQUIRED`，等待 Codex 复核；无 BLOCKED 项。

#### R03.1 配置对象所有者与生命周期

| 组合根 | 配置对象所有者 | 生命周期 | 解析次数 |
| --- | --- | --- | --- |
| Web（`apps/web/server/model/model-runtime.ts`） | `resolveTurnModelRuntime(environment)` 本地变量，主 Gateway 与视觉 Gateway 共享同一 `ModelGatewayConfiguration` | 每次 Turn 调用解析一次（`parseModelGatewayConfiguration` 恰好 1 次），函数返回即释放；不做进程级缓存（Next.js 无可靠模块级单例，也避免全局可变缓存掩盖重复解析） | 1（改动前 3：组合根 + 主 Factory + 视觉 Factory 各自解析） |
| Gateway（`apps/gateway/src/agent-runner.ts:108`） | `productionDependencies()` 默认参数，进程启动时构造 `GatewayApplicationDependencies` 一次，`TurnModelGateway` 常驻 | 进程级一次；`createTurnModelGatewayFromEnvironment(readModelEnvironment())` 内部 parse 恰好 1 次 | 1（无改动） |
| Worker（`apps/worker/src/model-runtime.ts`） | 既有 `resolve*`：每次调用内局部变量；新增 `createWorkerModelRuntime(environment)`：任务级局部变量，全部能力共享 | `resolve*` 每次调用解析主配置 1 次，不缓存；任务级入口一次构造解析 1 次，全部能力复用 | `resolve*` 单次调用 1（无改动）；任务级入口 1 |

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

| 配置状态 | 文本/主链路 | vision | speech/transcription/image/embedding | 依据 |
| --- | --- | --- | --- | --- |
| 主配置未配置（无 provider） | 关闭（null → 诚实失败态） | 关闭 | 关闭 | `config.ts` disabled 语义 |
| 主配置非法（env/provider/key/model 等） | fail-fast 抛稳定错误码，不泄漏 secret | 同左 | 同左 | `config.ts` + `config-primitives.ts` 稳定码 |
| vision 半配置/互斥冲突 | **fail-fast**（ADR-0017：配置即能力，半配置会让部署误以为图片可用，直到运行时才失败） | 拒绝 | — | `config-vision.ts`，行为未变 |
| 单能力 override 半配置（如 speech 缺 Key） | 不受影响 | 不受影响 | **只关闭该能力**（null） | ADR-0021 `config-capability.ts` |
| embedding 模型未声明版本 | 不受影响 | 不受影响 | 只关闭 embedding | `config-media.ts` |
| DeepSeek 主 Provider 下媒体能力未 override | 不受影响 | 按 vision 配置 | 全部关闭 | `config-capability.ts` 继承矩阵 |

能力级错误一律收敛为 `disabled` 不抛异常（ADR-0021），与主配置 fail-fast 语义解耦，已有
`config-capability-acceptance.test.ts`（C04）锁定；R03 新增 worker 侧降级测试覆盖同一矩阵。

#### R03.4 验证

- spy/注入测试（先红后绿）：`packages/model-gateway/src/turn-model-gateway-factory.test.ts`
  （9/9）、`apps/web/server/model/model-runtime.test.ts`（8/8，改动前红：一次调用解析 3 次）、
  `apps/worker/src/model-runtime.test.ts`（9/9）。
- 全量回归：model-gateway 274/274、web 888/888、worker 115/115、gateway 196/196；
  四包 typecheck 通过；`pnpm test:tooling` 98/98；`git diff --check` 干净。
- 禁止全局可变缓存：测试只计数纯函数调用，无模块级缓存参与。

#### R03.5 已知边界（REVIEW_REQUIRED 项）

- Web General 路径一次 Turn 内 `resolveTurnModelRuntime()` 被调用两次
  （`apps/web/server/platform/general-turn.ts:138` 物化层与 `:85` 应用服务），每次调用各解析一次；
  Teaching 路径（`learning-turn.ts:111`）为单次。`general-turn.ts` 不在 R03 文件边界内，
  未改动。建议 R06「唯一 Turn Application 组合工厂」把 runtime 提升为 Turn 级单例，届时
  Web General 达到「每 Turn 只解析一次」。
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

- 静态门禁能拒绝生产代码导入 `@educanvas/db/schema`、`getDb` 或 testing entry；
- 所有生产组合根通过 Repository/Port 构造；
- 没有用几十个临时 re-export 掩盖原来的超级出口；
- 包循环依赖和构建时间没有显著恶化。

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

## 七、验证台账

| 任务               | 状态              | 证据                                                                                                                  |
| ------------------ | ----------------- | --------------------------------------------------------------------------------------------------------------------- |
| R00 基线与权威矩阵 | `REVIEW_REQUIRED` | 2026-08-06 台账：HEAD fe6ab1a、三条 Turn 调用图、持久表/写入者盘点、包出口、UV/KM 交集、R00.7 权威矩阵；待 Codex 复核 |
| R01 Node 基线      | `PENDING`         | version gate、全量 typecheck、CI                                                                                      |
| R02 Asset 追溯     | `REVIEW_REQUIRED` | 2026-08-06 台账：ContextSegment 0/1/N Asset 契约、profile 多图全量登记、fail closed 校验、integration 账本重建；unit + PostgreSQL integration 全过，无 migration |
| R03 配置单次解析   | `REVIEW_REQUIRED` | factory/config spy+注入测试：model-gateway factory 9/9、web model-runtime 8/8、worker model-runtime 9/9；见 R03 台账（:475） |
| R04 DB 公共出口    | `PENDING`         | import boundary gate、build                                                                                           |
| R05 持久事实单轨   | `PENDING`         | migration、对账、跨入口 integration                                                                                   |
| R06 组合工厂       | `PENDING`         | cross-entry contract tests                                                                                            |
| R07 协议标识       | `PENDING`         | table-driven compatibility tests                                                                                      |
| R08 收口           | `PENDING`         | full CI、删除清单、canonical 文档                                                                                     |

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

- [ ] 每类执行事实都有唯一权威与唯一新写入者；
- [ ] Web、Teaching、Gateway 使用统一组合工厂；
- [ ] 默认 DB 出口不暴露底层连接和全部 schema；
- [ ] Context Snapshot 完整记录多 Asset；
- [ ] Node runtime/types/CI 一致；
- [ ] 展示文案不参与协议身份；
- [ ] 旧路径已有删除或限期读取结论；
- [ ] 稳定事实已回写 canonical 文档；
- [ ] 计划已移入 `completed/` 并更新 active 索引。
