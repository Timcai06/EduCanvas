# EduCanvas 架构修复串行交接计划

## 执行基线

- 工作目录：`/Users/tim/DEV/EduCanvas`
- 分支：`main`
- Gate 0 已完成：来源处理、PDF 预览、Studio GradualBlur 和本计划已按职责收口。
- 每个 Prompt 开始前，以实时 `git status`、`git rev-list` 和 `git log` 为准，不沿用文档创建时的提交号。
- 只有当前工作区干净后，才能开始下面任何 Schema、Repository 或 Worker 阶段。

## 执行规则

1. 所有阶段在同一 tree、同一 branch 串行完成，不创建 worktree、不切分支。
2. 一次只把一个提示词交给一个 AI；不得并行执行。
3. 每个阶段开始时 `git status --short` 必须为空。若不为空，立即停止并报告。
4. AI 不得提交、推送、建 PR；只留下可审查 diff。由 Codex 检查通过后完成原子提交。
5. 所有 shell 命令以 `rtk` 开头。
6. 禁止 `git reset --hard`、`git clean`、覆盖其他人的修改、手改生成迁移产物。
7. 一个文件一个命名职责；接近 400 行复核，除机械生成文件外不得超过 600 行。
8. Provider SDK 类型、原始响应、Prompt、密钥和堆栈不得越过 `packages/model-gateway`。
9. Schema、迁移和 Repository 只归 `packages/db`；唯一生产 Agent Loop 仍在 `packages/agent-runtime`。
10. 每阶段结束后把：文件职责、数据库变化、兼容策略、测试证据、未完成项报告给审查者。

## Gate 0：收口当前工作区（已完成）

本阶段不交给其他 AI。Codex 已审查来源处理、PDF Worker、GradualBlur、状态提示和相关测试，
并按职责形成原子提交。后续 Prompt 仍须逐个串行执行。

---

## Prompt 1：解除 `model_runs` 对具体 Alias 的硬编码（已完成）

```text
你是 EduCanvas 数据库与模型运行审计主线的资深后端工程 Agent。

仓库：/Users/tim/DEV/EduCanvas
必须留在当前 tree、当前 branch；禁止创建 worktree、禁止切分支。

开始前：
1. 完整阅读 AGENTS.md 和 /Users/tim/.codex/RTK.md。
2. 所有 shell 命令以 rtk 开头。
3. 执行 rtk git status --short；若不为空，立即停止并报告，不得修改。
4. 阅读：
   - packages/db/src/schema.ts 中 modelRuns（约 1442-1529 行）
   - packages/db/src/model-run-repository.ts
   - packages/db/src/agent-model-run-repository.ts
   - packages/agent-core/src/model-contracts.ts
   - packages/model-gateway/src/config.ts
   - packages/db/src/migrations.integration.test.ts
   - docs/09-decisions 中模型运行、Operation、兼容迁移相关 ADR

唯一目标：
让新增合法 taskAlias、modelAlias 和 phase 不再要求修改 model_runs 的枚举型 CHECK，
同时保留 operation 归属、消息关联、生命周期、审计字段和输入格式约束。

必须实现：
- model_runs_operation_shape_check 只验证 operationKind 与 session/message/operation 外键形状，
  不得通过具体 taskAlias 决定关联关系。
- taskAlias、modelAlias、phase 改为有界格式约束；不能直接删除所有校验。
- 应用写入路径继续通过类型或 Registry 拒绝未知运行配置；数据库格式约束不能冒充能力 Registry。
- 保留 status、attempt、token、latency、时间戳和 promptHash 等现有强约束。
- 生成正式 Drizzle 迁移，不手改 snapshot/journal。
- 现有数据升级必须无损，不改历史 model_run 的审计语义。
- 更新相关 ADR/API 或数据设计文档，明确“DB 保证形状，Registry 保证能力存在”。

测试至少覆盖：
- 现有 agent.turn、teaching.turn、speech 写入继续通过。
- 一个符合格式的新 taskAlias/modelAlias/phase 能通过 DB 形状约束。
- 空值、超长、非法字符仍被拒绝。
- 错误的 operation/message/session 组合仍被拒绝。
- fresh migration、N-1 升级、重复迁移证据。

验证：
- rtk git diff --check
- rtk pnpm lint
- rtk pnpm typecheck
- rtk pnpm test:unit
- rtk make db-integration-prepare
- 使用 TEST_DATABASE_URL 运行 packages/db 相关集成与迁移测试

禁止：
- 不新增模型能力、图像生成或转录。
- 不修改消息表或 Artifact 表。
- 不把 Alias 变成数据库动态配置中心。
- 不提交、不推送、不创建 PR。

完成后报告建议提交信息：
refactor: 解耦模型运行别名约束
```

