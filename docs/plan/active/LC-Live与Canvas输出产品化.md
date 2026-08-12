# Live 实时交互与 Canvas 多形态输出产品化

- 任务分配名：`LC Live 与 Canvas 输出`
- 状态：`active`
- 负责人：@Timcai06
- 代码审核与最终验收：Codex
- 最后验证时间：2026-08-12
- 起始远端基线：`5215ac580cfff89331aaf4399d097fb3260b3dfd`
- 前置归档：[UV 画布语音](../completed/UV-画布语音.md)
- 语音决策：[ADR-0025](../../09-decisions/0025-语音双入口与云端级联边界.md)
- 输出决策：[ADR-0027](../../09-decisions/0027-Canvas多形态输出与交互运行时边界.md)
- 输入协作边界：[ADR-0026](../../09-decisions/0026-多模态输入原件与派生表示边界.md)

## 一、交付目标

本阶段把 Live Voice 从“虽已消费增长文本、但体验仍可能退化成整段到达后朗读的沉浸面板”
收敛为当前 Agent Turn 的低延迟实时投影：同一条 Assistant 消息在普通聊天记录与 Live 字幕中同步增长，首个可朗读
短语出现后立即开始流式 TTS，后续生成、合成和播放重叠进行，插话能同时停止 Turn、TTS 与
本地播放。

同时按 ADR-0027 落地 `auto`、Markdown 文档、类型化互动 Artifact 和隔离 Web App 四种
输出意图，优先完成可编辑 Markdown、`mind_map.v2` 与 `web_app.v1` 三条代表性纵切，并让
Live 只投影这些 Artifact 的真实状态、预览和打开入口。两条线继续复用唯一
`TurnApplicationService`、Agent Runtime、CanvasResource、Artifact Version 和 Web Runtime，
不创建第二套对话、消息账本、Agent Loop、Renderer Registry 或文件输入协议。

## 二、已验证基线与缺口

### 2.1 Live 已有基础

- `message.delta` 已直接追加到同一条 Assistant 消息，普通聊天具备真实流式文本事实源
  （`apps/web/features/chat/turn-state.ts:431-442`）。
- Live ASR final 已复用普通 `onSend`/`onLiveSend`，忙碌时先取消原 Turn 再提交新一轮；它不是
  独立会话（`apps/web/features/voice/voice-composer.tsx:252-303`）。
- 当前 TTS 会读取增长中的 `assistantText`，维护已消费字符并顺序入 Web Audio 队列
  （`apps/web/features/voice/playback/use-live-speech-playback.ts:279-346`）。
- 当前短语切分首段阈值为 10–32 字，后续为 18–72 字；未闭合尾句通常等 Turn 完成才释放
  （`apps/web/features/voice/playback/live-speech-segments.ts:28-70`）。
- 每个短语仍单独 POST `/api/v1/voice/live/speech`，虽然响应 PCM 是流式的，但短语之间重复
  建连且缺少统一的语音提交游标（`apps/web/features/voice/playback/use-live-speech-playback.ts:401-469`、
  `apps/web/app/api/v1/voice/live/speech/route.ts:19-88`）。

### 2.2 Canvas 已有基础

- Turn 请求当前只接受 `outputPreference: 'canvas'`，尚不能表达 ADR-0027 的四种输出意图
  （`apps/web/features/chat/use-teaching-turn.ts:40-42`、
  `apps/web/server/http/turn-request.ts:28-34,111-150`）。
- Agent Artifact Tool 已通过闭集 schema、服务端身份注入和后台 Job 创建
  `mind_map/slides/flashcards/note`（`apps/web/server/platform/general-artifact-tool.ts:17-39,56-132`）。
- Worker 已有不可变 Artifact Version 生成链，但支持类型仍是旧闭集
  （`apps/worker/src/tasks/generate-artifact.ts:309-436`）。
- Canvas 已把内容型 Artifact 交给 Registry，把 note 编辑与 `dom_exploration` 隔离 Runtime
  留在专用壳内（`apps/web/features/canvas/artifact-canvas-content.tsx:13-20,99-137`）。
