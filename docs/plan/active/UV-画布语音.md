# 画布运行时与实时语音主线

- 任务分配名：`UV 画布语音`
- 状态：`active`
- 负责人：项目负责人
- 实现执行：项目负责人使用 DeepSeek，每次只领取一个已解锁的原子任务
- 代码审核与阶段验收：Codex
- 最后验证时间：2026-08-05
- 下一领取任务：`V17-A` 返工；`V16` 待复核；完整 `V17` 等待二者通过，`U19` 等待 `V17`
- 路线图：[路线图](../../10-planning/01-路线图.md)
- Canvas 架构：[统一画布工作面](../../02-architecture/04-统一画布工作面.md)
- Canvas 决策：[ADR-0009](../../09-decisions/0009-统一画布工作面与运行时分层.md)
- 语音决策：[ADR-0018](../../09-decisions/0018-实时语音输入选型与流式识别边界.md)

## 一、阶段目标

本计划是项目负责人负责的主线：未完成的 Canvas 资源接入、持久 Runtime、
Experiment Runtime、跨入口与实时语音输入。它与朋友负责的
[画布界面与可访问性优化](../completed/F-画布界面.md)此前与本计划并行开发，
开发期间没有代码文件交集；只有双方 PR 都合并后才进入最终联合审计。

阶段完成时应同时具备：

1. Source 与 Artifact 通过同一 `CanvasResource` 进入 Web Canvas；
2. 来源、结构化产物、媒体产物、Tier 2 持久应用和最小 CPU 实验按信任层渲染；
3. TUI 与非 Web 渠道对不支持的 Canvas 内容提供诚实的摘要或安全交接；
4. 学生可用短句实时语音输入，课堂字幕可连续听写，但不会自动提交教学 Turn；
5. 原始音频只有在监护人单独同意后才可留存，默认关闭，最长七天，撤回或到期后可靠硬删除；
6. 每个纵切均有自动化证据，真实 Runtime、真实麦克风与真实噪声场景另有人工 smoke 证据。

## 二、已经确认的代码事实

以下事实来自 2026-07-28 的源码核对，不允许 DeepSeek 把它们当成待从零实现的任务。

| 事实                                                                            | 当前证据                                                                                                                             | 结论                                         |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------- |
| Canvas 统一资源协议已存在                                                       | `packages/canvas-protocol/src/resource.ts:1-235`                                                                                     | 保持兼容，不重定义                           |
| Renderer manifest 与兼容判定已存在                                              | `packages/canvas-protocol/src/renderer-manifest.ts:10-68`                                                                            | 不再创建第二套 manifest                      |
| Source 投影已覆盖 PDF、图片、文本、DOCX、音视频                                 | `apps/web/server/canvas/source-resource-adapter.ts:13-103,177-235`                                                                   | 从 Web 消费和真实页面补缺口                  |
| Artifact 投影已覆盖结构化与媒体产物                                             | `apps/web/server/canvas/artifact-resource-adapter.ts:18-65,114-187`                                                                  | 不重写服务端投影                             |
| 统一资源读取会复核身份、Notebook 和归属                                         | `apps/web/server/canvas/resource-access.ts:1-177`、`apps/web/app/api/v1/canvas/resources/[resourceKind]/[resourceId]/route.ts:21-54` | 权限语义必须保持                             |
| Web 主 Canvas 仍消费旧 `PublicArtifact`                                         | `apps/web/features/canvas/canvas-panel.tsx:7-53`                                                                                     | 这是当前 Canvas 第一真实缺口                 |
| Web 静态 registry 仍只注册三类旧产物                                            | `apps/web/features/canvas/canvas-registry.tsx:349-360`                                                                               | 需要迁移组合层，不是重做协议                 |
| 轻量 HTML 消息预览已有 CSP 和 iframe 限制                                       | `apps/web/features/canvas/sandbox-preview.ts:1-75`                                                                                   | P3 做持久、版本化 Runtime，不复制轻量预览    |
| 图像 Provider、校验和、checkpoint 和恢复已存在                                  | `apps/worker/src/tasks/image-artifact-generation.ts:17-188`                                                                          | 先审计闭环，只补实证缺口                     |
| 当前音频 Port 只有整段一次性转录                                                | `packages/agent-core/src/model-gateway.ts:191-196`                                                                                   | 新流式 Port 与其并列，不替换                 |
| Composer 的语音按钮仍被禁用                                                     | `apps/web/features/composer/composer.tsx:165-174`                                                                                    | 产品接线尚未开始                             |
| 对象硬删除已有 Outbox 模式                                                      | `packages/db/src/object-deletion-outbox-repository.ts`、`apps/worker/src/tasks/delete-object-outbox.ts`                              | 音频删除复用模式，不另造调度系统             |
| ADR-0018 已 accepted；WASM SIMD 路线已由 V01 选择，真人录音矩阵暴露模型质量缺口 | `tooling/voice-lab/evidence/v02-s-summary.json`、`docs/09-decisions/0018-实时语音输入选型与流式识别边界.md`                          | V02/V03 已按负责人风险接受收口，V04/V10 解锁 |

如果实现时发现表中事实已经变化，先停止当前任务，由 Codex 更新本表与依赖图，
不能由 DeepSeek自行扩大任务。

## 三、范围与非目标

### 范围

- Web Canvas 的 `CanvasResource` registry、打开链路、来源呈现和跨 Notebook E2E；
- 媒体产物现有纵切的证据闭环、文本等价、访问和渠道降级；
- Tier 2 持久 Web Runtime 与 Tier 3 `ExperimentRuntimePort` 最小纵切；
- 流式转录 Port、sherpa-onnx adapter、Gateway 双向通道、浏览器采集与两种 UI；
- 监护人单独同意、短期音频留存、访问审计、到期与撤回硬删除；
- TUI/渠道一致性、完整门禁和事实文档回写。

### 与朋友协作线的文件所有权

主线在双方 PR 合并前**不得修改**以下朋友专属文件：

- `apps/web/features/canvas/canvas-host.tsx`
- `apps/web/features/canvas/canvas-host.test.tsx`
- `apps/web/features/canvas/canvas-shell-status.tsx`
- `apps/web/features/canvas/canvas-shell-status.test.tsx`
- `tests/e2e/canvas-shell-visual.spec.ts`
- `docs/06-quality/04-视觉回归.md`
- `docs/plan/completed/F-画布界面.md`

主线若发现必须修改其中任一文件，应先停止相应任务；不能通过复制组件或移动文件绕过
所有权。朋友协作线也不得修改本计划列出的协议、registry、server、Runtime、语音、
数据库、Gateway、Worker、TUI 或渠道文件。

### 非目标

- 不创建第二个 Agent loop，不替换 `packages/agent-runtime`；
- 不替换既有一次性 `AudioTranscriptionModelGateway`；
- 不做说话人分离、TTS、任意 GPU、任意镜像、任意网络或任意依赖执行；
- 不把 Provider SDK 类型、原始响应、Prompt、Secret、对象存储键或堆栈带出服务端边界；
- 不允许 Canvas、语音转录或 Runtime 直接写判分、掌握度和课程状态；
- 不把正式 IdP、全部生产渠道或完整生产 SLO 捆绑进本阶段；
- 不在任何原子任务中顺手重构无关模块、批量格式化仓库或产生超级大源码文件。

## 四、DeepSeek 通用提示词

每次把下面的共同提示词与对应原子任务提示词一起发给 DeepSeek。

```text
你在 /Users/tim/DEV/EduCanvas 中只完成本次指定的一个原子任务。

开始前：
1. 阅读根目录 AGENTS.md、CLAUDE.md、本计划和任务列出的 canonical 文档；
2. 用代码与相邻测试确认前置事实，不把计划文本当成实现证据；
3. 执行 `git status --short`，记录并保留他人的现有改动；
4. 依赖未满足、文件边界不够或需新增重大决策时立即停止并报告。

实施纪律：
- 只能修改任务明确列出的文件或目录；需要越界时先报告，不能自行扩展；
- 一个文件只有一个命名职责；接近 400 行必须评估拆分，除生成/机械文件外不得超过 600 行；
- 先补失败测试或最小契约测试，再做实现；
- 未知类型、版本不兼容、缺能力、跨用户或跨 Notebook 必须诚实失败；
- Provider 输入按不可信数据验证；不得泄露密钥、原始响应、Prompt、音频字节、学生数据或堆栈；
- 不得 reset、rebase、覆盖、删除或格式化任务外改动；不得手改 .next、dist 或迁移输出；
- 不为了让测试通过而弱化身份、权限、CSP、配额或数据生命周期。

完成回报必须逐项给出：
1. 任务编号与结论：完成 / 阻塞；
2. 修改文件清单及每个文件的责任；
3. 验收标准逐条对应的代码或测试证据；
4. 实际执行的完整命令、退出码和关键输出；
5. 未运行的验证、原因、残余风险与回退方式；
6. `git diff --check` 和 `git status --short` 的结果。

不能用“应该可以”“大概通过”代替证据。不得代替 Codex 勾选任务或宣布阶段完成。
```

## 五、执行顺序与并行关系

同一横行内只有标注为“可并行”的任务才能同时开发。一个任务合并并经 Codex 审核通过，
它的下游任务才解除依赖。

| 阶段                           | 串行主线                                                    | 可同时开发的支线                                                          | 阶段出口                      |
| ------------------------------ | ----------------------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------- |
| S0 基线与语音可行性            | U00 → V01 → V02 → V02-T → V03                               | U01 可在 V01-V03 期间独立进行                                             | V03 回写实证并通过，U01 通过  |
| S1 Web Canvas 与语音核心       | U02 → U03 → U04；V04 → V05                                  | U05 可与 U04 并行；V06、V07 可在 V05 后并行；Canvas 与 Voice 两线互相并行 | U05、V05、V06、V07 通过       |
| S2 媒体闭环与语音 Adapter/数据 | U06 → U07；V08 → V09；V10 → V11                             | U08 与 U07 并行；V10-V11 可与 V08-V09 并行                                | U07、U08、V09、V11 通过       |
| S3 产品接线与持久 Runtime      | V12 → V13 → V16 → V17；V14 → V15 → V17；U09 → U10/U11 → U12 | V12 可与 V14、U09 并行；U10 与 U11 并行                                   | V17、U12 通过，能力仍默认关闭 |
| S4 实验与跨入口                | U13 → U14 → U15 → U16                                       | U17、U18 可在 U16 后并行；V17 可与 U13-U18 并行                           | U17、U18、V17 通过            |
| S5 联合验收                    | U19 → U20 → U21                                             | 无                                                                        | 全部证据通过并归档            |

简化依赖图：