审查重点：迁移可逆性、旧数据兼容、Repository 类型边界、是否误放宽 operation 归属。

---

## Prompt 2：建立双消息表的统一只读投影（已完成）

```text
你是 EduCanvas 消息持久化兼容主线的资深后端工程 Agent。

仓库：/Users/tim/DEV/EduCanvas
留在当前 tree、当前 branch；不得创建 worktree或切分支。

开始前完整阅读 AGENTS.md、RTK.md，并确认 rtk git status --short 为空，否则停止。

阅读：
- packages/db/src/schema.ts：
  - conversationMessages（约 727-774 行）
  - lessonSessions.conversationId（约 780 行）
  - chatMessages（约 1264-1340 行）
- packages/db/src/chat-repository.ts
- packages/db/src/conversation-platform-repository.ts
- packages/db/src/platform-turn-repository.ts
- packages/db/src/learning-session-repository.ts
- apps/web/server/platform/
- docs/02-architecture、docs/04-data、相关 ADR

唯一目标：
在不改写、不双写历史消息的前提下，建立服务端统一消息历史只读投影，使同一 Conversation
可以按稳定游标读取 conversation_messages 与其关联 lesson_sessions 下的 chat_messages。

必须实现：
- 定义浏览器无关、Provider 无关的统一 MessageHistoryItem/Port。
- K12 role student 映射为 user，assistant 保持 assistant；不得伪造 system/tool 消息。
- 使用 lesson_sessions.conversation_id 做可信关联，不能按标题、时间或客户端 ID 猜测。
- 定义稳定排序与冲突规则：createdAt 相同必须有确定 tie-breaker，并保留 source/messageId。
- 游标必须可验证、有界，不能只用 offset。
- 统一读取只能在服务端完成所有权/Notebook 访问校验后调用。
- 保留现有 ChatRepository 和 PlatformTurnRepository API，不迁移写路径。
- 增加契约和集成测试；文档明确这是兼容读取，不是事实表合并。

测试至少覆盖：
- 只有 conversation_messages。
- 只有 chat_messages。
- 同一 Conversation 两类消息混排。
- 相同时间戳的确定顺序。
- 跨用户、跨 Notebook 拒绝。
- 分页无重复、无遗漏。
- failed/cancelled/interrupted 状态诚实保留。

禁止：
- 不新增数据库迁移，除非现有索引被 EXPLAIN 证明无法支持目标查询；需要迁移时先停止报告。
- 不做双写、回填或删除旧表。
- 不修改前端视觉。
- 不提交、不推送、不创建 PR。

验证：
rtk git diff --check
rtk pnpm lint
rtk pnpm typecheck
rtk pnpm test:unit
相关 packages/db 集成测试

建议提交信息：
feat: 增加统一消息历史投影
```

审查重点：游标稳定性、权限边界、是否错误去重、是否把投影变成第三事实源。

---

## Prompt 3：K12 消息向平台消息的受控双写与对账（已完成）