- 当前思维导图 Renderer 只是递归缩进树，没有边布局、视口、折叠、拖拽或节点操作，视觉与
  交互不足不能由模型生成 CSS 掩盖（`apps/web/features/canvas/mind-map-renderer.tsx:19-99`）。
- 现有 `dom_exploration` 已限制 HTML/CSS/JS 字节和依赖数量，为 `web_app.v1` 提供 Tier 2
  基础，但尚不是完整的源码 manifest、构建诊断和发布包契约
  （`packages/canvas-protocol/src/web-runtime-artifact.ts:3-24`）。

## 三、范围与非目标

### 3.1 本阶段范围

- Live Assistant 文本、字幕、TTS 和 PCM 的统一增量游标与性能观测；
- 语义短语切分、连续 TTS Session、音频预取、字幕时钟和插话竞争；
- Live 与普通聊天消息、工具状态、引用和 Artifact 状态的同源投影；
- 四种输出意图的端到端契约以及旧 `canvas` 偏好的兼容归一化；
- `document.markdown.v1`、`mind_map.v2`、`web_app.v1` 的协议、生成、版本、Renderer/Runtime、
  编辑或导出纵切；
- Canvas 与 Live 联合验收、性能预算、失败恢复、安全测试和真人体验证据。

### 3.2 非目标

- 不实现端到端语音大模型，不绕过现有 ASR → Agent Runtime → TTS 级联；
- 不让 Live 建立独立聊天历史、独立附件协议或独立 Artifact 状态机；
- 不让模型生成的任意 HTML/JavaScript 在主页面执行；
- 不把 PDF、DOCX、图片等输入原件改写为 Artifact；其原件预览和派生表示仍归 ADR-0026；
- 不在本阶段同时重做所有 Renderer。Slides、Quiz、Flashcards 等只完成共享契约兼容和回归，
  后续按独立质量任务升级；
- 不以 fake Provider、fixture、自动化音频时钟冒充真人麦克风和真实 DashScope 体验证据。

## 四、跨线不变量

1. Live 和 Canvas 输出都通过既有 General/Teaching Turn 进入
   `packages/agent-runtime`；Feature 包不得创建第二套 Agent Loop。
2. 普通消息账本是 Live 对话文字的唯一事实源；Live 层只保存当前会话的瞬时游标、字幕和
   播放状态，退出后不产生第二份聊天记录。
3. 浏览器的输出偏好只影响表现形态，不授予 Tool、Provider、模型、网络、存储或身份能力。
4. Provider Secret、原始 Provider 事件、Prompt、堆栈和未验证代码止于
   `packages/model-gateway` 或服务端安全边界。
5. Artifact 必须先成为已校验、不可变、可追溯的 Version，再进入 Renderer 或 Runtime；
   未知 kind/schema/version、未锁依赖和超限输出 fail closed。
6. Live 打开来源或 Artifact 时交给同一 CanvasResource 与 Renderer Registry，不复制预览器。
7. ADR-0026 的 `assetId + versionId` 输入引用只进入 provenance；Artifact 不能据此继承 Source
   权限或私有对象地址。

## 五、体验与性能预算

性能预算拆成“本产品增加的延迟”和“真实 Provider 端到端延迟”，避免用网络或模型波动掩盖
客户端退化。

| 指标                  | 自动化阻断目标                | 真人/Canary 记录目标                        |
| --------------------- | ----------------------------- | ------------------------------------------- |
| delta 到聊天文字提交  | 浏览器收到事件后 p95 ≤ 100 ms | 记录 p50/p95，不低于自动化基线              |
| 可朗读边界到 TTS 提交 | p95 ≤ 300 ms                  | p95 ≤ 500 ms                                |
| TTS 首 PCM 到播放排期 | p95 ≤ 120 ms                  | 记录 Provider 首包与本地排期两段耗时        |
| 连续短语播放空隙      | fake PCM p95 ≤ 120 ms         | 三轮对话主观无明显断句，保留测量值          |
| 插话到本地静音        | p95 ≤ 120 ms                  | Chrome/Safari 各验证一次                    |
| 插话到 cancel 发出    | p95 ≤ 150 ms                  | 服务端最终进入 cancelled 或已完成的唯一终态 |
| Canvas 首次可交互     | 固定 fixture p95 ≤ 1 s        | 真实生成完成后 p95 ≤ 2 s，不含模型生成时间  |
| 大型 mind map 交互    | 120 节点缩放/拖拽 ≥ 50 FPS    | 桌面 Chrome 无明显掉帧，窄屏仍可操作        |