```text
U00 ─┬─ U01 ─ U02 ─ U03 ─┬─ U04 ─ U05 ─ U06 ─┬─ U07 ─ U08
     │                    │                   └─ U09 ─┬─ U10 ─┐
     │                    │                           └─ U11 ─┴─ U12
     │                    └──────────────────────────── U13 ─ U14 ─ U15 ─ U16 ─┬─ U17
     │                                                                        └─ U18
     └─ V01 ─ V02 ─ V02-T ─ V03 ─ V04 ─┬─ V05 ─┬─ V08 ─ V09 ─ V12 ─ V13 ─ V16 ─┐
                                ├─ V06 ─┘                                ├─ V17
                                └─ V07 ──────────────────────────────────┤
                 V03 ─ V10 ─ V11 ─ V14 ─ V15 ───────────────────────────┘

U08 + U12 + U16 + U17 + U18 + V17 ─ U19 ─ U20 ─ U21
```

## 六、原子任务

### S0：基线与语音可行性

#### U00：冻结当前基线与验收映射

- 依赖：无
- 文件边界：仅本计划的“验证台账”
- 可并行：否

```text
只做只读代码核对并更新本计划验证台账，不改源码。逐项确认本计划“已经确认的代码事实”，
记录当前 commit、证据文件和最小验证命令。Canvas 已交付项必须标为已有，语音未验证项
必须标为 pending。若事实不一致，列出差异并停止。
```

完成标准：

- 每条当前事实都有真实路径、行号或测试命令；
- 没有把文档、历史 PR 或未运行测试写成 passed；
- 只产生一份文档 diff，`git diff --check` 通过。

#### V01：原生/WASM 路线对照与选择

- 依赖：U00
- 文件边界：`tooling/voice-lab/`、本计划验证台账；不得改业务包
- 可并行：U01

```text
使用相同 16 kHz 单声道、无个人信息 WAV、采样分块和尾静音，比较 `sherpa-onnx-node`
与 `sherpa-onnx` WASM SIMD。记录 Node/arm64/package/model 版本、逐 fixture 文本、初始化、
RTF、命令与退出码；模型权重及 WAV 不提交。以仓库支持的 Node 22/24 为路线依据，Node 20
仅作兼容实验；选择能稳定输出非空文本的实现，不以更低 RTF 覆盖空文本失败。
```

完成标准：

- 同一 fixture 有原生/WASM 文本、初始化和 RTF 对照，脚本不含本地绝对模型路径；
- Node 22/24 选定路线输出非空文本，并记录原生失败或成功的真实证据；
- 未提交模型、音频、二进制或依赖缓存，并明确后续 V02 仍独立阻塞产品接线。

#### V02：课程热词最小可复现验证

- 依赖：V01
- 文件边界：`tooling/voice-lab/`、本计划验证台账
- 可并行：U01

```text
只验证热词，不接业务。V02-R 已证明 harness 配置会改变官方 WAV 的解码，但 TTS fixture
没有纠正目标术语，不能作为通过证据。V02-S 使用项目负责人本人录制并授权、但不提交 Git
的真人语音，在两个预声明双语模型、Node 22/24 和固定 score 上做单变量 before/after。
固定音频/模型/词表 SHA-256、token 规则、资源门槛与失败行为，不能事后增加有利组合或替换文本。
```

完成标准：

- 同一 profile、同一 score 必须在 Node 22/24 的 after 各 3/3 同时识别 BAGGING、BOOSTING，且 before 至少漏一个目标词；
- 进程不崩溃，热词不存在/格式错误会显式失败；
- 脚本与说明可由另一台 arm64 Mac 按步骤复现。

正式结果（2026-08-04）：项目负责人真人录音矩阵 72/72 完成且无崩溃，但结论为
`BLOCKED_MODEL`。当前 2023 双语模型未同时纠正两个目标术语且模型体积超过门槛；small
模型在 before 已包含两个目标术语，因此不满足“热词纠正”条件，且完整句存在大量错误。
证据只提交有界 JSON 摘要，原始录音、模型和逐次结果均不进入 Git。

#### V02-T：流式双语模型策略修订

- 依赖：V02-S 得出 `BLOCKED_MODEL`
- 文件边界：`tooling/voice-lab/`、ADR-0018、本计划验证台账；不得接业务
- 可并行：U01

```text
以项目负责人已授权的同一真人录音和固定 Node 22/24 环境，对 ADR-0018 指定模型或一个
官方发布、许可明确、可本地 WASM/ONNX 流式运行的双语候选做受控验证。不得降低为 TTS，
不得提交音频或模型。把“基础识别质量”和“热词带来的增益”拆成两个独立指标：模型若
before 已正确识别术语，不得因无法制造 before 错误而判失败；但 after 不得降低术语召回
或整句质量。记录来源、许可、完整模型哈希、模型体积、RTF、峰值 RSS、逐次 transcript、
目标词召回和归一化 WER。若没有候选达到门槛，维持 BLOCKED_MODEL，禁止进入 V03。
```

完成标准：

- 两个 Node 版本各 3 次稳定运行，目标词 `BAGGING`/`BOOSTING` 召回率均为 100%；
- 归一化整句 WER 不高于 0.35，after 不劣于 before；若 before 漏词，after 必须产生可重复增益；
- 模型权重不超过 250 MiB、RTF 不高于 0.5、峰值 RSS 不超过 1.5 GiB；
- 进程、错误与证据不含绝对路径、原始音频或模型字节；
- 只有全部门槛通过才可修订 V02 为 PASS 并解锁 V03，否则保持 `BLOCKED_MODEL`。

正式结果（2026-08-04）：官方 streaming Paraformer bilingual INT8 在 Node 22/24 的 baseline
各 3/3 稳定命中 `BAGGING`/`BOOSTING`，但归一化 WER 均为 0.6667。RTF
0.2246–0.2479、峰值 RSS 806,448–961,984 KiB、权重 237,202,501 bytes 均在资源门槛内。
当前 sherpa-onnx 1.13.4 在线 Paraformer 仅支持 `greedy_search`，而热词要求
`modified_beam_search`，6/6 after capability probe 均以
`hotwords_not_supported_by_profile` 明确失败。结论为 `BLOCKED_MODEL`，
`blockerCode=hotword_mode_unsupported`；这是当时的实验结论，原始证据保持不变。2026-08-05
项目负责人接受该质量风险后，V02/V03 另按产品决策收口。

#### V02-X：Notebook 权威术语表的有界纠错实验（非阻塞增强）

- 依赖：无硬依赖；不得阻塞 V03-V17
- 文件边界：`tooling/voice-lab/`、必要的纯逻辑模块与测试、本计划验证台账；不得接 UI、WebSocket 或数据库
- 可并行：U01

```text
保留本地 WASM 草稿与 TeleSpeechASR 云端终稿的原始文本，只验证一个确定性、有界的术语
纠错层。候选词只能来自当前 Notebook/课程已授权的权威术语表；只能替换完整 token，不能
让 LLM 自由重写整句，不能把全局 Begging→Bagging 之类字符串替换伪装成识别成功。
对每次替换记录原词、目标词、规则版本和可撤销标记，不保存音频、Prompt 或 Provider body。
使用 V02-W 已保存的三次结果复算，不再调用付费 Provider。
```

完成标准：

- 三次原始终稿经过同一冻结规则后，参考句中每一次 `Bagging`/`Boosting` 均正确，出现次数召回 100%，WER 不高于 0.35；
- 负例至少覆盖真实单词 `begging`/`bursting`、术语不在当前 Notebook、多个候选同距、大小写与标点边界，任何歧义都保持原文；
- 原始 transcript 与 corrected transcript 同时保留，调用方能明确区分“Provider 原文”和“术语纠错结果”；
- 纠错纯函数、相同输入确定性一致，不读取环境变量、数据库、网络或 Provider Key；
- 只有正负例、证据安全和全部质量门槛均通过，才能进入产品组合；负责人已接受 V02 的模型质量风险，本任务不再作为 V03 前置门槛。

正式结果（2026-08-05，含 REVISE 修正）：纠错层是纯函数
（`packages/agent-core/src/transcript-term-correction.ts`，ruleVersion
`educanvas.transcript-term-correction.v1`）：候选只来自调用方传入的当前 Notebook 术语表，
只替换完整 token、禁止 substring replace，模块内无任何术语硬编码；编辑距离 ≤2 且必须通过
**双侧上下文确认**（前邻与后邻都命中术语条目携带的课程 context 词，缺任一侧或未命中都保持
原文——真实句 `Begging reduces suffering.` 因此不会被误改），同距多候选保持原文。用 V02-W
已保存的三次冻结终稿复算（不调用 Provider）：每次恰一条 `bursting→boosting` 替换（tokenIndex
11、charStart 84），WER 0.3333→0.2667（≤0.35），Boosting 出现次数召回 2/2，每条 replacement
可逆且反向恢复会校验当前位置仍等于 correctedTerm（被篡改的文本拒绝“成功恢复”，抛
`REPLACEMENT_TOKEN_MISMATCH`）；`methodsbegging`（实为 `methods. Bagging` 无空格粘连）按
fail-closed 保持原文，故 Bagging 出现次数召回 1/2——负责人于 2026-08-05 确认严格 fail-closed、
不恢复粘连 token，术语召回按每术语如实报告并等待裁定。结论 `REVIEW_REQUIRED`
（blockerCode=`frozen_bagging_recall_below_100_concatenated_token`）。V02-X 是非阻塞增强：
V02/V03 已由负责人接受质量风险并标记 PASS（2026-08-05），本任务不写 v02Passed=false /
v03Unlocked=false、不阻塞 V03-V17、不自动接入产品。正负例（begging/bursting 普通词、同距候选、
空词表、术语不在词表、大小写、标点边界、句首/句尾、重复术语、超长/超限/非法版本拒绝、确定性、
可逆性、篡改拒绝、证据安全）与判定规则见 `tooling/voice-lab/test-v02-x.mjs`、
`tooling/voice-lab/v02-x-evaluation.mjs`，有界证据 `tooling/voice-lab/evidence/v02-x-summary.json`。

#### V03：回写语音可行性证据与能力门禁

- 依赖：V02 已由负责人接受残余风险并收口为 PASS
- 文件边界：ADR-0018、本计划
- 可并行：U01

```text
只根据 V01/V02 的真实证据与项目负责人明确的风险接受更新 ADR-0018 和本计划。保留
sherpa-onnx WASM SIMD 本地草稿选型，记录原生 addon 对照、热词、云端复核、尾部静音和
仍未验证项；accepted 不等于产品能力已启用，实验失败证据不得改写成成功。
```

完成标准：

- ADR 与证据一致，保留真麦克风、长流和并发未验证项；
- V02 的工程解锁必须同时记录实验事实和负责人风险接受，不能只保留其中一面；
- 不修改代码。

#### U01：Canvas 已有纵切回归基线