```text
你是 EduCanvas 消息迁移纵切的资深全栈工程 Agent。

前提：
- Prompt 2 已审查通过并提交。
- 当前 tree、当前 branch，rtk git status --short 必须为空。
- 完整阅读 AGENTS.md、RTK.md 和 Prompt 2 交付的统一消息契约。

唯一目标：
让新产生的 K12 可见消息在保持 chat_messages 兼容行为的同时，幂等写入
conversation_messages，并提供可观测对账；本阶段不删除 chat_messages、不切断旧读路径。

必须实现：
- 双写必须处于同一数据库事务或拥有明确可恢复的 durable outbox；禁止两个无协调 insert。
- 建立稳定的一一映射/幂等键，不靠内容哈希猜测同一消息。
- K12 lease、cancelRequestedAt、heartbeat 等运行态继续由 chat_messages 持有；
  conversation_messages 只保存平台可见消息事实，不复制不属于它的运行态。
- parts 的投影必须使用已验证的 AgentMessagePart，Provider 原始内容不得落库。
- 增加 parity 查询或受限审计命令，统计 missing/mismatch，不能暴露消息正文。
- 使用关闭默认或明确 rollout 开关；关闭时旧行为完全不变。
- 更新迁移计划，写清回填、切读、停止双写、旧表退役仍未完成。

测试至少覆盖：
- 正常 student/assistant 双写。
- 重试不产生重复消息。
- 事务失败不出现单边成功。
- cancel/interrupted/failed 状态收敛。
- 开关关闭时无平台副本。
- 跨 Conversation 关联被拒绝。
- 对账只返回计数和稳定标识，不泄露正文。

禁止：
- 不回填全量历史。
- 不删除或重命名 chat_messages。
- 不把 lease 字段复制进 conversation_messages。
- 不修改 Artifact、模型 Port 或 UI。
- 不提交、不推送、不创建 PR。

验证：
rtk git diff --check
rtk pnpm lint
rtk pnpm typecheck
rtk pnpm test:unit
相关 DB/Worker 集成测试

建议提交信息：
feat: 接入K12消息兼容双写
```

审查重点：原子性、幂等、关闭开关兼容、状态映射和隐私。

### Prompt 3 迁移计划状态

**已完成：**

- ✅ 双写在同一数据库事务内完成（beginTeachingMessages 和 settleAssistantMessage）
- ✅ 使用 chat_messages.id 派生的确定性 UUID 作为 conversation_messages.id，保证幂等
- ✅ 不复制 lease、cancelRequestedAt、heartbeat 等运行态字段
- ✅ conversation_messages 只保存平台可见消息事实
- ✅ parts 使用已验证的 AgentMessagePart 格式
- ✅ 通过 EDUCANVAS_K12_CONVERSATION_DUAL_WRITE 控制新副本创建，默认关闭
- ✅ 已存在副本不受后续开关变化影响，settle 始终按 K12 源事实收敛
- ✅ 关闭时旧行为完全不变
- ✅ 增加最多 500 条/页的 keyset parity 对账，统计 missing/mismatch
- ✅ 跨 Conversation、派生 ID 冲突和事务单边成功均 fail closed

**未完成（后续阶段）：**

- ⏳ 回填历史消息（Prompt 5 或专门回填任务）
- ⏳ 切读路径到 conversation_messages 优先（Prompt 6）
- ⏳ 停止双写（当切读完成后）
- ⏳ 旧表 chat_messages 退役（最终阶段）
- ⏳ 如需反向 orphan 统计，先增加可逆显式映射；当前返回 null，不伪造 0

**技术决策：**

- 使用 UUID v8 形状的 SHA-256 派生 ID，而非内容哈希，保证幂等且不依赖内容稳定性
- 存在已验证 Agent Operation 时保留 operation_id；旧教学 Turn 继续允许 null
- 对账在 TypeScript 中计算预期 ID，内部比较正文与 Part，但响应只返回计数和稳定游标

---

## Prompt 4：Artifact 兼容桥，不合并学习快照