## 六、原子任务与依赖顺序

每个任务只在其验收证据完整后标记 `PASS`。`L` 为 Live，`C` 为 Canvas，`X` 为联合收口。

### 6.1 共同基线

| 任务          | 状态   | 交付与验收                                                                                                                                                                                                                             |
| ------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LC00 事实冻结 | `PASS` | 代码审计完成，记录 delta、TTS、Artifact、Runtime 当前链路、测量点和失败矩阵；可执行性能 fixture 与预算阻断由 L08/C08 建立，避免用未测量值冒充基线。详见 [LC00-LC01-事实冻结与契约矩阵.md](../../06-quality/12-LC基线与契约矩阵.md)。   |
| LC01 契约矩阵 | `PASS` | 已固定 Live 游标、输出意图、Artifact kind/version、Renderer/Runtime 和错误码所有权；列出旧 `canvas`、`note`、`dom_exploration` 的兼容期限和迁移路径。详见 [LC00-LC01-事实冻结与契约矩阵.md](../../06-quality/12-LC基线与契约矩阵.md)。 |

### 6.2 Live 实时交互线

| 任务                    | 状态      | 交付与验收                                                                                                                                                                                                                 |
| ----------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L01 同源流式消息        | `PASS`    | Live 面板直接消费当前 Assistant `message.delta` 投影，不维护第二份完整回答；普通聊天同一消息逐增量增长，入室/出室均不丢字、不重复字。                                                                                      |
| L02 三游标状态机        | `PASS`    | 已引入纯 `displayCursor`、`speechCommittedCursor`、`audioPlayedCursor`、`sessionBaselineCursor` 与单调 `runId`；语义段携带原文 offset，只有同代 PCM 完成 marker 推进播放游标，覆盖回退、重复事件、取消迟到回调和重新入室。 |
| L03 自适应语义提交      | `REVIEW` | 用标点、长度、等待时间和 Markdown/公式/代码安全边界共同决定首段与后续段；视觉文字立即出现，TTS 只提交稳定可朗读短语，不按单字请求，也不等待完整回答。                                                                      |
| L04 连续 Speech Session | `PENDING` | 在 provider-neutral `StreamingSpeechGateway` 上增加可取消的会话级文本提交/PCM 事件；优先复用一条服务端会话，当前逐短语 HTTP 保留为能力降级，不改变浏览器字幕和播放状态机。                                                 |
| L05 音频与字幕时钟      | `PENDING` | 当前段播放时预取下一段；字幕只由实际 PCM 排期推进；网络抖动、空 PCM、奇数字节、TTS 失败和播放恢复均不会导致文字/声音漂移。                                                                                                 |
| L06 插话和工具连续性    | `PENDING` | 插话原子取消 Agent operation、Speech Session 和本地队列；已显示文字保留。工具调用前后继续同一消息和同一语音游标，工具运行期间显示真实状态，不合成伪造填充语。                                                              |
| L07 Live 壳连续体验     | `PENDING` | 入室可接管正在流式生成的当前 Turn，出室只卸载沉浸壳；字幕区只强调当前可听内容，完整对话仍落在普通消息列。来源、引用和 Artifact 状态均来自现有控制器。                                                                      |
| L08 Live 性能与真人验收 | `PENDING` | fake SSE/TTS/PCM 对预算逐项阻断；macOS Chrome/Safari 完成连续三轮、一次工具调用、一次插话、一次 TTS 失败恢复，并记录首字、首音、段间隙与取消延迟。                                                                         |

### 6.3 ADR-0027 Canvas 输出线

