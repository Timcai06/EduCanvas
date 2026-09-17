# AI 产物显示优化

- 任务分配名：`AR AI 产物显示优化`
- 状态：`completed`
- 负责人：hzlgou
- 实现执行：项目负责人 + 协作 Agent，每次只领取一个原子任务
- 最后验证时间：2026-09-17
- 归档时间：2026-09-17
- 参考依据：[docs/research/2026-08/04-08 外部实现参考调研](../../research/00-研究说明.md)、[Issue #477](https://github.com/Timcai06/EduCanvas/issues/477)
- 文档 PR：[#478](https://github.com/Timcai06/EduCanvas/pull/478)（不阻塞实施）

## 一、目标

在不改 canvas-protocol Schema、不引入新依赖、不触信任边界的前提下，把五个内容驱动
Artifact 渲染器的「读体验」补齐到外部优秀实现的水位：

- **mind_map**：层级配色一眼分清分支、semanticRole 可视化徽标、可见缩放控件、折叠后代计数；
- **slides**：notes 备注可见（N 键切换）、scaleX 进度条可点击跳页、O/Esc 总览网格；
- **flashcards**：3D 翻面（reduced-motion 降级）、Space 翻面 + 数字键二元自评、进度条与实时计数、洗牌；
- **markdown_document/note 只读路径**：TOC + scroll-spy、阅读进度条、只读态隐藏编辑区、修复引用块裸样式；
- **picturebook**：rotateY 翻页过渡（降级淡切）、swipe 手势、点状条可点击、相邻页预加载。

约束继承自调研结论：动画全部走 `gsap.matchMedia` 或 CSS transition 并支持
`prefers-reduced-motion`；渲染器入口重过公开 Schema 的纪律不变；模型产出不可信，
不执行任意 HTML/JS。

## 二、原子任务与依赖

| 编号 | 任务 | 依赖 | 关键文件 |
| --- | --- | --- | --- |
| AR00 | 共享基元：受控进度条（scaleX）、`useSwipeGesture`（30px/60px/250ms 三条件）、Kbd 芯片、motion.ts 时长约定 | 无 | `apps/web/features/canvas/` 新基元 + `features/theme/motion.ts` |
| AR01 | **色板 token 扩展**：`--color-branch-1..5`（light/dark 双套）+ callout 类型→token 映射表。⚠️ 设计决策点，色值需负责人确认 | 无 | `apps/web/app/globals.css` |
| AR02 | Flashcards：单布尔状态机翻面、键盘分态守卫、进度条+计数徽标、洗牌、按键提示 | AR00 | `flashcards-renderer.tsx` + 测试 |
| AR03 | Picturebook：GSAP rotateY 翻页、swipe、可点击 dots、相邻页预加载、书脊阴影 | AR00 | `picturebook-renderer.tsx` + 测试 |
| AR04 | Slides：备注内嵌面板（N 键）、进度条可点击跳页、总览网格（O/Esc）、页码 c/t | AR00 | `slides-renderer.tsx` + 测试 |
| AR05 | MindMap：L1 取模配色+子树继承、semanticRole 徽标、缩放控件浮层、折叠后代数角标、折叠视口锚定补偿 | AR01 | `mind-map-renderer.tsx`、`mind-map-layout.ts` + 测试 |
| AR06 | MD 只读路径：TOC 构建（CJK slug 去重）+ scroll-spy（容器化 offsetTop 扫描+点击暂停高亮）、阅读进度条、只读态瘦身 | AR00 | `note-renderer.tsx`（或拆 `markdown-document-view.tsx`）+ 测试 |
| AR07 | Callout 渲染（=Issue #477）：remark 插件识别 `> [!type](+/-)? 标题?`、components.blockquote 映射预注册组件、畸形标记降级、引用块裸样式顺带修复、安全契约回归（href 剥离/script 转义在 callout 内仍生效） | AR01 | `features/chat/math-markdown.ts`、新 callout 组件 + 测试 |
| AR08 | Callout 生成端：`markdown-document-generation.ts` 与 note 生成 prompt 补语法约定 + 真实模型联测证据 | AR07 | worker 生成任务 + 联测记录 |
| AR09 | 全量收口：lint/typecheck/test、五渲染器手动走查、分波 PR 合并 | 全部 | — |

## 三、关键路径与排期

**关键路径：AR01 → AR07 → AR08。**
理由：AR08 的生成端联测依赖真实模型调用（外部依赖、结果不可完全离线复现），是唯一
无法用本地测试闭环的长杆；而它的前置 AR01 色板决策同时阻塞 AR05。因此 AR01 必须
第一天锁色值，AR07/AR08 排最后但预留缓冲。

其余四条链（AR00→AR02/03/04、AR00→AR06、AR01→AR05）互相独立，可并行或按中断
随时换手。

建议排期（单人节奏，半天粒度；Agent 协作时 D2-D4 可压缩为一天）：

| 日 | 上午 | 下午 |
| --- | --- | --- |
| D1 | AR00 基元 + **AR01 色板决策落地** | AR02 Flashcards |
| D2 | AR03 Picturebook | AR04 Slides |
| D3 | AR05 MindMap | AR06 MD 只读优化 |
| D4 | AR07 Callout 渲染层 | AR07 安全契约回归 |
| D5 | AR08 生成端 prompt | AR08 真实模型联测 + AR09 收口 |

## 四、PR 切分（每波独立可回滚）

| PR | 内容 | 对应任务 |
| --- | --- | --- |
| PR-A | 交互增强波：共享基元 + Flashcards + Picturebook | AR00/02/03 |
| PR-B | Slides 备注与总览 | AR04 |
| PR-C | MindMap 视觉分层 | AR05 |
| PR-D | MD 只读优化（TOC/进度/瘦身） | AR06 |
| PR-E | Callout 完整闭环（对应 Issue #477，含生成端） | AR07/08 |

## 五、风险登记

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| 色板色值属设计决策，owner 未拍板 | 阻塞 AR05/AR07 两条线 | D1 给出默认方案（基于 accent 紫系外扩 5 色相）请求确认，先落 CSS 再调值 |
| 键盘快捷键与画布既有 keydown 冲突（MindMap 方向键、全局快捷键） | AR02/AR04 回归 | 各任务开工前盘点同屏 keydown 注册表；监听挂组件根元素而非 window |
| 生成端联测不过（模型不稳定输出 callout 标记） | AR08 卡关 | 渲染层（AR07）先行合并；prompt 单独迭代，畸形标记已有降级兜底 |
| 总览网格在嵌入小面板下不可用 | AR04 返工 | 验收标准含窄面板（<640px）截图走查 |
| 实施期间 main 前进（调研期间已发生 #470-476 前车之鉴） | 现状描述过期、冲突 | 每个 PR 分支开工前从最新 main 切出并重验目标文件 diff |

## 五之二、交付状态（2026-09-16 回写）

索引表此前长期写作「AR00-AR09 PENDING」，与仓库事实不符：AR00-AR08 已分三个
PR 合并进 `main`，只剩 AR09 收口。对照如下。

| 编号 | 状态 | 合并载体 |
| --- | --- | --- |
| AR00 共享基元 | 已合并 | [#481](https://github.com/Timcai06/EduCanvas/pull/481) |
| AR01 色板 token | 已合并 | [#481](https://github.com/Timcai06/EduCanvas/pull/481) |
| AR02 Flashcards | 已合并 | [#481](https://github.com/Timcai06/EduCanvas/pull/481) |
| AR03 Picturebook | 已合并 | [#481](https://github.com/Timcai06/EduCanvas/pull/481) |
| AR04 Slides | 已合并 | [#481](https://github.com/Timcai06/EduCanvas/pull/481) |
| AR05 MindMap | 已合并 | [#481](https://github.com/Timcai06/EduCanvas/pull/481) |
| AR06 MD 只读路径 | 已合并 | [#481](https://github.com/Timcai06/EduCanvas/pull/481) |
| AR07 Callout 渲染 | 已合并 | [#483](https://github.com/Timcai06/EduCanvas/pull/483) |
| AR08 Callout 生成端 | 已合并 | [#484](https://github.com/Timcai06/EduCanvas/pull/484) |
| AR09 全量收口 | 已合并 | 走查脚本 [#498](https://github.com/Timcai06/EduCanvas/pull/498)；缺陷修复 [#491](https://github.com/Timcai06/EduCanvas/pull/491)、[#497](https://github.com/Timcai06/EduCanvas/pull/497) |

### AR09 收口（2026-09-17 完成）

「五渲染器手动走查」已改成可复现脚本 `pnpm test:walkthrough`（[#498](https://github.com/Timcai06/EduCanvas/pull/498)）：
用既有 DB fixture 把五个产物种进同一 Notebook，逐个在 Canvas 打开并截图到
`output/renderer-walkthrough/`。人工走查留不下证据也无法在每次改动后重跑，而
#487 与 #488 正是合并后才由用户发现的——脚本化后这类缺陷在改动当下即可复现。

断言只保留「确实渲染出内容」的底线加两条回归线（代码块语言标识、长标签不截断），
视觉好坏仍由人看图判断，不把主观审美写成断言。

本机 5/5 通过，人工核对截图：思维导图长标签完整、分支配色与角色徽标齐备；
Markdown 标题层级分明、callout 成框、代码块带 `PYTHON` 角标；闪卡翻面可用；
Slides 与绘本正常。

合并后暴露的三个显示缺陷已全部关闭，它们都落在本线已交付的渲染器上：

- [#487](https://github.com/Timcai06/EduCanvas/issues/487) markdown_document 标题无层级、
  代码块无结构与语言标识——AR06 的只读路径把排版挂在未安装的 Tailwind `prose` 上。
  已由 [#491](https://github.com/Timcai06/EduCanvas/pull/491) 改为复用既有 `.chat-prose`
  与 `features/chat/markdown` 渲染边界修复，不新增依赖；
- [#488](https://github.com/Timcai06/EduCanvas/issues/488) 思维导图折叠/展开缩放跳动与
  节点文字截断——AR05 的缩放控件与折叠锚定。已由
  [#497](https://github.com/Timcai06/EduCanvas/pull/497) 修复：自适应只在首次执行，
  节点加宽到 260×60 并允许两行；
- [#489](https://github.com/Timcai06/EduCanvas/issues/489) web_app 产物启动失败——不属于
  本线范围（web-runtime 未接入开发启动流程），但与产物显示验收同屏出现。

「不引入新依赖」的约束在 #487 的修复中继续成立：排版复用仓库既有的 `.chat-prose`
与 `features/chat/markdown` 渲染边界，而不是补装 `@tailwindcss/typography`。

## 六、验收标准（每渲染器）

- 单测同步更新且通过；`pnpm lint`、`pnpm typecheck` 全绿；
- `prefers-reduced-motion: reduce` 下所有新动画降级可用（人工核验一次）；
- 键盘流不抢输入框焦点、不同屏面板互不干扰；
- Schema 校验失败仍显示错误态而非崩溃（既有纪律回归）。

## 七、归档结论（2026-09-17）

AR00-AR09 全部合并进 `main`。交付范围与计划一致：五个内容驱动渲染器的读体验
补齐、callout 渲染与生成端闭环、共享交互基元与分支色板 token。

### 实际偏差

- **走查方式**：计划写的是「五渲染器手动走查」，实际改为可复现脚本
  `pnpm test:walkthrough`。理由是人工走查留不下证据、无法在每次改动后重跑，
  而 #487/#488 恰恰是第一批合并后才由用户发现的读体验缺陷。
- **三个后置缺陷**：#487（Markdown 标题无层级、代码块无语言标识）、
  #488（思维导图折叠重置缩放 + 长标签截断）在第一批合并后才暴露，已分别由
  #491、#497 修复。#489（web_app 产物启动失败）不属于本线范围，由
  [#500](https://github.com/Timcai06/EduCanvas/pull/500) 单独关闭。
- **约束维持**：「不引入新依赖」在 #487 的修复中继续成立——排版复用既有
  `.chat-prose` 与 `features/chat/markdown` 渲染边界，而不是补装
  `@tailwindcss/typography`。

### 未完成项去向

- 走查截图只作为人看的证据，不做像素级快照基线（字体与渲染差异会造成假失败），
  这是刻意取舍，不列为遗留；
- 移动端视口的渲染器适配不在本线范围，也不作为后续重点。

### 验收证据

- `pnpm test:walkthrough` 5/5，产出 `output/renderer-walkthrough/` 六张截图；
- 合并后的 `main` 上完整 E2E 矩阵 159/159；
- `apps/web` typecheck、lint、Prettier 与 `features/canvas` 单测通过。