```text
你是 EduCanvas Artifact 与统一 Canvas 数据主线的资深后端工程 Agent。

前提：当前 tree/branch，工作区干净；完整阅读 AGENTS.md、RTK.md。

重点阅读：
- packages/db/src/schema.ts：
  - canvasArtifacts/canvasArtifactGradingKeys（约 2254-2298 行）
  - artifacts/artifactVersions/artifactGenerationJobs（约 2363 行以后）
- packages/db/src/artifact-repository.ts
- packages/db/src/platform-artifact-repository.ts
- apps/web/server/canvas/artifact-resource-adapter.ts
- packages/canvas-protocol/
- ADR-0004、ADR-0005、ADR-0009

唯一目标：
让未来 K12 创建的 Canvas Artifact 同时拥有平台长期 Artifact 身份，
而 canvas_artifacts 继续作为不可变学习回放/判分快照；禁止直接合表。

必须先产出并按其实现：
- 明确 canonical Artifact、Artifact Version、K12 snapshot、private grading key 四者关系。
- 为 snapshot 建立可空、受约束的平台 artifact/version 关联，或证明已有稳定关联足够；
  禁止用标题、params 哈希或客户端 artifactId 猜测。
- 新 K12 创建路径使用同一事务或 durable workflow 创建平台 Artifact Version 与学习快照。
- 私有 grading key 继续物理隔离，不得进入 Artifact Version、CanvasResource 或浏览器响应。
- 旧 K12 记录继续可读；不在本阶段做无界全量回填。
- 现有 Artifact Detail、消息 Artifact、Studio、判分和学习回放行为保持兼容。
- 更新 ADR，明确“长期事实”与“事件时快照”的边界。

测试至少覆盖：
- 新 K12 Artifact 同时产生长期身份与不可变快照。
- 重试幂等。
- grading key 不进入平台版本和 API。
- 平台 Artifact 归档不破坏历史学习回放。
- Conversation 删除只断长期挂接，快照保留策略符合生命周期规则。
- 跨用户/跨 Notebook 统一 404。
- 旧无关联 snapshot 仍可读取。

禁止：
- 不删除 canvas_artifacts。
- 不把 grading key 合并到 artifacts。
- 不迁移 Web Renderer Registry。
- 不实现历史全量回填。
- 不提交、不推送、不创建 PR。

验证：diff-check、lint、typecheck、unit、DB integration、相关 Web route tests。
建议提交信息：feat: 建立学习产物兼容桥
```

审查重点：事实边界、私有判分键、生命周期和旧记录兼容。

### Prompt 4 实施状态（2026-07-27）

**已完成：**

- ✅ 已绑定 Conversation/Notebook 的新 K12 产物在同一事务内创建 snapshot、private grading key、canonical Artifact 与 Version
- ✅ `(platform_artifact_id, platform_artifact_version_id)` 成对约束，且复合外键保证 Version 属于目标 Artifact
- ✅ 并发重试由事务级 advisory lock 串行化，不重复创建长期身份
- ✅ Artifact Version 只保存浏览器安全投影，判分键继续物理隔离
- ✅ 旧无关联 snapshot 保持可读，不做历史全量回填
- ✅ 跨 Notebook 读取收敛为既有 ArtifactOwnershipError/404 边界
- ✅ Web Renderer Registry 尚未迁移；Studio 在数据库分页前排除未注册 K12 类型
- ✅ 空库迁移 11/11、桥接集成测试 9/9 通过

**明确未完成：**

- ⏳ Web Renderer Registry 对 quiz、classification_game、pipeline_flow 的消费与展示
- ⏳ 历史 K12 snapshot 回填平台身份
- ⏳ 没有 Conversation 的兼容 lesson_session 桥接

---

## Prompt 5：确认个人 Agent 基数与模板市场边界

```text
你是 EduCanvas 产品架构与数据模型 Agent。本阶段只做证据化决策，不改 Schema。

仓库：/Users/tim/DEV/EduCanvas；保持当前 tree/branch；工作区必须干净。
完整阅读 AGENTS.md、RTK.md、README.md、personal_agents/Profile/Skill/Agent 模板相关代码与 ADR。

唯一目标：
决定未来模板市场是否需要“一名用户拥有多个 Agent 实例”，还是继续“一人一个 Personal Agent，
通过 Profile/Skill/模板安装组合能力”。

必须交付一份 ADR：
- 当前代码与产品定位证据。
- 两个可行模型及用户体验、权限、数据迁移、运行隔离、模板安装语义的比较。
- 明确推荐方案和不选择另一方案的理由。
- 如果维持一人一个 Agent，明确 personal_agents_user_unique 不是缺陷。
- 如果确需多 Agent，给出后续独立迁移计划，但本阶段不得实施。
- 模板、Profile、Skill、Agent 实例四个概念不得混用。

禁止：
- 不修改 packages/db/src/schema.ts。
- 不生成迁移。
- 不实现模板市场 UI。
- 不提交、不推送。

验证：rtk git diff --check、文档链接与代码引用存在。
建议提交信息：docs: 明确个人Agent与模板边界
```

审查重点：是否以真实产品需求驱动 Schema，而不是为了“未来可能”提前放宽基数。

---

## Prompt 6：补齐 `render_preview` 与 `generate_thumbnail` Worker