- 依赖：U00
- 文件边界：Canvas 协议、server adapter 和 route 的测试；只允许补缺失测试
- 可并行：V01-V03

```text
验证现有 CanvasResource、manifest、Source/Artifact adapter 和统一读取 route 的基线。
只补真正缺失的回归测试，不改协议形状或重新实现 adapter。覆盖未知 renderer、
版本不兼容、跨 Notebook/用户统一 404、私有字段不投影和缺 capability 诚实失败。
```

完成标准：

- `pnpm --filter @educanvas/canvas-protocol test && pnpm --filter @educanvas/canvas-protocol typecheck` 通过；
- Web 相关 route/adapter 测试通过；
- 旧 `PublicArtifact` 消费者仍可编译；无大批 snapshot 更新。

### S1：Web Canvas 与语音核心

#### U02：CanvasResource Web registry 组合契约

- 依赖：U01
- 文件边界：`apps/web/features/canvas/` 新 registry 模块及测试
- 可并行：V04-V07

```text
新增只消费既有 CanvasRendererManifest 与 CanvasResource 的 Web registry 组合契约。
registry 值只能引用本地受信组件，不能接受 URL、动态 import、模型源码或远程脚本。
保留旧 canvasArtifactRegistry；本任务不迁移页面、不删兼容层、不读取数据库。
```

完成标准：

- source/artifact renderer 可按 manifest 确定性选择；
- 未知 ID、版本不匹配、representation/trust/runtime/action 不兼容返回稳定 unavailable；
- registry 单元测试和 Web typecheck 通过。

#### U03：统一打开链路与兼容适配

- 依赖：U02
- 文件边界：Canvas 组合组件、资产抽屉/Studio 打开动作、对应测试
- 可并行：V04-V07

```text
让 Source 与 Artifact 从现有列表或详情通过统一资源 endpoint 取得 CanvasResource，
再进入 U02 registry。保留旧判分型 PublicArtifact 路径和既有 URL/API；先加兼容 adapter，
不搬数据访问，不修改服务端授权。请求失败、资源不支持和能力缺失都显示稳定 unavailable。
```

完成标准：

- 同一 Notebook 的 Source/Artifact 均可打开到同一 CanvasHost；
- 跨 Notebook 不复用旧资源状态，旧判分提交仍走原有可信领域服务；
- Web 组件/route 测试与 typecheck 通过。

#### U04：来源 renderer 状态与可访问性

- 依赖：U03
- 文件边界：Source renderer、其 props/测试、学生界面规范
- 可并行：V04-V07

```text
只补来源阅读体验：PDF/图片引用定位，DOCX/图片文本替代，以及文本、网页、音频、视频的
loading/empty/failed/unavailable/denied 状态。没有真实处理能力时必须显示 unavailable，
不能伪造预览。storageKey、宿主路径和签名细节不得进入 props。
```

完成标准：

- 每类状态有组件测试；键盘、焦点、aria-live 与替代文本可用；
- PDF/图片至少各有一个真实 fixture 的引用定位测试；
- `pnpm --filter @educanvas/web test` 和 typecheck 通过。

#### U05：跨 Notebook 与版本访问 E2E

- 依赖：U03
- 文件边界：`tests/e2e/canvas-resource-access.spec.ts`、最小 fixture、`docs/06-quality/03-测试与评估.md`
- 可并行：U04

```text
只验证 U02-U04 的访问与版本事实，不为测试修改权限。覆盖切换 Notebook 不串读、
跨用户/Notebook 统一拒绝、版本恢复和旧 URL 兼容。亮/暗色、移动端、外壳视觉与
焦点验收属于朋友协作线，不得在本 spec 重复。trace 使用合成数据。
```

完成标准：

- 新 spec 可独立运行，失败 trace 不含学生数据或 Secret；
- 每个身份、Notebook 与版本用例在测试文档中为 passed/failed；
- 失败时不进入 U06。

#### V04：流式转录领域 Port 与事件 schema

- 状态：`PASS`（Codex 修订后复核；agent-core 149/149、typecheck、tooling 71/71 通过）
- 依赖：V03 PASS
- 文件边界：`packages/agent-core/src/` 与测试
- 可并行：U02-U05

```text
定义供应商无关的 StreamingTranscriptionGateway、16 kHz 单声道 PCM 分片描述和
partial/final/endpoint/failed 事件。包含 protocolVersion、operationId、segmentId、
sequence、取消和唯一终态纪律。与 AudioTranscriptionModelGateway 并列，不修改后者，
契约中不能出现 sherpa/onnx、HTTP、WebSocket 或数据库类型。
```

完成标准：

- 无效采样率、声道、chunk 大小、sequence 和终态后事件被拒绝；
- agent-core 公共入口可导出，既有消费者无破坏性变化；
- agent-core test/typecheck 通过。

#### V05：增量文本归并 reducer

- 状态：`PASS`（Codex 修正跨 segment 词边界后复核）
- 依赖：V04
- 文件边界：agent-core 新的 streaming transcription reducer 与测试
- 可并行：U02-U05

```text
实现无 I/O 的 partial/final 归并纯函数。partial 可以被后续假设推翻，final 不可回退，
不同 segment 不串文本；重复、乱序和终态后事件必须得到确定结果或稳定错误。
不要加入音频库、计时器、WebSocket、React 或供应商类型。
```

完成标准：

- 追加、修正、重复、乱序、多段、final 后 partial 均有表驱动测试；
- 相同事件序列总得到相同快照；
- agent-core test/typecheck 通过。

#### V06：分段、端点与尾部 flush 纯策略

- 状态：`PASS`（Codex 复核）
- 依赖：V04
- 文件边界：agent-core 独立策略模块及测试；不得修改 V05
- 可并行：V05、V07、U02-U05

```text
实现 chunk 计数、endpoint 后拒绝新分片、finish 前补 1.5 秒零值 PCM 的纯策略。
不实现 VAD、编解码或 sherpa 调用；输出只是应喂给 recognizer 的描述和状态转换。
固定任意 chunk 边界等价、取消和尾部 flush 行为。
```

完成标准：

- 任意分片边界得到相同最终 PCM 描述；
- endpoint/cancel 后输入被拒绝；
- 有/无尾部静音差异有测试；agent-core test/typecheck 通过。

#### V07：音频双向传输 envelope

- 状态：`PASS`（Codex 修正 envelope/chunk 双序列映射后复核）
- 依赖：V04
- 文件边界：agent-core transport-neutral schema 与测试
- 可并行：V05、V06、U02-U05

```text
定义 client start/chunk/finish/cancel 与 server partial/final/endpoint/failed envelope。
每条消息含协议版本、operation/segment/sequence，chunk 有严格字节上限。
只做 schema，不实现 WebSocket，不在消息中放身份、模型路径、日志或错误堆栈。
```

完成标准：

- 未知版本、超限 chunk、乱序、重复 finish 和终态后消息均拒绝；
- schema 通过 agent-core 公共入口导出；
- test/typecheck 通过。

### S2：媒体闭环与语音 Adapter/数据

#### U06：现有媒体生成闭环审计

- 依赖：U05
- 文件边界：本计划验证台账、媒体相邻测试；只有证实缺口才可最小修复
- 可并行：V08-V11

```text
审计现有 generated_image/audio_overview 的 Provider 配置闸门、输入引用、版本、
provenance、成本/模型元数据、checksum、checkpoint、重试/取消与 crash 恢复。
禁止接第二个 Provider，禁止把已有能力重写。先形成逐项 passed/gap 证据；修复必须拆成
本任务内一个单一责任，若出现两个独立缺口就停止并请 Codex重新拆任务。
```

完成标准：

- fixture 测试与真实受控 provider smoke 明确分开；
- 缺配置能力关闭，失败不能被投影为成功；
- 每个结论有代码/测试/命令证据。

#### U07：媒体文本等价与下载/删除访问

- 依赖：U06
- 文件边界：媒体 renderer、受控读取/下载/删除 route、测试、学生 UI 规范
- 可并行：U08

```text
为图片和音频产物提供文本等价、可访问状态及服务端授权的下载/删除入口。
所有权、Notebook 归属和 allowedActions 在执行端再次校验；storageKey 和签名细节不返回。
删除后读取统一不可用，非 Web 消费者需要安全摘要。
```

完成标准：

- 本人/有权成员、viewer、跨 Notebook、删除后访问均有测试；
- 屏幕阅读器不依赖纯视觉/纯音频理解内容；
- Web/Worker 相关 test/typecheck 通过。

#### U08：媒体 Operation 终态与恢复证据

- 依赖：U06
- 文件边界：Worker/Operation/Artifact adapter 的测试及必要最小修复
- 可并行：U07

```text
只验证并修复媒体任务的 queued/running/succeeded/failed/cancelled/unknown 对账。
覆盖超时、取消、重试耗尽、版本已写但终态未写、checkpoint 恢复和重复执行。
不接 Provider、不改 UI、不创建另一套状态机。
```

完成标准：

- 每个 operation 只有一个终态，重复执行幂等；
- Worker 失败不会写成功，未知恢复状态可发现；
- Worker test/integration/typecheck 通过。

#### V08：sherpa 流式 Adapter

- 依赖：V05、V06、V07
- 文件边界：`packages/model-gateway/src/` 与测试
- 可并行：U06-U08、V10-V11

```text
用 V01 选定、并经 V02 热词验收的 WASM SIMD API 实现 StreamingTranscriptionGateway adapter。
只负责 recognizer 生命周期、PCM 喂入、事件投影、取消、超时和安全错误归一化。
先用 fake recognizer 测试，不读真实模型；不得含数据库、HTTP、UI、自动重试或 Provider
原始返回类型的公共导出。
```

完成标准：

- partial/final/endpoint/failed、取消、超时、addon 异常均有测试；
- 日志不含 PCM、转录全文、模型绝对路径或堆栈；
- model-gateway test/typecheck 通过。

#### V09：模型获取、配置和组合闸门