| 任务                      | 状态      | 交付与验收                                                                                                                                                                                             |
| ------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| C01 输出意图契约          | `PENDING` | Turn 公共输入支持 `auto`、`markdown_document`、`interactive_artifact`、`web_app`；旧 `canvas` 在服务端归一化并有弃用测试。未知值 400，偏好不改变工具授权。                                             |
| C02 Markdown 文档纵切     | `PENDING` | 新增版本化 `document.markdown.v1`，Markdown 为 canonical content；支持生成、编辑、新版本、差异、回退和 `.md` 导出。Renderer 禁止 raw HTML、脚本、事件属性和任意网络资源。                              |
| C03 Artifact 提案统一     | `PENDING` | Agent Tool 使用闭集 Artifact Proposal，服务端注入 identity/notebook/conversation/operation；生成中、失败、取消、版本新增和打开状态沿用现有 Turn 事件及 Artifact Job，不另建生成 Loop。                 |
| C04 `mind_map.v2` 协议    | `PENDING` | schema 表达节点、边、分组、语义角色和有限布局提示；保留 v1 Renderer 或提供显式迁移，历史版本不可静默失效。120 节点和深度上限经产品测试重新确认，不为追求“大”而取消可读性上限。                         |
| C05 思维导图 Renderer     | `PENDING` | 先用固定 fixture 对候选布局算法做尺寸、许可证、确定性和性能 spike，再决定是否引入依赖；交付自动布局、缩放、平移、折叠、聚焦、节点提问、键盘与 reduced-motion，视觉 token 与动效由 Renderer 控制。      |
| C06 `web_app.v1` 构建纵切 | `PENDING` | Artifact Version 包含文件 manifest、入口、hash、锁定依赖、capability、预算和诊断；构建后进入 ADR-0019 Tier 2 Runtime。无 `allow-same-origin`、Credential、任意网络/CDN、运行时安装和跨 Notebook 读取。 |
| C07 编辑、版本和导出      | `PENDING` | 三类代表性输出都产生不可变版本，可查看版本、回退和继续要求 Agent 修改；导出不包含运行凭据、私有 Source、对象存储键或 Provider 内容。                                                                   |
| C08 Canvas 产品验收       | `PENDING` | 真实 Turn 分别生成 Markdown、mind map 和 Web App；验证大图、窄屏、键盘、失败态、未知版本、恶意脚本、资源超限、构建取消和历史版本回放。                                                                 |

### 6.4 联合收口

| 任务                     | 状态      | 交付与验收                                                                                                                                                                                    |
| ------------------------ | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| X01 Live × Canvas        | `PENDING` | Live 中可听到 Agent 对产物生成的自然说明并看到真实进度；产物 ready 后出现预览/打开动作，打开后进入同一 Canvas；Live 不朗读代码、长 URL、原始 JSON 或隐藏安全字段。                            |
| X02 多模态 provenance    | `PENDING` | 使用 ADR-0026 的 PDF/图片/文档输入生成三类输出；Artifact provenance 精确记录实际 `assetId + versionId`，撤销来源权限后不能借 Artifact 或 Live 越权读取原件。                                  |
| X03 CI 路由与证据        | `PENDING` | 契约/unit/fake-provider 按 changed-files 运行；浏览器 smoke 只覆盖核心纵切；真实 Provider canary 与完整浏览器矩阵不在普通文档或无关 PR 重跑。报告区分自动化、fake、真实 Provider 和真人证据。 |
| X04 Canonical 回写与归档 | `PENDING` | 回写产品、架构、前后端、测试、可观测性及 ADR-0025/0027；保留偏差和未完成项，完成一次最终全量门禁后移入 `completed/`，不改写 UV 历史结论。                                                     |

## 七、建议文件所有权

为避免一个文件同时承担协议、状态机和视觉职责，实施时按下列边界拆分；单文件接近 400 行即
评审职责，通常在 600 行前拆分。