```text
你是 EduCanvas 资产派生处理流水线的资深后端工程 Agent。

前提：工作区干净；当前 tree/branch；完整阅读 AGENTS.md、RTK.md。
阅读 asset_processing_jobs、asset repository/storage、packages/asset-processing、
apps/worker/src/tasks/index.ts、extract-asset-text.ts、Source Canvas adapter 与现有预览端点。

唯一目标：
为数据库已经声明的 render_preview 和 generate_thumbnail 增加真实 Worker 实现，
保持原始 Source/Asset Version 为唯一内容事实。

必须实现：
- 每种任务独立命名职责与稳定 Graphile task 名。
- 输入只接受 assetId/versionId 等稳定标识，不接受客户端 objectKey/path。
- Worker 重新校验当前版本、MIME、大小上限和任务幂等。
- 派生文件进入受控对象存储键；数据库只保存派生物元数据、checksum、状态与失败码。
- PDF/DOCX 预览和图片缩略图仅支持经过白名单验证的 MIME；未知类型诚实失败。
- 重试区分 retryable 与 terminal；数据库不得保存原始异常、堆栈或第三方响应。
- 删除/归档 Source 后派生物遵守现有 object deletion outbox。
- 现有同步 Preview API 保持兼容；只有有消费者证据时才读取派生物。

测试至少覆盖：
ready、重复投递、未知 MIME、损坏内容、大小超限、最终失败、对象清理、跨版本隔离。

禁止：
- 不引入 Redis。
- 不复制原始 Source 内容成为新事实源。
- 不在浏览器做可信 MIME 判断。
- 不修改视觉。
- 不提交、不推送。

验证：diff-check、lint、typecheck、unit、DB/Worker integration。
建议提交信息：feat: 补齐资产预览派生任务
```

审查重点：派生物生命周期、幂等、对象键边界和任务终态。

---

## Prompt 7：音频 Source 与转录纵切（已完成）

```text
你是 EduCanvas 音频输入能力纵切的资深全栈工程 Agent。

前提：Prompt 1 与 Prompt 6 已通过；工作区干净；同一 tree/branch。
完整阅读 AGENTS.md、RTK.md、model-gateway Port、asset pipeline、CanvasResource、
Worker 任务与 Source Preview。

唯一目标：
支持有界音频 Source 上传、异步转录、文本上下文消费和诚实预览状态。

顺序必须是：
1. packages/agent-core 定义供应商无关 AudioTranscriptionModelGateway Port。
2. packages/model-gateway 实现并验证 Provider Adapter，原始响应止步于此。
3. packages/db 增加必要的处理任务/派生元数据，生成正式迁移。
4. apps/worker 增加转录任务。
5. apps/web 服务端接入受限 MIME、大小/时长策略和 CanvasResource 投影。
6. 客户端最后扩展 AssetItem/预览；不能只改前端 enum。

必须支持首批明确格式，并在实现前写入文档；未列入白名单的音频返回标准 unsupported。
转录文本是派生内容，不覆盖原始 Asset Version；必须记录稳定模型审计元数据。
客户端 notebookId、MIME、duration、actions 不能作为可信依据。

测试覆盖：上传、MIME 欺骗、大小/时长上限、queued/running/succeeded/failed、
重复任务、转录文本上下文、跨 Notebook、Provider 原文不泄漏、未知格式。

禁止：
- 不实现视频。
- 不把 base64 音频写入消息表。
- 不让 Worker 直接依赖 Provider SDK。
- 不提交、不推送。

验证：diff-check、lint、typecheck、unit、DB/Worker integration、相关 Web route tests。
建议提交信息：feat: 接入音频来源转录流水线
```

审查重点：Port 方向、MIME/时长策略、Provider 隔离和派生文本事实边界。

### Prompt 7 实施状态（2026-07-27）

**已完成：**

- ✅ `AudioTranscriptionModelGateway` 供应商无关 Port 与 OpenAI-compatible Adapter
- ✅ 首批 MP3、WAV、Ogg、FLAC、WebM、M4A 容器魔术字和完整媒体元数据验证
- ✅ 最大 25 MiB、最长 60 分钟；上传和 Worker 两端重复校验
- ✅ `assets:transcribe_audio` durable task 与独立 ingestion Repository
- ✅ processing Asset/Version 到 ready/failed 的幂等状态收敛
- ✅ checksum、字节数、当前 processing Version、MIME 和时长复核
- ✅ 转录文本上下文消费、音频预览、CanvasResource `source.audio` 服务端投影
- ✅ Provider原始响应、Prompt、objectKey和堆栈不进入数据库转录元数据或浏览器响应
- ✅ 正式0043迁移、Drizzle snapshot、fresh migration与0042→0043升级测试