- 状态：`PASS`（Codex 修复真实安装与资源清理缺陷后复核通过）
- 证据（2026-08-05）：
  - manifest：`tooling/sherpa-model-manifest.json`——480ms/1920ms 官方 release URL、archive 与文件级 SHA-256、bpe.vocab 派生值、decodingMethod/modelingUnit/maxActivePaths，只读白名单，未知 profile 显式拒绝；
  - 获取脚本：`tooling/sherpa-model-fetch.mjs` + `bpe-vocab-export.mjs`——支持 GitHub Release 有界 HTTPS 跳转；先校验 archive 文件，再派生并校验 `bpe.vocab`，避免新安装在派生前失败；dry-run 零网络零写入，staging 安全解压、失败清理、原子安装与幂等均有测试；
  - 配置：`packages/model-gateway/src/sherpa-streaming-config.ts`——`STREAMING_TRANSCRIPTION_*` 默认关闭、模型与热词路径必须显式使用绝对路径；
  - 组合闸门：`packages/model-gateway/src/sherpa-streaming-gateway-resolver.ts`——fail-closed，全部 unavailable 分支有测试，校验失败时 SDK/recognizer 零创建；
  - 真实 factory：`packages/model-gateway/src/sherpa-streaming-recognizer-factory.ts`——sherpa-onnx 1.13.4 WASM 最小适配、SDK 类型留在内部；`createStream` 失败会释放已创建 recognizer；
  - 验证：model-gateway 267/267、模型获取/环境检查 40/40、完整 PostgreSQL integration 通过；全仓 typecheck、lint、tooling、`pnpm env:check`、Prettier 与 `git diff --check` 通过。真实模型识别证据沿用受控实验；模型权重仍不进入 Git。
- 依赖：V08
- 文件边界：`tooling/`、环境变量示例、model-gateway config/composition 与测试
- 可并行：U06-U08、V10-V11

```text
提供带 SHA-256 的 480ms/1920ms 模型按需获取脚本，显式配置模型与热词路径。
模型不进仓库，无默认隐式路径；缺配置或校验失败返回不可用且不创建 adapter。
脚本先支持 dry-run，不能打印 Secret；保持现有 Turn/Provider 组合不变。
```

完成标准：

- 缺配置、错路径、两种模式、checksum 不匹配和热词缺失有测试；
- dry-run 不下载，`pnpm env:check` 不打印敏感值；
- model-gateway test/typecheck 通过。

#### V10：监护人单独同意 ADR

- 状态：`PASS`（ADR-0022 已由项目负责人于 2026-08-05 accepted，V11 解锁）
- 依赖：V03 PASS
- 文件边界：新 ADR、ADR 索引、本计划
- 可并行：V08-V09、U06-U08

```text
检索 delegated_grants/guardian 现有语义，定义音频留存单独同意的主体、目的、证明记录、
生效、撤回、审计、默认关闭和本人/监护人访问边界。账号登录或一般服务条款不能替代。
只写决策，不写 schema/UI。由项目负责人 accepted，否则 V11、V14-V16 保持 blocked。
```

完成标准：

- 明确能否复用现有 guardian 关系及不能复用的字段；
- 撤回立即失效并产生删除意图，文本生命周期与音频分离；
- ADR 有负责人接受或明确 blocked。

#### V11：同意与音频留存 schema/migration

- 状态：`PASS`（Codex 安全修订后，以全新 PostgreSQL 测试库复核）
- 依赖：V10 accepted
- 文件边界：`packages/db` schema、手写迁移、约束/集成测试
- 可并行：V08-V09、U06-U08

```text
只建立音频留存记录、同意关联、创建/到期/撤回时间、对象引用和状态约束。
默认七天，配置只能缩短不能超过上界；storageKey 仅服务端字段，转录文本不存此表。
使用仓库现有迁移流程，不手改生成输出，不在本任务写 repository/worker/UI。
```

完成标准：

- 无有效同意不能创建留存记录；
- 到期上界、撤回状态、唯一性和外键行为有数据库测试；
- db test:integration/typecheck 通过，迁移可正向应用。

### S3：产品接线、留存与持久 Runtime

#### V12：Gateway 受鉴权双向通道

- 依赖：V09、V07
- 文件边界：`apps/gateway/src/` 新通道模块、组合根和测试
- 可并行：V14、U09

```text
用现有 Gateway 身份、Actor/Notebook/Operation 访问规则承载 V07 envelope。
transport 只管理连接、调用 V08 adapter 和投影事件，不创建教学 Turn。
未认证、越权、重复 finish、断连和取消必须收敛为稳定终态；日志不得记录 chunk。
```

完成标准：

- 未认证、跨主体/Notebook、断连、取消和重复终态有测试；
- 不新增第二个 Agent loop，不把身份放进客户端消息作为可信事实；
- gateway test/typecheck 通过。

#### V13：Gateway 背压、配额与资源清理

- 依赖：V12
- 文件边界：V12 通道模块的限额/测试
- 可并行：V14、U09-U12

```text
增加单连接/主体并发数、chunk/字节、时长、空闲和队列上限；超过上限稳定失败并停止接收，
不能无限缓冲。断开、取消、超时后释放 recognizer 和内存。数字与理由写入工程文档。
不修改认证、转录语义或 UI。
```

完成标准：

- 上限前正常、到达上限拒绝、清理后计数归零；
- 竞争断连/finish 只有一个终态；
- gateway test/typecheck 通过。

#### V14：留存 repository、访问审计与删除意图

- 依赖：V11
- 文件边界：`packages/db` repository、类型、集成测试
- 可并行：V12-V13、U09-U12

```text
实现留存创建、本人/监护人读取、读取审计、撤回/到期扫描和同事务写删除 Outbox 意图。
教师、普通管理员和跨主体默认拒绝；storageKey 不进入公共 DTO。
只写数据访问，不写 Worker、WebSocket、UI 或对象存储 adapter。
```

完成标准：

- 本人/监护人允许，教师/管理员/跨主体拒绝均有集成测试；
- 撤回与到期不会只改软删除状态，必须有 durable 删除意图；
- db integration/typecheck 通过。

#### V15：音频硬删除 Worker

- 依赖：V14
- 文件边界：既有对象删除 Outbox repository/worker 的最小扩展与测试
- 可并行：V13、U09-U12

```text
复用现有 Outbox claim/complete/fail/retry 模式支持音频对象。
对象已不存在视为幂等成功；删除失败可查询并退避，崩溃重启继续。
不做上传、转录或 UI；日志只含稳定 ID、objectKind 和错误码。
```

完成标准：

- 到期、撤回、对象不存在、崩溃恢复、重试耗尽五类集成测试；
- 对象实际删除后才 complete，失败不静默；
- Worker/db test:integration/typecheck 通过。

#### V16：浏览器采集与重采样工具

- 依赖：V07、V13
- 文件边界：`apps/web/features/voice/` 纯采集模块及测试
- 可并行：U09-U12、V15

```text
实现 AudioContext 麦克风采集、16 kHz 单声道 PCM 转换、chunk producer、停止与取消。
本任务不连接网络、不改 composer、不存音频；SSR 导入时不得触碰 window/navigator。
设备、权限、采样失败以稳定结果返回，清理 tracks、node 和 context。
```

完成标准：

- fake AudioContext 覆盖采样格式、chunk 边界、权限失败、停止和重复清理；
- SSR 测试可导入；浏览器端不持久化 PCM；
- Web test/typecheck 通过。

#### V17：短句输入、课堂字幕与能力总闸门

- 依赖：V13、V15、V16、V05
- 文件边界：`features/voice/`、composer/字幕入口、最小 BFF、测试与文档
- 可并行：U13-U18

```text
接入两种 UI：短句模式显示 partial，endpoint/松开后只把 final 文本交给既有 Turn 输入；
课堂字幕显示 partial 并追加 final，但绝不自动发起 Turn。两者共用采集、连接和 reducer。
只有模型配置、adapter、有效监护人同意、留存 repository 和删除 Worker 均健康时才显示入口。
权限拒绝、无设备、连接失败、能力关闭和撤回必须可读；浏览器不存音频。
```

完成标准：

- 组件测试覆盖 partial 修正、多段、模式切换、断线、撤回和清理；
- fixture E2E 证明短句只提交一次既有 Turn，字幕零次提交；
- 缺任一能力时入口隐藏/禁用且原因明确；Web test/typecheck 通过。

#### U09：持久 Web Runtime 威胁模型与 ADR

- 依赖：U08
- 状态：`PASS / accepted`
- 文件边界：ADR、安全测试矩阵、本计划
- 可并行：V12-V17

```text
区分现有轻量 srcdoc 预览与持久、版本化 Tier 2 Runtime。定义无同源、无 Cookie/Credential、
无默认网络、无嵌套/表单/导航、白名单消息、依赖供应链、配额、取消、审计和学习事实隔离。
只写决策，不写 Runtime；项目负责人 accepted 后才解锁 U10-U12。
```

完成标准：

- 列出资产、攻击者、信任边界和安全负例；
- 说明与 sandbox-preview 的复用/隔离边界；
- ADR accepted 或明确 blocked。

#### U10：WebRuntimePort 与消息桥契约

- 依赖：U09 accepted
- 状态：`PASS`
- 文件边界：核心/Canvas protocol 与测试
- 可并行：U11、V13-V17

```text
定义版本化 WebRuntimePort、host→sandbox 与 sandbox→host 白名单消息、启动/取消/终态、
CPU/时长/输出上限和安全错误。只定义契约，不写 iframe 或执行用户代码。
未知版本/消息、重复终态、超限和越权动作必须拒绝。
```

完成标准：

- schema 与状态机测试覆盖安全负例；
- 契约不含 React、DOM、数据库或远程 URL；
- canvas-protocol test/typecheck 通过。

#### U11：审计依赖与资源策略

- 依赖：U09 accepted
- 状态：`PASS`
- 文件边界：允许依赖清单、锁定版本、守卫测试和安全文档
- 可并行：U10、V13-V17

```text
定义首批允许的前端运行依赖及固定版本、包体/文件/输出上限和 CSP。
依赖只能来自仓库审计清单，不允许运行时 npm install 或远程 CDN。
本任务不实现 Runtime，不随意新增包。
```

完成标准：

- 守卫接受精确允许集合并拒绝包名相似、版本漂移和未声明依赖；
- 网络保持 none，策略数字有理由；
- tooling test 与相关 typecheck 通过。

#### U12：最小持久隔离 Runtime Adapter

- 依赖：U10、U11
- 状态：`PASS`
- 当前事实：独立 `apps/web-runtime`、Runtime routes、`web_runtime_runs` 账本、
  服务端权威 bootstrap/terminal 边界、真实 composition 和 R28 压力门禁均已实现。
  `tests/e2e/web-runtime-composition.spec.ts` 使用真实 Web、独立 Runtime 进程和隔离
  PostgreSQL 验证不可变 Artifact Version、跨主体 404、bootstrap 一次性领取、
  terminal-before-bootstrap 与重复 terminal 拒绝；R28 另行验证非合作 CPU/内存负载下
  Host 响应、OOPIF 回收与干净替换。
- 文件边界：独立 Runtime adapter、Canvas 最小组合、测试
- 可并行：V15-V17

```text
只运行一个版本化探索 Artifact，落实 U10/U11 的隔离、消息、取消和配额。
不能访问主页面 DOM、Cookie、Credential、宿主文件或网络；Tier 2 事件不能写学习事实。
保留现有轻量 HTML preview，不把两个生命周期混为一体。
```

完成标准：

