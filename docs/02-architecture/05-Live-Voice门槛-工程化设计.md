# Live Voice 门槛（茶室的躙り口）工程化设计

状态：已接受（本地）
范围：Live Voice 进出转场、会话带回、空间身份数据层（M1–M4）

## 0. 背景与设计公理

产品方向：EduCanvas 是"一张会理解、会回应、会展开知识的智能学习桌面"（活的书案）。
Live Voice 是能量最高的独立沉浸空间（茶室），与书案分离但**不能失忆**。门槛设计的
目标：进入时桌面语境可见地随用户进入语音空间；退出时对话痕迹带回桌面。

| 公理 | 工程不变量（可验收） |
|---|---|
| 空间连续 | 任何打开/关闭由相位机驱动的时间线完成；禁止裸条件渲染切换。reduced-motion 下转场瞬时完成，但数据交接路径一字不差 |
| 因果可见 | 转场的每段位移必须回答"元素从哪来、到哪去"；纯氛围动画违反 DESIGN.md §6，不允许 |
| 能量有节奏 | 环境循环动画只允许存在于 Voice 内；桌面默认零环境运动 |

## 1. 现状诊断（代码探查结论）

| 维度 | 现状 | 差距 |
|---|---|---|
| 进入 | `liveOpen` boolean → 条件渲染 → `dialog.showModal()`；入场 GSAP 时间线已有 | 入场与桌面无空间关系 |
| 退出 | `closeLive()` 直接 unmount，无退场动画 | 全部 teleport 感来自这里 |
| 语境带入 | `freezeLiveVoiceContext()` 仅用于发送，视觉层吃 live props | 数据已冻结，视觉未交接 |
| 会话痕迹 | transcript 由 messages 派生 + baseline 过滤，关闭时蒸发 | 无带回 |
| 空间身份 | artifacts/assets 双层版本完备；CanvasResource 协议统一引用 | 无布局持久化、无标注实体（`annotate` 空挂） |
| 动效基建 | GSAP + `motionDuration()` token + `useReducedMotion` + Sheet 进退场范式 | 全部可复用 |

关键利好：`VoiceComposer` 是普通工作区（ConversationPane）与 K12 工作区
（LearnWorkspaceSession）共用入口——门槛改造是单一改动点。

## 2. 门槛相位机

`apps/web/features/voice/live-voice-threshold.ts`：

```ts
type LiveVoiceThresholdPhase = 'desk' | 'entering' | 'voice' | 'exiting';
// 合法迁移：desk→entering→voice→exiting→desk
// 异常迁移：entering→desk（连接失败，元素原路退回）
//          voice→exiting（任何时刻允许，含 speaking 中）
```

纪律：

- `entering` 完成前不得触发 voice session `start()`；`speech.prepare()` 预热与转场并行。
- `exiting` 是不可中断单向时间线（Esc/遮罩/关闭按钮汇入同一 `exit()` 路径），
  结束后才卸载——照搬 Sheet "先动画后卸载" 范式。
- 退场时间线不依赖任何网络请求：带回数据先组本地 payload，动画与写库并行。

## 3. 入室：FLIP 交接

1. 捕获：点击瞬间记录启动按钮与入选语境资产 chips 的 `getBoundingClientRect()`
   （`data-asset-id` 选择器），与 `freezeLiveVoiceContext()` 同帧执行。
2. 飞行：proxy 元素（previewUrl 缩略图）从捕获 rect 飞到 Visual Stage rail 目标位，
   只动 `transform/opacity`，到位交叉淡入真实 item 后销毁。
3. 成形：orb 从按钮位置放大浮现；遮罩从 0 淡到现有纸色混合，桌面保持挂载。
4. `<dialog>` 保留（焦点圈禁 / aria-modal / Esc 语义），动画叠加其上。

## 4. 出室与带回

`live-voice-bring-back.ts`：

```ts
interface LiveVoiceExitPayload {
  sessionTranscript: readonly LiveVoiceTranscriptEntry[]; // baseline 过滤派生
  annotations: readonly ResourceAnnotationDraft[];        // M2
  touchedArtifactIds: readonly string[];
}
```

- 信笺（M1）：sessionTranscript → `kind:'note'` artifact（save_note 版本路径），
  `createdByOperationId` 关联语音 operation，经 `agent_message_parts` 写
  `artifact_ref` 进入对话流。不调 LLM、不新造实体；乐观渲染，失败撤回。
- 圈点（M2）：Voice 内聚焦资产点按圈画 → `ResourceAnnotationDraft`（归一化坐标）
  → `resource_annotations` 表 → 桌面朱砂渲染在原物上。
- 产物归位：`touchedArtifactIds` 退场后驱动 `WorkspaceSurface` 打开对应面板。

## 5. 数据模型变更

`resource_annotations`（M2 建）：`id, space_id, resource_kind('asset'|'artifact'),
resource_id, resource_version_id?, author_subject_id, author_pen('dai'|'zhusha'),
kind('circle'|'underline'|'strike'|'note'|'seal'), geometry jsonb（归一化 0..1 +
page/region）, body?, source('voice'|'canvas'|'chat'), operation_id?, created_at`。
归属 packages/db，遵循 spaceId + ownerSubjectId 模式；用户可删自己与 Agent 的标注。

`notebook_surface_positions`（M3 建）：`(space_id, resource_kind, resource_id)` 主键，
`zone('center'|'periphery'|'margin'), x/y/z 归一化, rest_state('open'|'folded'|'pinned'),
updated_at`。运行期客户端 reducer 是事实源，变更防抖快照落库。

## 6. 动效与性能纪律

- 只动 `transform/opacity/filter`；时长走 `motionDuration()` token。
- reduced-motion：运动瞬时，信笺照样落纸、数据照样回写——降级的是运动，不是连续性。
- 字幕由 Web Audio 时钟驱动不变；退场动画等数据，不是数据等动画。
- 预算：入室/出室 ≤ `hero`（900ms）；单帧一条主时间线 + 音频 reactive `quickTo`。

## 7. 分期与验收

- M1 门槛：相位机 + 入室 FLIP + 出室时间线 + 信笺带回。验收：任何进出路径无硬切；
  入场失败桌面零残留；信笺出现在对话流与画布；reduced-motion 数据行为一致。
- M2 圈点：Voice 圈画 + resource_annotations 全链路 + 桌面朱砂渲染。
- M3 案面：notebook_surface_positions + 静置态 + 摆案。验收：重开 notebook 恢复布局。
- M4 呼吸/墨迹：相位驱动桌面环境层 + 工具砚台指示。验收：桌面默认零环境运动。

## 8. 风险

1. 时间线与 unmount 竞态：参照 VoiceSessionController settled 模式，单一时间线
   所有者 + cleanup `kill()`。
2. 两个工作区资产栏结构不同（AssetItem vs controller assets），FLIP 捕获层需适配抽象。
3. 长语音会话信笺体积：note 落全量，对话流 artifact_ref 渲染需折叠态。