**明确未完成：**

- ⏳ 真实Provider凭据下的live smoke；仓库测试只证明协议、边界和状态机
- ⏳ 长期停留在processing任务的恢复扫描和用户主动重试入口
- ⏳ 历史音频Source回填；本阶段不做无界回填
- ⏳ 视频音轨、抽帧与摘要；必须等独立Prompt 11

---

## Prompt 8：图像生成 Artifact 纵切（已完成）

```text
你是 EduCanvas 图像生成能力纵切的资深全栈工程 Agent。

前提：Prompt 1 已通过；工作区干净；同一 tree/branch。
完整阅读 AGENTS.md、RTK.md、ToolKernel/5D policy、model-gateway、
Artifact generation Worker、CanvasResource/Renderer Manifest 与现有 Artifact API。

唯一目标：
通过“Port -> Provider Adapter -> Tool/Policy -> Artifact Job -> Version -> CanvasResource”
完整链路加入图像生成，不创建第二 Agent Loop。

必须实现：
- agent-core 定义 ImageGenerationModelGateway Port，返回受限二进制/元数据，不返回 Provider 原文。
- model-gateway 实现 Provider Adapter 和响应校验。
- Tool Registry 显式注册；策略默认拒绝，明确 capability、风险、审批和教育场景边界。
- 生成通过 durable Worker Job；浏览器请求只得到 accepted/job 状态。
- 成功结果写入现有 Artifact/Artifact Version 与受控对象存储，不新增内容事实表。
- CanvasResource 的 trustTier、runtime、renderer、actions 完全由服务端决定。
- 首批只支持有界尺寸/格式/数量；Prompt、Provider body、objectKey、堆栈不进入浏览器投影。
- 现有 Artifact kind 与页面行为兼容。

测试覆盖：策略拒绝、批准、幂等、取消、重试、Provider 非法响应、大小上限、
生成成功、跨 Notebook、敏感字段不泄漏、未知 kind 诚实失败。

禁止：
- 不把图像模型接到 StructuredModelGateway。
- 不在 feature 包建立 Agent loop。
- 不做 UI 视觉重构。
- 不提交、不推送。

验证：diff-check、lint、typecheck、unit、DB/Worker integration、相关 API tests。
建议提交信息：feat: 接入图像生成产物流水线
```

审查重点：5D policy、异步语义、对象存储、审计脱敏和 Artifact 复用。

### Prompt 8 实施状态（2026-07-27）

**已完成：**

- ✅ `ImageGenerationModelGateway` 独立 Port 与 OpenAI-compatible Adapter；只接受单张、闭集尺寸和 PNG/JPEG/WebP 魔术字节
- ✅ `artifact.generate_image` 经 ToolKernel 五维策略显式注册，未配置模型时 fail closed
- ✅ durable Artifact Job、对象存储 checkpoint、不可变 Version 和 `generated_image` CanvasResource
- ✅ 图像字节读取先校验当前 Conversation/Notebook 和主体权限，跨 Notebook 统一 404
- ✅ 浏览器详情、消息卡片、Studio 和 Canvas 只消费安全媒体投影；Prompt、Provider 原文、objectKey、checksum 与堆栈不进入响应
- ✅ retryable Provider 错误交回 Graphile，确定性失败和耗尽使用稳定失败码

**明确未完成：**

- ⏳ 真实付费 Provider dogfood、成本告警与生产配额验证；自动化 fixture 不能替代线上验收
- ⏳ 图像编辑、局部重绘和多图批量生成不属于本纵切

---

## Prompt 9：pgvector 混合检索纵切（已完成）