- DOM/同源/网络/导航/依赖逃逸、超限、取消和错误协议有自动化负例；
- reload 后引用同一不可变版本，reduced-motion 可用；
- Web test/typecheck/build 和受控浏览器 smoke 通过。

**U12 收尾原子顺序：**

```text
U12-R0 分支对齐
  → U12-R1 composition 编排
  → U12-R2 权威 bootstrap/terminal 与拒绝矩阵
  → U12-R3 进程取消、崩溃和 R28
  → U12-R4 全量验证与 Codex 审计
```

- `U12-R0`：只读比较 `feat/20260729-u12-origin-runtime`、最新 `origin/main` 和保留 stash。
  保留 PR #250 的 CI 可信度门禁，不把旧 workflow、Playwright 配置或共享 E2E 覆盖回去。
- `U12-R1`：新增正式 `playwright.runtime-composition.config.ts` 与
  `tests/e2e/web-runtime-composition.spec.ts`；启动真实 Web、独立 `apps/web-runtime`
  和隔离 PostgreSQL，禁止用 mock server 或同页 `srcdoc` 冒充 composition。
- `U12-R2`：证明同一主体/Notebook/Artifact Version 可以 bootstrap 且只产生一个权威
  terminal；跨主体、跨 Notebook、伪造 version/hash、terminal-before-bootstrap、
  重复 terminal 与终态后消息必须 fail closed。
- `U12-R3`：证明取消、Runtime 崩溃、Web reload 和非合作 CPU/内存负载后进程可回收，
  Host 仍可响应；所有子进程必须由 composition teardown 清理，不能遗留端口或 PID。
- `U12-R4`：运行 DB integration、Runtime/Web 单元与 typecheck、tooling、production build、
  composition 和 R28；任何数据库/端口环境阻塞必须记为 BLOCKED，不能用单元测试替代。

**交给开发 Agent 的提示词：**

```text
只执行 U12 当前指定的一个 R 子任务。所有 shell 命令以 rtk 开头，不创建临时 worktree，
不触碰 UI worktree，不开始 U13。先读取 AGENTS.md、ADR-0019、U10/U11 契约和本 U12
现状，再比较最新 origin/main 与 feat/20260729-u12-origin-runtime。

硬门禁：
- 保留 PR #250 的 failOnFlakyTests、forbidOnly、Worker 日志审计、对象存储 fixture 和
  CI concurrency；旧 stash 中冲突的 CI/Playwright 文件不得整份覆盖；
- composition 必须使用真实 Web + 独立 Runtime 进程 + 独立 PostgreSQL；
- 不允许同页 srcdoc、mock Runtime 或只有 stress spec 的替代证据；
- Host/Runtime 消息继续使用 U10 版本化协议，依赖和资源上限继续使用 U11；
- 不泄露 Cookie、Credential、prompt、Source 私有内容、objectKey、宿主路径或 stack；
- 一个文件接近 400 行即评估拆分，禁止产生超过 600 行的手写源码；
- 不 git add/commit/push/merge，完成后交给 Codex 审计。

回报必须列出：任务编号、基线 SHA、修改文件单一职责、每条验收标准对应测试、实际命令
与退出码、未运行项、安全边界、残余风险、回退方式、git diff --check/name-status/status。
不得自行宣布 U12 PASS。
```

### S4：实验与跨入口

#### U13：ExperimentRuntimePort 与 Run 契约

- 依赖：U12
- 状态：`PASS`
- 文件边界：核心 Port、Run/输入/输出/provenance schema 与测试
- 可并行：V17

```text
定义无网络、CPU-only、固定环境的 ExperimentRuntimePort。Run 含输入挂载、代码版本、
依赖、随机种子、资源预算、取消、终态和输出 Artifact 引用。
schema 明确拒绝 GPU、自定义镜像、宿主路径、未声明输入和默认联网。
```

完成标准：

- Run 状态机与非法能力有测试；
- 输出只引用有界 Artifact，不内嵌无限日志/文件；
- 相关 test/typecheck 通过。

#### U14：无网络 CPU Experiment Adapter

- 依赖：U13
- 状态：`PASS`
- 文件边界：单一 experiment adapter、部署配置、测试
- 可并行：V17

```text
实现一个固定依赖环境的 CPU adapter，落实时间、内存、进程、输出和取消上限。
不暴露 shell、宿主路径、Secret 或网络；输入只读挂载，输出经校验后进入对象存储。
不做 GPU、包安装、自定义镜像或 UI。
```

完成标准：

- 网络尝试、fork/资源超限、超时、取消、输出超限和崩溃恢复有测试；
- 清理后无孤儿进程/临时数据；
- adapter test/typecheck 和隔离 smoke 通过。

#### U15：实验 Canvas renderer

- 依赖：U14
- 状态：`PASS`
- 文件边界：Canvas experiment renderer、props/测试
- 可并行：V17

```text
展示代码、输入引用、Run 状态、有限日志、表格/图表和完整 provenance。
宿主错误、路径和内部对象键不得进入浏览器；运行中、取消、失败、成功、不可用均可访问。
renderer 不负责执行或修改 Run。
```

完成标准：

- 所有状态和超长输出截断有组件测试；
- 键盘、屏幕阅读器、暗色/移动端可用；
- Web test/typecheck 通过。

#### U16：可复现实验 smoke

- 依赖：U15
- 状态：`PASS（2026-08-04，Codex 复核）`
- 文件边界：一个最小实验 fixture、运行说明、质量证据
- 可并行：V17

```text
运行一个小型 CPU 数据/ML 实验，记录代码、固定依赖、输入 checksum、随机种子、
资源、输出 checksum 和重复结果。必须在干净环境重跑，证明无网络/GPU。
只交付一个实验，不扩展教学产品功能。
```

完成标准：

- 两次运行得到声明的确定结果或有界容差；
- 超限/取消负例也有证据；
- 不提交大数据、模型权重或机器绝对路径。

#### U17：TUI Canvas 资源交接

- 依赖：U16
- 文件边界：`apps/tui` client/renderer/测试和文档
- 可并行：U18、V17

```text
让 TUI 复用公共 CanvasResource，只列出、打开文本支持项或提供安全 Web 交接。
不复制 Web renderer、不新增 Agent loop；未知/不支持/无权限资源诚实 unavailable。
一次性交接不能泄露私有内容或 storageKey。
```

完成标准：

- source/artifact/runtime 各有支持或降级测试；
- 身份/Notebook 归属与 Web 一致；
- TUI test/typecheck 通过。

#### U18：非 Web 渠道安全降级

- 依赖：U16
- 文件边界：channel projection、测试和文档
- 可并行：U17、V17

```text
为不能渲染的 Canvas/实验/媒体状态输出有界摘要、受控媒体或安全交接。
不发送私有版本内容、原始 Prompt、objectKey 或长期 bearer 链接。
只改投影，不改 Channel adapter 身份或 Agent Runtime。
```

完成标准：

- processing/ready/failed/unavailable/archived 均有投影测试；
- 不支持的 Runtime 不假装执行；
- 相关 test/typecheck 通过。

### S5：联合验收与归档

#### U19：跨入口 Operation 与能力一致性

- 依赖：U08、U12、U16、U17、U18、V17
- 文件边界：conformance tests 与必要的最小投影修复
- 可并行：否

```text
用同一组 fixture 验证 Web、TUI、渠道看到相同的资源/Operation 终态、能力开关和错误码。
覆盖取消、超时、失败、未知、恢复、语音未配置/撤回同意和 Runtime 不支持。
不得通过降低某入口权限来追求一致。
```

完成标准：

- 每个入口对同一事实给出相同稳定状态或明确安全降级；
- 终态后无事件，跨 Notebook/主体均拒绝；
- conformance test 与 typecheck 通过。

#### U20：真实环境 smoke 与安全复核

- 依赖：U19
- 文件边界：质量证据、必要 bugfix 必须另拆任务
- 可并行：否

```text
只执行验收，不在本任务混入功能开发。Canvas 运行真实持久沙箱和 CPU 实验 smoke；
语音由项目负责人使用真实麦克风、课堂噪声、专业术语、10 分钟连续流和受控并发进行。
记录机器、浏览器、日期、配置、命令、结果、资源曲线和限制。DeepSeek 不得伪造人工证据。
发现缺陷时停止，创建新的单一职责修复任务，再重新执行 U20。
```

完成标准：

- WASM SIMD 热词、真麦克风、长流、并发、撤回/到期硬删除均有真实证据；
- Canvas DOM/网络/依赖逃逸负例和实验资源上限有证据；
- 安全复核确认无 Secret、PCM、原始 Provider 响应或学生数据泄漏。

#### U21：双方 PR 联合审计、全量门禁与归档

- 依赖：U20；F00-F05 已合并并归档
- 文件边界：canonical 文档、ADR、计划索引和归档文件；不再改功能代码
- 可并行：否

```text
先由 Codex 对双方已合并 PR 做文件所有权、重复实现、组合回归与视觉回归联合审计。
通过后运行仓库 lint、typecheck、unit、tooling、integration、build、目标 E2E 和安全复核。
把已实现稳定事实回写产品、架构、数据、工程、质量和运维文档；压缩本计划，只保留
实际范围、偏差、遗留项和证据，移入 docs/plan/completed/ 并更新索引。
任何必需门禁失败都保持 active，不能为结档改成“已知问题”。
```

完成标准：

- `pnpm lint`、`pnpm typecheck`、`pnpm test:unit`、`pnpm test:integration`、
  `pnpm build`、目标 `pnpm test:e2e` 均有可复现通过记录；
- 所有 ADR 与 canonical 文档只描述已实现事实；
- active 中不再有被本计划替代的 Canvas/语音重复计划。

## 七、Codex 单任务审核协议

DeepSeek 每交付一个任务，Codex 按以下顺序审核并只给出一种结论：

1. **PASS**：范围、实现、测试、安全与文档全部满足，可合并并解锁下游；
2. **REVISE**：目标正确但存在明确可修复缺口，仍停留在当前任务；
3. **BLOCK**：依赖、决策、环境或方案不成立，禁止开始下游。

每次审核必须检查：

- `git diff --name-status` 是否越过文件边界，是否覆盖用户既有改动；
- 代码是否复制第二套协议、Runtime、Agent loop、状态机或数据事实；
- 输入验证、身份/Notebook/allowedActions、稳定错误和隐私边界；
- 测试是否真的执行、是否先验证失败路径、是否用 mock 冒充 live smoke；
- 单文件职责和体积，接近 400 行评估拆分，非机械/生成文件不得超过 600 行；
- `git diff --check`、任务指定 test/typecheck，以及风险相称的上游回归；
- 完成标准逐条有证据，未验证项没有被写成完成。

Codex 审核报告固定格式：