| 责任                  | 主要文件或目录                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------------- |
| Turn delta 与消息事实 | `apps/web/features/chat/turn-state.ts`、`turn-events.ts`、`use-teaching-turn.ts`                  |
| Live 协调与投影       | `apps/web/features/voice/voice-composer.tsx`，新增独立 coordinator/cursor 模块                    |
| 语义分段与播放        | `apps/web/features/voice/playback/`，分离 segmenter、speech session、PCM timeline、subtitle clock |
| Live BFF/Gateway      | `apps/web/app/api/v1/voice/live/`、`apps/gateway/`                                                |
| Provider Adapter      | `packages/model-gateway/`，供应商事件和 Secret 不越界                                             |
| 输出公共契约          | `packages/agent-core/`、`packages/canvas-protocol/`                                               |
| Artifact Tool 与 Turn | `apps/web/server/platform/general-artifact-tool.ts`、General/Teaching profile                     |
| Artifact 生成         | `apps/worker/src/tasks/generate-artifact.ts` 及按 kind 拆分的 generator                           |
| Canvas Renderer       | `apps/web/features/canvas/`，每个 Renderer 独立维护视觉与交互                                     |
| Tier 2 Runtime        | `apps/web-runtime/` 与既有 Runtime bridge/policy，禁止在 Canvas 组件内复制沙箱                    |

## 八、测试与证据矩阵

| 层级        | Live 证据                                                                 | Canvas 证据                                                              |
| ----------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Unit        | delta/游标单调性、语义边界、Markdown 清洗、字幕排期、取消竞争             | 四意图 parser、schema 版本、迁移、布局确定性、manifest/hash、导出净化    |
| Integration | fake Agent SSE → Speech Gateway → PCM 队列；唯一终态与 secret containment | Turn → Tool → Job → Version → CanvasResource；鉴权、重试、取消和历史版本 |
| Browser     | 同一消息逐字增长、入室/出室连续、插话、工具状态、reduced-motion           | Markdown 编辑导出、120 节点导图、Web App 沙箱、窄屏/键盘/失败态          |
| Security    | 跨主体 ticket、终态后事件、Provider body 不泄漏、音频不持久化             | raw HTML、XSS、CDN/网络、Credential、跨 Notebook、未知版本和资源超限     |
| Performance | 首字、可朗读边界、首 PCM、段间隙、插话静音/取消                           | 生成完成到可交互、120 节点 FPS、Runtime 冷启动、bundle/route size        |
| Human       | Chrome/Safari 三轮对话、工具、插话、失败恢复                              | 三种输出各一次真实生成、编辑/回退/导出和 Live 打开体验                   |

CI 只使用 fake Provider 验证确定性协议，不调用真实 DashScope 或真实模型。Provider canary 使用
受保护 Environment 手动运行；真人验收记录浏览器、系统、模型 alias、时间和稳定指标，不记录
API Key、学生内容、Provider 原始响应或音频。

## 九、风险、触发条件与回退

| 风险                     | 触发信号                               | 缓解与回退                                                                                |
| ------------------------ | -------------------------------------- | ----------------------------------------------------------------------------------------- |
| TTS 过早提交导致语义生硬 | 短句碎裂、标点后长停顿、字幕超前       | 保留可配置 segment policy；按语言和首段/后续段分别调参；回退到当前有界短语 HTTP 路径      |
| TTS 过晚仍像整段朗读     | 首音只在 completed 后出现              | 用等待时间软边界强制释放；性能门禁直接阻断该回归                                          |
| 插话竞争读出旧回答       | cancel 后仍有 PCM 或字幕               | `runId + AbortSignal + 三游标` 原子失效；旧 Session 事件全部丢弃                          |
| Live 和聊天出现两份记录  | 入室/退出后消息重复或 ID 漂移          | 只允许 Turn reducer 持有消息；Live 使用只读 selector 和瞬时播放状态                       |
| `mind_map.v2` 破坏历史图 | v1 无 Renderer 或被错误迁移            | v1/v2 显式注册；fixture 回放历史 Version；迁移必须生成新版本                              |
| Web App 扩大主站权限     | 能访问 Cookie、Storage、CDN 或顶层导航 | 继续 ADR-0019 不透明 origin 与闭集 bridge；隔离证据失败即关闭 `web_app`，不降级主页面执行 |
| 输出意图诱导越权工具     | 浏览器偏好改变 grant                   | 偏好只进入 prompt/profile hint；Tool allowlist 仍由服务端 policy 决定并有负例测试         |
| 两条开发线互相阻塞       | Live 等 Canvas 全部完成或反之          | L01-L08 与 C01-C08 独立纵切；只在 X01-X04 汇合，共享契约先于视觉实现                      |
| CI 反复跑高成本矩阵      | docs/局部改动触发完整 E2E              | 收紧 changed-files；每阶段只跑受影响门禁，结档只跑一次最终全量证据                        |