```text
你是 EduCanvas 检索与知识库主线的资深后端工程 Agent。

前提：工作区干净；同一 tree/branch；完整阅读 AGENTS.md、RTK.md。
阅读 knowledge_documents、knowledge_chunks、retrieval_candidates、
ingest-knowledge-document Worker、当前 tsvector 查询、Context Compiler 和相关 ADR。

唯一目标：
在保留现有全文检索的基础上增加向量语义召回，并形成可解释的混合排序；
不得把“安装 pgvector”当作完成。

必须先定义：
- embedding 模型 Port/版本/维度和 Provider 隔离。
- chunk 不可变事实与 embedding 派生物关系。
- 重新嵌入、模型升级、失败重试和回填边界。
- lexical/vector 融合算法、稳定 tie-breaker、候选上限和超时预算。

必须实现：
- 正式 pgvector 扩展与 schema 迁移，fresh/N-1/rollback 证据。
- 异步 embedding Worker；未知/失败 embedding 不破坏现有 FTS。
- 混合检索默认可回退到 FTS。
- Notebook/Document 权限先于召回，不能检索后再过滤。
- 记录模型版本、chunk hash 和安全的检索诊断，不记录私密全文到日志。
- 基于固定 fixture 的相关性测试，不用随机向量证明质量。

测试覆盖：FTS-only 回退、vector-only 候选、混合排序、权限隔离、模型升级、
重复任务、部分失败、维度不匹配、分页/上限、迁移兼容。

禁止：
- 不删除 tsvector/GIN。
- 不在 Web 请求内同步嵌入全量文档。
- 不使用外部托管向量库。
- 不提交、不推送。

验证：diff-check、lint、typecheck、unit、DB/Worker integration、固定相关性测试。
建议提交信息：feat: 接入混合语义检索
```

审查重点：权限过滤顺序、回退、模型版本、回填成本和检索质量证据。

### Prompt 9 实施状态（2026-07-27）

**已完成：**

- ✅ 0044 正式安装 pgvector，新增 1536 维向量派生表、模型/版本/指令身份与运行账本，保留现有 tsvector/GIN
- ✅ 摄取后异步创建并领取 embedding run；分批写入、幂等重投、模型升级和内容哈希漂移均有边界
- ✅ 教学检索接入 FTS + vector RRF；权限范围由本轮冻结的 `turn_source_versions` 先收窄
- ✅ 查询向量缺失、维度不符、向量未回填或 ANN 超时时退回 FTS；超时通过 SAVEPOINT 恢复同一事务
- ✅ 固定正交向量 fixture 覆盖语义补回、混排、隔离、部分嵌入、上限和超时降级

**明确未完成：**

- ⏳ 不做无界历史回填；生产回填必须按 Document 有界入队并从运行账本观测进度
- ⏳ 真实教材上的相关性阈值、召回指标和模型成本仍需 dogfood 后确定

---

## Prompt 10：FK 与索引证据化审计修复（已完成）

```text
你是 EduCanvas PostgreSQL 数据完整性与性能审计 Agent。

前提：前述 Schema 阶段已稳定；工作区干净；同一 tree/branch。
完整阅读 AGENTS.md、RTK.md、packages/db/src/schema.ts、全部 Repository 查询和数据生命周期代码。

唯一目标：
只修复被真实关系语义或 EXPLAIN 证明存在问题的 FK 删除策略与索引，不做机械批量修改。

必须交付：
- FK 清单：父表、子表、当前策略、领域所有权、删除/归档/保留要求、建议及证据。
- 查询清单：Repository、WHERE/JOIN/ORDER BY、现有索引、EXPLAIN 计划、数据规模假设。
- 把“已有复合索引左前缀可用”的字段标记为无需新增，例如
  tool_calls(answer_model_run_id, provider_tool_call_id)。
- 仅对确认问题生成最小 Drizzle 迁移。
- cascade、restrict、set null 必须逐关系解释；审计/回放事实不得因方便而 cascade。
- 更新匿名清理、对象删除 outbox 和生命周期测试。

测试至少覆盖：
- 父对象删除后的预期保留/删除/set-null。
- 受保护审计记录无法意外删除。
- 新索引对应查询的 EXPLAIN 使用证据。
- fresh/N-1 migration。

禁止：
- 不批量给所有 FK 加 cascade。
- 不按“字段看起来常用”盲加索引。
- 不改业务功能或 UI。
- 不提交、不推送。

验证：diff-check、lint、typecheck、unit、DB integration、migration tests、EXPLAIN 证据。
建议提交信息：fix: 收紧数据关系与查询索引
```

审查重点：删除语义、索引写放大、重复索引和生产数据升级锁风险。

### Prompt 10 实施状态（2026-07-27）