```text
任务：<编号和名称>
结论：PASS / REVISE / BLOCK
范围检查：<证据>
功能与边界：<证据>
测试结果：<实际命令、退出码>
发现：
- <按严重度排序；没有则写“无阻塞发现”>
下游状态：<已解锁任务或仍被阻塞任务>
```

## 八、阶段验收条件

- [ ] U00-U21、V01-V17 全部获得 Codex PASS；
- [x] F00-F05 全部获得 Codex PASS，且开发期与 UV 主线文件无交集；
- [ ] ADR-0018 与音频同意 ADR 均 accepted，未验证项没有被隐去；
- [ ] Source/Artifact/Runtime/Experiment/Voice 在身份和 Notebook 边界上没有旁路；
- [ ] 语音能力默认关闭，缺模型、缺同意、缺删除 Worker 时不能进入产品；
- [ ] 音频到期和撤回硬删除、失败可发现、读取可审计；
- [ ] Canvas Tier 2 无同源/网络/Credential，Tier 3 无网络、CPU-only、硬配额；
- [ ] Web、TUI、渠道的终态一致或诚实安全降级；
- [ ] 真实 Canvas Runtime、实验、麦克风、噪声、长流、并发 smoke 有证据；
- [ ] 全量门禁通过，稳定事实回写，计划移入 `completed/`。

## 九、验证台账

**历史起始基线：** `39a0c5fb5a5c81fcbffd54899764ac64e2cdf944` (2026-07-28)。
2026-07-30 的现状审计已改用最新主线与独立 U12 分支；领取任务时仍须重新记录
`origin/main`，不得把历史基线当作当前 HEAD。

**S0 状态：** Canvas 子线 passed（U00/U01）；语音 V01 passed，V02 的模型质量缺口已由
项目负责人在 2026-08-05 明确接受为非阻塞风险，V02/V03 passed。S0 整体通过，V04 与
V10 已解锁；产品能力仍默认关闭，不能把风险接受误写成发布验收。

**S1 状态：** Canvas 子线 passed（U02-U05）；语音 V04-V07 passed。reducer 保留跨 segment
词边界，transport envelope 与 PCM chunk 使用显式双序列，首个 PCM 分片稳定映射为 sequence 0。

**S2 状态：** 媒体子线 U06-U08 passed；Provider/版本/投影、文本等价、受控下载与可靠删除，
以及 Operation 终态、取消、重试耗尽、checkpoint 与重复投递恢复均已复核。语音 V10-V11
passed：同意证明、十二个月上限、七天留存、不可变审计事实、并发撤回与物理删除保护已由
真实 PostgreSQL 验证；V08 Adapter 与 V09 模型获取/组合闸门也已复核，S2 收口。

**S3 状态：** Canvas 子线 U09-U12 passed；ADR-0019、版本化消息/Port 契约、依赖白名单、
CSP、资源策略、独立 origin/process Runtime、真实 Web + Runtime + PostgreSQL
composition 与 R28 压力门禁均已通过。语音侧 V14/V15 已完成留存访问、删除意图与硬删除
恢复闭环；下一步从 V12 开始 Gateway 接线，S3 尚未通过，语音入口继续保持关闭。

**S4 状态：** U13 契约、U14 无网络 CPU Adapter 与 U15 实验 Canvas Renderer 已通过复审。Adapter 仅运行固定 digest 的
Python CPU 环境，使用 Docker `--network none`、只读文件系统、降权能力、资源预算、输入
checksum 材料化、输出复核、单终态收敛与强制容器清理；不在 Docker 不可用时降级伪装隔离。
Renderer 只消费严格、有界且与终态 provenance 一致的浏览器安全视图模型，覆盖代码、输入、
配置、预算、有限日志、表格/图表输出和完整 provenance，不执行 Run，也不暴露对象键、宿主路径或堆栈。
U16 已用固定 Python 3.11 digest、固定代码/CSV/随机种子与资源预算完成两个独立容器的逐字节
一致 smoke；网络与 GPU 不可用、timeout、cancel、stdout quota 和容器清理均有真实证据。
该 smoke 仍是测试 fixture，不是生产 `artifact.experiment` 数据源，因此 Renderer 未伪接入 registry。
U17/U18 已完成：TUI 通过 bearer 鉴权 Gateway 读取当前 Notebook 的真实 CanvasResource
目录并使用短期一次性交接；Telegram 按可信绑定重新加载 Artifact 投影，只发送有界状态摘要，
不执行 Runtime，也不发送正文、Prompt、对象键或长期链接。S4 的 Canvas 子线已完成，阶段出口
仍等待语音 V17。

| S0 任务 | Codex 结论        | 证据                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U00     | `PASS`            | 基线事实、提交与验证映射已复核                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| U01     | `PASS`            | Canvas protocol 58/58、Web 385/385、两侧 typecheck 通过；资源访问边界测试覆盖身份与 Notebook 参数                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| V01     | `PASS`            | 相同 16 kHz WAV、100 ms 分块、1.5 秒尾静音下，Node 22/24 WASM SIMD 均 4/4 非空、RTF 约 0.12；原生 Node 20/22/24 均 0/4，故否决原生路线                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| V02     | `PASS`            | 模型实证仍显示质量缺口：V02-W 的 `TeleAI/TeleSpeechASR` 3/3 成功且 WER=0.3333，但两处 `Bagging`/`Boosting` 各只正确一次。项目负责人于 2026-08-05 明确接受该残余风险，选择“WASM 本地草稿 + 可选云端复核”路线并解除工程依赖；实验摘要保持原始 blocked 结论，不篡改证据。                                                                                                                                                                                                                                                                                                                  |
| V02-T   | `BLOCKED_MODEL`   | Node 22/24 baseline 各 3/3 稳定；RTF/RSS/体积通过，但 6/6 hotword probe 以 `hotwords_not_supported_by_profile` 失败，未达到产品门槛。                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| V02-X   | `REVIEW_REQUIRED` | 纯函数术语纠错层（`packages/agent-core/src/transcript-term-correction.ts`，双侧上下文确认）复算 V02-W 三次冻结终稿：每次恰一条 `bursting→boosting`（tokenIndex 11），WER 0.3333→0.2667 ≤0.35，Boosting 召回 2/2、replacement 可逆且反向恢复校验篡改；`methodsbegging` 粘连按 fail-closed 保持原文致 Bagging 召回 1/2（负责人 2026-08-05 确认严格 fail-closed、不恢复粘连 token），blockerCode=`frozen_bagging_recall_below_100_concatenated_token`。V02-X 为非阻塞增强，不写 v02Passed=false/v03Unlocked=false、不阻塞 V03-V17、不改变 V02/V03 的 PASS 状态（负责人 2026-08-05 标记）。 |
| V03     | `PASS`            | ADR-0018 与本计划已回写本地草稿、云端复核、负责人风险接受及仍未验证项；V04 与 V10 解锁，但产品语音门禁继续默认关闭。                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

| S1 任务 | Codex 结论 | 证据                                                                                                                                                                                                                                                                  |
| ------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U02     | `PASS`     | Web registry 使用私有 WeakMap 与冻结 handle；26 条相邻测试、Web 442/442、typecheck 与 Prettier 全部通过                                                                                                                                                               |
| U03     | `PASS`     | Source/Artifact 的 Studio、对话产物卡与生成状态卡统一先读取 CanvasResource 并进入 registry；Source 实际消费选中的本地 Renderer；Notebook 切换在 layout effect 前后均拒绝旧请求，Artifact 保留受控详情兼容链                                                           |
| U04     | `PASS`     | SourceResourceRenderer 已接入生产打开链；9 条组件测试与 12 条状态/fixture 测试覆盖 loading/empty/failed/unavailable/denied/ready、重试按钮、aria-live/aria-busy、媒体文字替代及 PDF/PNG 受控 URL 定位                                                                 |
| U05     | `PASS`     | Codex 在隔离 `educanvas_e2e` 数据库与生产 webpack 构建上复跑 2/2：统一打开、跨 Notebook/用户 404、v2→v1→v2、旧 Source/Artifact URL 和 PublicArtifact 判分均通过                                                                                                       |
| V04     | `PASS`     | 供应商无关流式 Port、16 kHz mono PCM 与 partial/endpoint/final/failed 契约已导出；Codex 补齐 finish 后输入的独立稳定码、纯空白文本拒绝和错误消息泄漏边界。Agent Core 18/18 files、149/149 tests，typecheck、tooling 71/71 与 Prettier 通过。                          |
| V05     | `PASS`     | 增量 reducer 对 partial/final、幂等重放、乱序、终态与多 segment 严格隔离；Codex 修复 segment 直接拼接造成的 `Baggingand boosting` 词边界破坏。                                                                                                                        |
| V06     | `PASS`     | 输入侧纯策略固定 chunk 从 0 连续、endpoint/cancel 后拒绝输入，并把 1.5 秒尾部静音拆为受上限约束的描述；不持有 PCM、不实现 VAD 或供应商调用。                                                                                                                          |
| V07     | `PASS`     | transport-neutral start/chunk/finish/cancel 与 server 事件 envelope 已导出；Codex 将消息 sequence 与 PCM chunkSequence 显式分域，首个 envelope chunk 映射为 V06 sequence 0。Agent Core 合计 21 files/228 tests、typecheck 通过。                                      |
| V08     | `PASS`     | sherpa WASM SIMD Adapter 已实现 PCM16LE 转换、partial/endpoint/final 投影、1.5 秒尾部 flush、唯一终态与 recognizer 单次释放。Codex 修复 finish 后取消被吞、recognizer getter 异常泄漏和 acceptWaveform 拒收未处理；Model Gateway 214/214、typecheck 与 tooling 通过。 |

