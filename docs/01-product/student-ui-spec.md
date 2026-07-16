# 学生端核心 UI/UX 规格

- 状态：`accepted`
- 相关文档：[产品定义](./product-definition.md)、[Canvas与GSAP](../02-architecture/canvas-and-gsap.md)、[智能体编排](../03-ai/agent-orchestration.md)

## 产品界面方向（2026-07-16 定调）

- **只有一个界面**：产品第一身份是多模态输入输出的 AI Agent，AI 老师是第二身份。教学上下文（课程、进度、判分）在用户问到相关内容时按需激活，不存在"K12 学习模式"这类显式模式切换入口；
- 功能与交互模式直接学习 Gemini（对话骨架、Canvas 同界面分栏容器、「+」菜单）与 NotebookLM（持久来源面板、引用），不自行发明复杂交互；
- Canvas 不是抽屉：桌面端在对话右侧以分栏容器展开（沙箱预览与判分型 Artifact 同此形态），窄屏升级为全屏浮层；
- 课程标题、掌握度等教学信息收进按需面板，不常驻头部；
- `/learn` 独立页将并入 `/` 统一界面（迁移需同步教学 Turn 接入与 learning-flow E2E 重写，见平台计划）。

## 定位判断标准

打开 EduCanvas 时，学生首先感受到的是「一位正在带我学习的 AI 老师」：对话是课堂，文件和图片是老师使用的教材，Slide、视频和互动实验是老师按需生成的教学产物。Canvas 重要，但不比对话更像产品本体。

交互结构学习 Gemini（对话中心、输入栏「+」统一入口、Canvas 按需分屏）与 NotebookLM（Sources/Chat/Studio 职责三分、回答带来源引用、产物卡片），不复制其品牌视觉。

## 五类对象的层级

| 对象            | 角色                           | UI 归宿                                           | 常驻               |
| --------------- | ------------------------------ | ------------------------------------------------- | ------------------ |
| Chat            | 核心交互、导航入口、教学控制面 | 页面主体 + 底部输入栏                             | **是（唯一常驻）** |
| Assets 知识资产 | 输入与依据                     | 输入框上方可移除标签 + 右侧抽屉；回答中的来源标签 | 否                 |
| Canvas          | 正在进行的教学互动             | 右侧协作面板，约 40:60 可拖拽 / 全屏 / 收起       | 否，按需           |
| Studio 本课产物 | 教学产物集合                   | 顶栏「本课产物」抽屉 + 消息流内产物卡片           | 否                 |
| Progress 进度   | 服务端可信状态的轻量映照       | 可信投影存在时显示掌握度入口，点击展开抽屉        | S0 不显示          |

## 布局状态机（纯 UI 状态，与教学脊柱状态机无关）

- **S0 Chat-empty（当前会话没有消息）**：参考 Gemini 的空白会话起点，仅显示轻量品牌栏、居中问候和单一输入框；不预置老师消息、不提前展开课程状态、来源标签或 Canvas。首条消息发送后进入 S1；已有消息的会话刷新后直接恢复 S1；
- **S1 Chat-only（对话已开始）**：对话列居中（约 42rem），输入栏吸底；顶栏恢复课程和已有可信数据对应的掌握度/产物入口。教学阶段在 runtime 投影接入前隐藏，禁止硬编码“练习”；
- **S2 Chat + Canvas**：Canvas 右侧展开，默认 40:60，中缝可拖拽（对话 28%–62%）、支持全屏与收起；当前可由本课预置产物卡或「+」菜单的“打开本课互动演示”进入，真实 Artifact 提案链路接入后再增加 AI 建议确认卡；
- **学习记录 Rail**：桌面端默认折叠为窄 Rail、由学生主动展开；移动端使用模态 Sheet。列表只消费服务端 `initialSessions`，当前项使用 `aria-current`；没有数据时展示空态，搜索、分页、新建和恢复入口只有真实能力与回调同时存在时才出现；
- **抽屉层**：Learning Rail / Assets / Studio / Progress 共用模态 Sheet（窄屏为底部 Sheet），同屏最多一个，互斥由 `LearnWorkspace` 保证；
- **移动端（<lg）**：默认完整 Chat；Canvas 为全屏 `dialog`，打开时 Chat/顶栏进入 `inert`、焦点约束在 Canvas 内，Escape/关闭后归还入口并恢复原对话滚动位置；禁止压缩桌面分栏。桌面分栏保持 `region`，仅全屏时升级为模态 `dialog`。

状态转换动效统一 GSAP（`useGSAP()` 独立 scope、只用 transform/opacity、尊重 `prefers-reduced-motion`、SSR 不执行）。

## 输入栏（Composer）

自上而下三层：上下文标签行（已启用资产，可移除）→ 输入行（「+」｜多行文本框｜语音占位｜发送/停止）→ 非播报状态行。单独的屏幕阅读器播报区只在 Turn 开始、完成、失败时更新，不逐 token 播报。

- Enter 发送、Shift+Enter 换行；文本框自增高至约 6 行后内部滚动；
- 空白态输入栏位于页面视觉中心；学生输入内容后，语音占位切换为发送按钮，发送后输入栏平滑回到底部对话态；
- 「+」菜单保留两组八项目标能力的信息架构，但当前仅“打开本课互动演示”可执行；上传、资料选择、链接、AI 生成 Slide/测验等未接能力明确 `disabled`，不进入 roving focus；可用项支持 ↑↓/Enter/Esc；
- “打开本课互动演示”只打开课程预置 Artifact，不称为 AI 创建。真实“请老师创建”必须先产生结构化提案和学生确认卡，不能从自由文本静默生成大产物；
- 未建设能力不触发动作、不产生上下文标签，也不出现伪装成功。无 Provider 时统一显示“AI 老师暂时无法连接，请稍后重试”，不暴露 SDK、模型或服务端术语。
- 发送后只消费服务端 SSE 的真实 `message.delta`，禁止浏览器定时器、假 typing dots 或完整文本切片；收到 `turn.accepted` 后才显示 Stop，Stop 必须调用取消端点；失败、取消或中断消息提供内联重试，并生成新的 `clientMessageId`；