**已完成：**

- ✅ 对 114 条 FK 按领域生命周期审计；没有证据支持修改现有删除策略
- ✅ 0045 删除 4 条被唯一索引覆盖的重复索引，只为 25 条有真实父表删除路径的 FK 补支撑索引
- ✅ `docs/04-data/fk-index-audit.md` 保存关系清单、查询依据、EXPLAIN fixture 与生产升级锁风险
- ✅ 集成测试持续检查缺失 FK 支撑索引、重复索引和关键删除语义

**明确未完成：**

- ⏳ 千万级生产表应用 0045 前仍需按部署规模决定迁移窗口或预建 concurrent index；隔离库通过不代表生产锁窗口已验证

---

## Prompt 11：视频 Source 最小纵切（已完成）

仅在音频转录、资产派生任务和真实产品需求均已确认后执行。

```text
你是 EduCanvas 视频来源处理纵切的资深全栈工程 Agent。

前提：Prompt 6、7 已通过；有明确的首批教育使用场景、格式、大小和时长预算；
工作区干净；同一 tree/branch；完整阅读 AGENTS.md、RTK.md。

唯一目标：
支持有界视频 Source 上传后异步提取音轨、关键帧和基础元数据，
产生可供 Agent 使用的转录/帧摘要，不实现视频编辑器。

必须实现：
- 服务端 MIME sniff、大小/时长/分辨率上限。
- Worker 隔离执行转码/抽帧，明确 CPU、内存、超时和临时文件清理。
- 复用 AudioTranscription Port，不复制转录体系。
- 关键帧是派生物，带 checksum、算法版本和 Source Version 关联。
- CanvasResource 只暴露安全预览/状态/actions，不暴露 objectKey/path。
- 部分成功语义明确：音轨成功但抽帧失败时如何呈现和重试。
- 删除 Source 时清理全部派生对象。

测试覆盖：格式欺骗、超限、无音轨、损坏视频、超时、部分成功、重复投递、
删除清理、跨 Notebook、临时文件不残留。

禁止：
- 不在 Web 进程运行 ffmpeg。
- 不新增第二套转录 Port。
- 不实现时间线编辑、字幕编辑或视觉重构。
- 不提交、不推送。

验证：diff-check、lint、typecheck、unit、DB/Worker integration、受限 fixture E2E。
建议提交信息：feat: 接入视频来源处理流水线
```

### Prompt 11 实施状态（2026-07-27）

**已完成：**

- ✅ 首批 MP4/QuickTime 服务端 brand sniff，50 MiB、20 分钟和 1080p 像素预算
- ✅ Worker 通过固定 argv、单线程、硬超时的 ffprobe/ffmpeg 在临时目录探测、提取单声道音轨和 4 张关键帧
- ✅ 音轨复用 `AudioTranscriptionModelGateway`；关键帧保存 checksum、算法版本、序号、时间点和 Source Version 关联
- ✅ 元数据成功即允许版本 ready；转录与关键帧分别记录 ready/failed/unavailable，浏览器诚实展示部分成功
- ✅ 视频列表、同源播放、转录预览、CanvasResource 和 Agent 文本上下文已接通；跨 Notebook 仍由服务端授权
- ✅ 批量对象写入中途失败立即回收孤儿帧；删除 Source 时所有关键帧进入对象删除 outbox

**明确未完成：**

- ⏳ 单路派生没有独立“重新处理”动作；当前预览明确提示删除后重新上传，后续可增加受控重试入口
- ⏳ 不包含时间线编辑、字幕编辑、WebM 视频和视觉内容理解/帧语义摘要

## 每阶段交回后的审查口令

完成任一阶段后，对 Codex 发送：

```text
检查阶段 N。不要先提交；审查当前 diff、Schema/迁移兼容、权限与隐私边界、
文件职责和测试证据。发现问题直接修复并复验，通过后再做原子提交。
```

## 明确不做

- 不因模板市场直接删除 `personal_agents_user_unique`。
- 不把 `model_runs` 所有 CHECK 简化成正则。
- 不把 `canvas_artifacts` 和 `artifacts` 直接合表。
- 不删除现有全文检索。
- 不把音频/视频仅作为前端 `AssetItem.kind` 枚举扩展。
- 不让多个 AI 同时在这个 tree 工作。