| S2 任务 | Codex 结论 | 证据                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U06     | `PASS`     | 图像/语音缺关键 Provider 时诚实关闭；结构化脚本未配置时按既有设计降级为带审计字段的规则脚本。Provider 边界、Source 归属、不可变版本、模型元数据、MIME/checksum、受控读取与 checkpoint 恢复均已复核；审计发现并修复媒体 CanvasResource provenance 置空问题，只投影可信来源、operation 与净化后的 provider/model。Worker 单元 16/16、model-gateway 129/129、Web 相邻测试 27/27、DB 集成 12/12、Worker 媒体集成 8/8 通过；真实付费 Provider smoke 未授权且未运行。取消、超时、重试耗尽与 unknown 对账不在 U06 提前宣告完成，保留给 U08。                                                              |
| U07     | `PASS`     | Codex 复审并修正媒体 manifest 动作契约、contributor 只读投影、归档列表过滤、并发删除锁、下载 byteSize 校验及删除后的本地列表失效；图像使用 figure/figcaption 与公开元数据 alt text，音频文字稿始终可读；下载和删除均在服务端重新授权，归档与 deletion outbox 同事务。Web 539/539、Worker 91/91、DB unit 21/21、tooling 55/55、完整 PostgreSQL integration、22 workspace typecheck 与 lint 均通过。                                                                                                                                                                                                 |
| U08     | `PASS`     | Codex 真实 PostgreSQL 复审发现并修复媒体 helper 与外层对同一 generation job 二次追加版本的问题；音频、图像及结构化产物现统一通过 `appendVersionAndCompleteGenerationJob` 在单一事务中写不可变版本并结算 succeeded，版本来源固定绑定已锁定的 jobId。queued/running/terminal 状态、取消竞争、retry exhausted、existingVersion、音频/图像 checkpoint、重复投递及 unknown 浏览器投影均有证据，取消竞争测试不再吞 Worker 异常。Worker unit 99/99、Worker integration 35/35、DB integration 202/202、Web adapter 18/18、tooling 55/55 及 DB/Worker/Web typecheck 通过；独立复审无剩余 HIGH/MEDIUM 问题。 |
| V10     | `PASS`     | Codex 完成技术与合规边界复审并修订 ADR-0022；项目负责人于 2026-08-05 接受。实时处理、本地留存、云端转录三项分别授权；普通录音按产品政策作为敏感数据处理；所有非 adult/unknown 暂按需监护人同意；delegated_grants 不能证明监护关系；原始音频只允许本人/已验证监护人读取；留存音频复用 asset_version 与既有删除 Outbox。V11 已解锁，V14/V15/V16 继续等待各自正常前置依赖。                                                                                                                                                                                                                           |
| V11     | `PASS`     | 新增独立同意证明方式与受控证明引用，self/guardian 形态由数据库约束；同意默认且最多十二个月、音频最多七天。留存创建锁定 active consent，避免与撤回并发穿透；同意/留存身份与期限不可变、禁止物理删除且用户/版本外键 restrict。DB unit 26/26、V11 integration 16/16、完整 PostgreSQL integration 246/246、DB typecheck、24 workspace typecheck、lint 与 tooling 通过。                                                                                                                                                                                                                                |
| V14     | `PASS`     | 留存 Repository 已实现本人/已验证监护人读取、同事务审计、撤回/到期扫描与 durable 删除意图。Codex 修复跨主体/非音频版本绑定及冲突回显越权，撤回后所有主体立即 fail closed，并使用数据库时钟判定同意；V14 集成 24/24，干净隔离库完整 DB integration 270/270、DB unit 26/26、typecheck 与 tooling 通过。                                                                                                                                                                                                                                                                                              |
| V15     | `PASS`     | 复用既有删除 Outbox 完成撤回/到期音频的真实硬删除、对象不存在幂等、退避、租约恢复、并发单领取与第 10 次失败终态。Codex 增加测试数据库后缀硬门禁，修复 `processing + attempts=100` 再领取会违反约束并回滚整批的问题：上限行现在原子收敛为可发现的 `failed`，同批健康行继续领取。13 条 V15 真实 PostgreSQL + 隔离对象存储测试、Worker integration 全量、DB integration 275/275、DB unit 51/51、Worker unit 106/106、typecheck、lint 与 tooling 通过；集成测试拆为场景与共享环境两个单职责文件。                                                                                                      |

| S3 任务 | Codex 结论 | 证据                                                                                                                                                                                                                                                                                                                                                                                  |
| ------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U09     | `PASS`     | ADR-0019 与 28 条安全负例经 Codex 技术复审，补齐服务端权威边界、不透明 origin 的实例凭据、既有协议上界、统一 `cancelled`/failure code 语义及非合作负载门禁；项目负责人 @Timcai06 于 2026-07-29 accepted，U10/U11 解锁并可并行。                                                                                                                                                       |
| U10     | `PASS`     | `WebRuntimePort` 与 v1 消息契约已定义；Host/Sandbox 方向、channel/runtime/Notebook/Artifact Version/hash、连续 sequence、单一终态与取消竞态均 fail closed。错误面只允许稳定码，不接收 prompt、Source、objectKey、stack 等自由字段；状态快照冻结。Canvas protocol 87/87、Agent core 36/36、两侧 typecheck、tooling 55/55 与 lint 通过。                                                |
| U11     | `PASS`     | 首批依赖锁定为仓库已安装的 React 19.2.7、React DOM 19.2.7、GSAP 3.15.0、Three 0.185.1；未知、typo、范围、tag、URL 与重复依赖均拒绝。策略固定 network none、iframe 仅 allow-scripts、严格 CSP、512 KiB 输入、64 KiB 消息、1 MiB 输出、30 秒、2 并发、8 队列与 30 msg/s；明确不宣称硬 CPU/内存隔离。相关测试已包含在 Canvas protocol 87/87，tooling/typecheck/lint 通过。               |
| U12     | `PASS`     | 独立 `apps/web-runtime`、运行账本、受控 routes 与 Canvas 组合已完成；真实 Web + 独立 Runtime + PostgreSQL composition 3/3、R28 非合作 CPU/内存压力 2/2、DB integration 5/5、Runtime 8/8、Canvas protocol 87/87、Web 583/583、tooling 62/62、相关 typecheck、lint 与 production webpack build 通过。bootstrap 只领一次，terminal 必须在 bootstrap 后写入且首终态胜出；跨主体统一 404。 |

| S4 任务 | Codex 结论        | 证据                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U13     | `PASS`            | 初版契约的复审缺口已修订：终态 result/provenance、终态事件完整性、精确 SemVer、日志 Artifact 上界和模块职责拆分均有回归覆盖；Agent Core 16 files/121 tests、typecheck、Prettier 与 diff check 通过，U14 已解锁。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| U14     | `PASS`            | 固定 digest Python CPU Adapter 已实现网络/权限/文件系统隔离、输入哈希材料化、资源和输出上限、单终态与清理；Experiment Runtime 94/94（含 5 个真实 Docker smoke）、Agent Core 121/121、Tooling 66/66、24 workspace typecheck 与 lint 通过，U15 已解锁。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| U15     | `PASS`            | 新增严格有界的实验 Canvas 视图模型与纯展示 Renderer；状态、终态/provenance 一致性、代码/日志/表格/图表截断、安全失败、键盘操作和无生产假接线由 17 条相邻测试覆盖；Web 658/658、24 workspace typecheck、lint 与 Tooling 通过，U16 已解锁。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| U16     | `PASS`            | 固定 digest Python 3.11 回归实验在两个独立容器中产生逐字节一致的 metrics/predictions；代码、输入、输出 checksum 与随机种子已记录，真实网络/GPU、timeout、cancel、quota 和清理均通过。Experiment Runtime 96/96、目标 smoke 两次独立命令均 2/2、typecheck 通过；真实取消测试同时修复 Node AbortError 抢占终态的竞态。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| U17     | `PASS`            | 公共非 Web 判定与 Gateway CanvasResource 目录已接线；TUI `/canvas` 按 bearer 主体和当前 Notebook 重新授权，切换 Notebook 清空缓存，文本保留受控读取边界，其余资源只签发两分钟一次性 Conversation 交接。Canvas protocol、Gateway、Gateway Client 与 TUI 目标测试及 typecheck 通过。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| U18     | `PASS`            | Telegram 实际投递链按可信账号/线程绑定重新读取 Artifact CanvasResource，processing/ready/failed/unavailable/archived 与 Runtime 降级均有测试；摘要不超过 600 字符，不投影正文、Prompt、provenance、对象键或 bearer URL。Channel 与 Telegram 目标测试及 typecheck 通过。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| V12     | `REVIEW_REQUIRED` | Gateway 受鉴权 WebSocket 双向流式转录通道已实现（V12 模块：`streaming-transcription-{wire,channel,ws-transport,ticket}.ts`）。**Codex 四阻塞项已修订**：①握手凭证改为 60 秒单次使用、绑定用户+Notebook 的 WebSocket ticket（`POST /v1/client/streaming-transcription/tickets` 经 HTTPS 签发；`ticket.*` 子协议或 `Authorization: Bearer` 携带），长时 session bearer 不再进 `Sec-WebSocket-Protocol`，并严格校验浏览器 Origin（`EDUCANVAS_GATEWAY_WS_ALLOWED_ORIGINS` 白名单，无 Origin 的非浏览器允许，拒绝 403；**REVISE 项已修订**：默认白名单改为本地 Web `http://127.0.0.1:3101`/`http://localhost:3101`，`.env.example` 已增加配置项，Origin 与配置项均严格规范化——拒绝带路径/凭据/非法 URL，握手 Origin 先规范化再比对；`streamingTranscriptionEnabled` 同时要求模型可用与 client transport 可用；`unhandled_upgrade` 日志只记固定稳定标签）；②通道投影前复用 V04 事件序列验证器（唯一终态/endpoint 纪律），违约 adapter 的双合法终态只投影一个 + close(1011)；③upgrade handler 无条件注册，client transport 关闭时返回稳定 503 CLIENT_TRANSPORT_DISABLED；④协议违规立即 abort 未终态 Session，不等 WS close handshake（防恶意客户端拖延占用识别器）。身份只来自服务端认证上下文，`requireNotebookAccess` 重新绑定校验 Notebook，客户端伪造身份/Notebook/角色字段被 V07 strict schema 拒绝；通道层增量复用 V07 序列验证器（历史只存元数据不持 PCM）、disconnect 经 abort 取消，唯一终态收敛；resolver unavailable 时 503 且不创建 recognizer。全部 V12-E 验收用 fake resolver/session 覆盖（真实 WASM 不加载），wire/通道/transport/ticket 测试 137/137（gateway 全量）、typecheck、Prettier、tooling 与 `git diff --check` 通过；未提交、未推送、未接真实 Provider，等待 Codex 复审。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| V13     | `REVIEW_REQUIRED` | Gateway 背压、配额与资源清理已实现。**O(n²) 消除**：agent-core 新增 `StreamingTranscription{ClientMessage,Event}SequenceTracker` 增量验证器（单条 O(1)、不存历史数组、违约即锁存；穷举前缀等价性测试证明与批量验证器语义一致），通道改为增量验证并删除 `MAX_RECEIVED_MESSAGES` 历史上限。**资源上限**（集中命名常量 + fail-closed 环境变量，见 `apps/gateway/src/streaming-transcription-quotas.ts`，数值与理由见该文件注释）：每用户 2 连接、每用户+Notebook 2 连接、全局连接 32、全局并发 recognizer 8（REVISE 第二轮拆为两类租约）、单连接 duration 10 分钟、idle 60 秒（配置强制 idle<duration，deadline 顺序确定）、累计 PCM 1_920_000 字节（60 s×32 KB/s）、chunk 4_096、输入队列 64、输出 bufferedAmount 256 KiB、单帧 128 KiB（沿用 V12）；非法配置启动失败。**租约协调器** `StreamingTranscriptionQuotaManager`（REVISE 第二轮：**双租约**——socket lease 握手成功后申请、只在实际 close/error/terminate 释放（连接存在期间始终计入，客户端拖延 close 不能建立超额连接）；session/recognizer lease 在 start、创建 recognizer 前申请、Session 终态形成即释放（不等连接关闭/迭代器结束，adapter 终态后挂起也不占槽））；超限 HTTP 429 `CONNECTION_LIMIT_EXCEEDED` 且 `beginStreaming` 零调用；两类 lease 各自幂等释放，握手升级中途 TCP 中断由 socket 一次性兜底释放（不泄漏槽位）；**Codex REVISE 已修订**：正常终态（final/failed 已投影）由通道 `onTerminal`（只触发一次）通知 transport 立即以 1000 主动关闭（**无毫秒静默窗口**；终态后尚未进入 Channel 的网络帧不保证再返回协议错误，违约审计独立于关闭码），客户端收到终态后不关连接也不能永久占槽；adapter 违约（schema/序列/迭代器异常/无终态结束）先 `abort` 底层 recognizer 再 1011 关闭并释放；输出背压改为"当前缓冲 + 本帧字节"超限即拒发（最后一帧不再突破上限）；ticket 签发不占槽；能力关闭（resolver null）时不申请槽位。**背压**：输入有界队列满 → `INPUT_BACKPRESSURE_EXCEEDED`；待发送字节超限 → `OUTPUT_BACKPRESSURE_EXCEEDED`；均 abort 未终态 Session（唯一终态在服务端收敛）+ 稳定错误帧 + close(1008)，不把部分成功伪装成正常转录。**稳定错误码面**：`CONNECTION_LIMIT_EXCEEDED`/`SESSION_LIMIT_EXCEEDED`/`SESSION_DURATION_EXCEEDED`/`SESSION_IDLE_TIMEOUT`/`INPUT_BYTE_LIMIT_EXCEEDED`/`INPUT_CHUNK_LIMIT_EXCEEDED`/`INPUT_BACKPRESSURE_EXCEEDED`/`OUTPUT_BACKPRESSURE_EXCEEDED`；日志只含 label/code/operationId/segmentId/notebookId。验收用 fake clock + fake ws + 注入配额全量覆盖（上限边界、释放重连、adapter 失败不泄漏槽位、日志脱敏、非法配额 fail closed、能力关闭不分配槽位、双租约生命周期解耦、拖延 close 不超连、迭代器挂起不占槽、close/error/terminal 竞争两类 lease 各释放一次）：gateway 全量 196/196（V13 新增 59 个，含 REVISE 两轮回归）、agent-core 276/276、typecheck（24 包 tsc 全部通过；`pnpm typecheck` wrapper 退出码 1 为 pnpm 对 turbo 的退出码传播怪癖，`turbo typecheck` 直接执行 exit=0，已由 Codex 确认）、build、tooling 93/93、lint、env:check、Prettier、`git diff --check` 通过；未提交、未推送、未接真实 Provider，等待 Codex 复审，未替 Codex 宣布 PASS。 |