## AI 老师对话体验

- 老师消息不用气泡（头像 + 正文直接落在页面上），学生消息是页面唯一气泡；
- 老师主动提问、一次推进一个学习目标；回答可附来源标签；
- 建议打开 Canvas 前先在对话中征询（〔打开互动演示〕〔继续文字讲解〕）；
- 生成的产物在消息流留下可重新打开的产物卡片；
- 判分结果的数字一律来自服务端反馈 DTO，前端与脚本不得自行判断对错；
- 界面零技术术语（不出现 Artifact、Schema、受控组件等字样），老师也不得对学生自称"受控教学智能体"这类内部术语；
- 表达温度规范：UI 界面元素一律使用 SVG 图标（Phosphor），不用 emoji；老师消息文本不使用 emoji，需要表达情绪时使用轻量颜文字（如 (＾▽＾)、(・ω・)），每条消息至多一处，不堆叠。该约束进入教学系统提示词（turn-answer prompt v4 起）。

## 当前视觉基线（深色 Halo v2）

- token 定义在 `apps/web/app/globals.css` 的 `@theme`：深色 `--color-canvas`、分层的 `--color-surface` / `--color-surface-strong`、靛蓝强调色与独立的 good/warn/bad 语义色；
- `html`声明`color-scheme: dark`，Chat、Canvas与抽屉共用同一套深色语义token；正文和展示字体当前都使用Inter/PingFang等系统无衬线回退；
- 消息直接落底、输入栏为深灰胶囊、Canvas为深色浮层；组件必须通过token取色，禁止散写色值；
- S0 使用近黑背景、三层错位低透明度蓝/紫光场与暗部 vignette。渐变和 blur 固定在静态子层，GSAP 只动画 wrapper 的 `transform`/`opacity`；页面 hidden 时暂停、visible 时恢复；`prefers-reduced-motion` 不创建无限 Timeline；移动端隐藏紫色 bloom，只保留静态 haze 与单个动画 core；
- Halo 是 EduCanvas 自己的视觉实现，只参考“输入优先、暗部包围、无硬边”的质感原则，不复制 Gemini 品牌色值或精确几何参数。自动化快照、动效性能边界与人工复核清单统一维护在[视觉回归与动效验收](../06-quality/visual-regression.md)。

## 阶段一实现边界

- 正常学习页已经切断`features/chat/demo-teacher-script.ts`依赖；浏览器通过固定 Route 消费供应商无关 SSE，消息和终态由服务端账本恢复；无可用 Provider 时显示明确的不可用状态，不返回关键词规则或固定老师话术；
- 浏览器状态机覆盖`pending / streaming / completed / failed / cancelled / interrupted`，刷新恢复服务端持久化消息；首版不承诺逐 token 断点续传。确定性脚本只允许留在单元测试、E2E Fixture或明确标识的离线Demo模式；
- PDF/图片上传、不可变Asset版本、消息Part、课程资料FTS、Turn快照、候选白名单和引用SSE/UI已经接通；用户上传Asset尚未统一进入可检索Source/Chunk链路，当前文本Provider也不能原生理解图片；
- 判分、掌握度、进度全部走既有 Server Action 可信链路，客户端不自算；
- 引用已进入学生端事件投影，但当前仍按检索候选落库，尚未绑定最终回答实际使用的claim/span；Agent生成Artifact的提议、确认、独立生成和真实Studio列表仍未实现，相关入口继续保持不可用或准确标注为预置。

## 验收标准

1. `/learn` 的无消息会话默认 Chat-empty：无预置对话、桌面 Learning Rail 默认折叠、居中输入栏可直接发起第一轮；发送后进入 Chat-only，刷新恢复已持久化消息；
2. Canvas 当前仅经预置产物卡/「+」的可用项打开；可拖拽调宽、全屏、收起；
3. 「+」菜单八项目标齐全，未接项 disabled 且跳过键盘漫游，唯一可用项全键盘可达；
4. 只有服务端确认ready且当前Provider可消费的Asset才能选择；引用必须来自本轮候选白名单，UI不得暗示未索引的上传资料已经进入RAG；
5. 产物抽屉可重新打开预置产物；进度入口只在 S1 且存在可信投影时出现；
6. 既有判分闭环回归：提交 → 服务端判分 → 反馈 → 进度更新（Playwright e2e）；
7. 移动端默认完整 Chat，Canvas 全屏打开、关闭恢复上下文；
8. 对比度 ≥ 4.5:1、焦点可见、`prefers-reduced-motion` 降级、抽屉与移动/全屏 Canvas 的 dialog/inert/焦点归还语义完整；
9. 320px 与 200% 缩放无横向溢出；分隔条暴露 `aria-valuemin/max/now/text` 并支持方向键。
10. SSE 只渲染真实 delta；Stop 调用真实取消端点；重试使用新的 `clientMessageId`；自动滚动仅在学生接近底部或刚发送时发生，生命周期播报不包含 token 文本。

## 开放问题

- Canvas 宽度是否需要跨会话记忆（当前仅会话内）；
- 语音输入的技术选型与开放时机；
- 参数确认卡的最终交互（依赖第二种可生成产物落地）。