## 十、阶段门禁与交付节奏

1. **Gate A — 基线与契约**：LC00-LC01 PASS 后才允许修改公共协议。
2. **Gate B — Live 核心**：L01-L06 PASS 后完成 fake-provider 低延迟纵切；L07-L08 负责产品与真人验收。
3. **Gate C — Canvas 三纵切**：C01-C03 先统一输出契约；C04-C05 完成 Tier 1 代表；C06 完成 Tier 2；C07-C08 收口版本与产品验收。
4. **Gate D — 联合验收**：X01-X03 证明 Live、Canvas、输入 provenance 和 CI 路由没有旁路。
5. **Gate E — 结档**：X04 只运行一次最终全量门禁，生成证据链接和未完成项去向后归档。

建议按门禁形成可回滚 PR，不要求每个原子任务单独开 PR；同一 PR 必须只有一个可命名责任，
不得把 Provider Adapter、Canvas Renderer 大改和无关 CI 重构混在一起。

## 十一、预期事实回写

| 稳定事实类型                          | 目标文档                                                           |
| ------------------------------------- | ------------------------------------------------------------------ |
| Live 与 Canvas 用户行为               | `docs/01-product/01-产品定义.md`、`docs/01-product/03-用户流程.md` |
| Turn、Gateway、Canvas 与 Runtime 架构 | `docs/02-architecture/01-系统架构现状.md`、`04-统一画布工作面.md`  |
| 前后端实现边界                        | `docs/05-engineering/02-后端工程.md`、`03-前端工程.md`             |
| 性能、E2E 与真人证据                  | `docs/06-quality/03-测试与评估.md`、Live/Canvas 专项验收记录       |
| 配置、Canary 与观测                   | `docs/07-operations/01-部署与可观测性.md`                          |
| 重大取舍与偏差                        | ADR-0025、ADR-0027；必要时只新增真正的新决策，不复制本计划         |

## 十二、验证证据台账

| 验收项               | 证据                                         | 结果      |
| -------------------- | -------------------------------------------- | --------- |
| LC00-LC01 基线与契约 | 代码审计、测量点、失败矩阵与契约矩阵 PR      | `pass`    |
| L01-L08 Live         | 单元/集成/浏览器性能报告、真人记录           | `pending` |
| C01-C08 Canvas       | schema/Renderer/Runtime 测试、视觉与安全报告 | `pending` |
| X01-X03 联合验收     | 产品级 E2E、provenance、安全与 CI 路由报告   | `pending` |
| X04 结档             | 最终 CI run、canonical diff、PR/merge 链接   | `pending` |

## 十三、收尾检查表

- [ ] L01-L08、C01-C08、X01-X04 均有可复现证据，失败项明确转入后续计划；
- [ ] 普通聊天、Live 字幕和语音确认来自同一 Assistant 消息与单调游标；
- [ ] 三种代表性 Canvas 输出通过同一 Turn/Agent Runtime 产生并保留不可变版本；
- [ ] Live、Canvas、Web Runtime、输入 Source 均未形成旁路权限或第二事实源；
- [ ] 性能数字区分客户端增加延迟、Provider 延迟、自动化和真人证据；
- [ ] 稳定事实已经回写 canonical 文档，ADR 只保留长期决策；
- [ ] 只完成一次最终全量门禁，不用重复 CI 冒充更多信心；
- [ ] 本计划压缩后移入 `completed/`，并更新 `docs/plan/README.md` 与 active 索引。