| 能力                       | 当前状态  | 当前证据                                                                                                                                                                                | 完成任务                   |
| -------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| CanvasResource/manifest    | `passed`  | `packages/canvas-protocol/src/resource.ts:1-296`<br>`renderer-manifest.ts:1-69`                                                                                                         | 已有，U01 防回归           |
| Source/Artifact 服务端投影 | `passed`  | `apps/web/server/canvas/source-resource-adapter.ts:13-103,177-235`<br>`artifact-resource-adapter.ts:18-65,114-187`                                                                      | 已有，U01 防回归           |
| Web 统一 registry/打开     | `passed`  | Source/Artifact 统一 endpoint、registry、CanvasHost 与兼容 adapter 已接线；旧 PublicArtifact 判分路径保持独立且 E2E 通过                                                                | U02-U05 passed             |
| 媒体生成闭环               | `passed`  | U06-U08 已确认图像/音频 Provider、版本、元数据、净化 provenance、受控读取、文本等价/下载删除、原子终态及 checkpoint/重复投递恢复闭环                                                    | U06-U08 passed             |
| 持久 Web Runtime           | `passed`  | ADR-0019、独立 Runtime、运行账本、受控组合、真实 PostgreSQL composition 与 R28 压力门禁均已通过                                                                                         | U09-U12 passed             |
| Experiment Runtime         | `passed`  | U13 Port/Run 契约、U14 隔离 CPU Adapter、U15 有界 Renderer 与 U16 可复现实验 smoke 已通过；测试 fixture 不伪装成生产数据源，Renderer 仍未接入缺少真实来源的 registry                    | U13-U16 passed             |
| TUI/渠道 Canvas            | `passed`  | Gateway 提供按 bearer 主体和 Notebook 重新授权的 CanvasResource 目录；TUI `/canvas` 使用一次性交接，Telegram 按可信绑定输出有界摘要且不执行 Runtime                                     | U17-U18 passed；U19 待 V17 |
| WASM SIMD 流式识别与热词   | `passed`  | V01 已选定 WASM SIMD；本地与云端的专业术语质量缺口由负责人明确接受为非阻塞风险，原始证据仍保留                                                                                          | V04-V09                    |
| 流式 Port/Gateway/UI       | `partial` | V04-V09 的领域契约、reducer、分段策略、Adapter、模型配置与组合闸门已通过；V12 已实现 Gateway 受鉴权 WebSocket 双向通道（fake 验证，未接真实模型）；Gateway 与 UI 接线完成前保持 partial | V12-V13、V16-V17           |
| 音频同意与可靠删除         | `passed`  | V10/V11/V14/V15 已完成同意、留存 Repository、审计、删除意图与可靠硬删除闭环                                                                                                             | —                          |
| 联合发布证据               | `pending` | 尚未执行                                                                                                                                                                                | U20-U21                    |

### 已确认的代码事实明细

| #   | 事实                                            | 文件路径                                               | 行号    | 验证命令                                                              |
| --- | ----------------------------------------------- | ------------------------------------------------------ | ------- | --------------------------------------------------------------------- |
| 1   | Canvas 统一资源协议已存在                       | `packages/canvas-protocol/src/resource.ts`             | 1-296   | 定义 canvasResourceKinds, canvasRepresentationKinds, canvasTrustTiers |
| 2   | Renderer manifest 与兼容判定已存在              | `packages/canvas-protocol/src/renderer-manifest.ts`    | 1-69    | rendererSupportsResource() 函数                                       |
| 3   | Source 投影已覆盖 PDF、图片、文本、DOCX、音视频 | `apps/web/server/canvas/source-resource-adapter.ts`    | 13-103  | SOURCE_RENDERERS 映射                                                 |
| 4   | Artifact 投影已覆盖结构化与媒体产物             | `apps/web/server/canvas/artifact-resource-adapter.ts`  | 18-65   | ARTIFACT_RENDERERS 映射                                               |
| 5   | 统一资源读取会复核身份、Notebook 和归属         | `apps/web/server/canvas/resource-access.ts`            | 1-194   | requireNotebookAccess 调用                                            |
| 6   | Web 主 Canvas 仍消费旧 PublicArtifact           | `apps/web/features/canvas/canvas-panel.tsx`            | 7-53    | CanvasPanel 接收 PublicArtifact 类型                                  |
| 7   | Web 静态 registry 仍只注册三类旧产物            | `apps/web/features/canvas/canvas-registry.tsx`         | 349-360 | canvasArtifactRegistry 只有 classification_game, pipeline_flow, quiz  |
| 8   | 轻量 HTML 消息预览已有 CSP 和 iframe 限制       | `apps/web/features/canvas/sandbox-preview.ts`          | 1-75    | SANDBOX_CSP 和 SANDBOX_IFRAME_PERMISSIONS                             |
| 9   | 图像 Provider、校验和、checkpoint 和恢复已存在  | `apps/worker/src/tasks/image-artifact-generation.ts`   | 17-188  | imageCheckpointSchema, ImageArtifactGenerationFailure                 |
| 10  | 当前音频 Port 只有整段一次性转录                | `packages/agent-core/src/model-gateway.ts`             | 191-196 | AudioTranscriptionModelGateway 接口                                   |
| 11  | Composer 的语音按钮仍被禁用                     | `apps/web/features/composer/composer.tsx`              | 165-174 | disabled title="语音输入即将开放"                                     |
| 12  | 对象硬删除已有 Outbox 模式                      | `packages/db/src/object-deletion-outbox-repository.ts` | 1-115   | DrizzleObjectDeletionOutboxRepository                                 |

### 语音可行性状态

| 能力         | ADR 状态 | 代码状态                       | 阻塞原因                                                                                                                     |
| ------------ | -------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| WASM SIMD    | accepted | **执行引擎已选定，工程已解锁** | V02-S/V02-U 已完成真人录音矩阵；模型质量缺口保留为已接受风险，产品仍默认关闭                                                 |
| 原生 addon   | accepted | **否决**                       | Node 20/22/24 均 0/4 空文本                                                                                                  |
| 热词         | accepted | blocked                        | small-bilingual-int8 热词可重复增益有效，但整句 WER 超限                                                                     |
| 云端复核文本 | accepted | real-provider，带已知质量限制  | V02-W 的 `TeleAI/TeleSpeechASR` 3/3 成功、WER=0.3333，但两处目标术语各只正确一次；仅在同意和配置成立时启用，失败保留本地草稿 |
| 真麦克风     | accepted | 部分验证                       | 已用负责人真人录音；实时浏览器采集与课堂噪声仍未测试                                                                         |
| 长时间连续流 | accepted | 未验证                         | 未测试                                                                                                                       |
| 并发         | accepted | 未验证                         | 未测试                                                                                                                       |

**V01 验证详情（路线选择）**:

- 环境: sherpa-onnx-node / sherpa-onnx 1.13.4，Node.js 20.20.2、22.23.1、24.18.0，arm64
- 模型: sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20
- 方法: 相同官方 WAV、16 kHz 校验、100 ms 分块、1.5 秒尾部静音与 inputFinished()
- 结果: 原生在三个 Node 均 0.wav–3.wav 空文本；WASM 在 Node 22/24 均 4/4 非空、RTF 约 0.12，选择 WASM SIMD 路线
- 决策: V02-S/V02-T/V02-U/V02-W 的失败证据全部保留；项目负责人于 2026-08-05 接受专业术语质量风险，采用“WASM 本地草稿 + 可选云端复核”双路径。V02/V03 passed，V04 与 V10 解锁；V12-V17 仍按正常依赖等待

不得在此表记录密钥、原始音频、学生数据、未授权教材或不可复现的口头结论。
