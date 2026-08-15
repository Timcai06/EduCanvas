# EduCanvas 设计系统

> 本文件是所有视觉决策的唯一事实来源。任何组件在编写前必须先读它；
> 需要新 token 时先加进本文件，再在代码里使用。本文档由 R1 机制层工作
> 从现有代码提取而成——它描述「现在是什么」，不是「应该是什么」。

## 1. 氛围与身份

一张安静的课桌。纸面是默认的亮，砚墨是晚自习的暗；信息密度随场景呼吸，
对话时疏朗，工作时紧凑。签名意象是「两支笔」——老师批改作业手边的两支笔：
墨紫的笔在讲课（Agent 的声音、链接、常规交互），朱砂的笔在批改（判分、圈点、
审批、需要注意的事）。材质签名是纸：全屏极低强度的 feTurbulence 纸纹、
墨色的细滚动条、衬线的讲义排版，让界面读起来像一页被批改过的讲义，
而不是又一个 SaaS 控制台。

## 2. 色彩

### 调色板

全部色彩取自传统颜料谱系（纸、墨、墨紫、朱砂、藤黄、松绿）。
Token 定义在 `app/globals.css` 的 `@theme {}`（纸面亮态静态值）与
`:root[data-theme='dark']`（砚墨暗态全量覆写）。**组件禁止散写色值。**

| 角色     | Token                                | 纸面（亮）        | 砚墨（暗）        | 用途                                     |
| -------- | ------------------------------------ | ----------------- | ----------------- | ---------------------------------------- |
| 桌面     | `--color-canvas`                     | #f7f4ec           | #1a1712           | 页面底色                                 |
| 新纸     | `--color-card`                       | #fffdf7           | #211e17           | 卡片、抽屉、浮层                         |
| 纸面     | `--color-surface`                    | #efeadd           | #262217           | 次级面板、表格头                         |
| 厚纸     | `--color-surface-strong`             | #e5ddcb           | #322d20           | 行内代码底、强调面                       |
| 墨       | `--color-ink`                        | #262219           | #eae4d4           | 正文、标题                               |
| 淡墨     | `--color-ink-muted`                  | #6d6552           | #b0a78f           | 信息文字（对比 ≥4.5:1）                  |
| 灰墨     | `--color-ink-faint`                  | #847d6b           | #7f7663           | 装饰/图标层（≥3:1），不承载信息文字      |
| 纸线     | `--color-line`                       | #ddd4c0           | #3b3527           | 分隔线、描边                             |
| 墨紫     | `--color-accent`                     | #6a4a86           | #b79bd6           | 讲课的笔：链接、交互、聚焦               |
| 墨紫·浓  | `--color-accent-strong`              | #523368           | #cbb6e6           | 悬停、选中                               |
| 墨紫·淡  | `--color-accent-soft`                | #ebe3f2           | #2c2340           | 选中底色                                 |
| 扉页点色 | `--hero-ink-dot`                     | #2e1c46           | #b79bd6           | PixelBlast 墨点场专用（shader 二次提亮） |
| 朱砂     | `--color-cinnabar`                   | #cf4429           | #e2795b           | 批改的笔：判分、审批、重点               |
| 朱砂·浓  | `--color-cinnabar-strong`            | #ac3620           | #ee9377           | 朱砂悬停/强调                            |
| 朱砂·淡  | `--color-cinnabar-soft`              | #f7e0d6           | #3d2018           | 朱砂底色                                 |
| 热力 0–4 | `--color-heat-0..4`                  | #e7e0d2→#6a4a86   | #2a2519→#b79bd6   | 仅学习热力图，不承载状态语义             |
| 松绿     | `--color-good` / `--color-good-soft` | #4a7c44 / #e3ecda | #8db77d / #26321f | 成功                                     |
| 藤黄     | `--color-warn` / `--color-warn-soft` | #97711e / #f2e7ca | #d0a751 / #372e14 | 警告                                     |
| 错误     | `--color-bad` / `--color-bad-soft`   | #ab2f17 / #f6dcd2 | #de6a4c / #3d1d13 | 错误（与朱砂同族更深）                   |

### 规则

- 纸面层级（canvas → card → surface → surface-strong）承担深度表达的主力，见第 7 节。
- 墨紫只用于交互与「Agent 在说话」的语义；朱砂只用于批改/审批/警示语义；两者不做纯装饰。
- 新增颜色必须先扩展上表；热力五色不得挪作状态色。
- 暗色不由 `light-dark()` 驱动（Chromium 动态切换不重解析的已知坑），一律走 `data-theme` 属性覆写。

## 3. 排版

### 字族

- 正文/UI（无衬线）：`--font-sans` = Inter Variable → PingFang SC → Microsoft YaHei → system-ui
- 讲义/标题（衬线）：`--font-display` = Noto Serif SC → Songti SC → STSong → SimSun → PingFang SC
- 代码：`ui-monospace, 'SF Mono', Menlo, monospace`（行内代码与代码块，不入 token）

排版身份：标题、引文、旁注、滚轮选项走衬线（「课堂讲义」），功能 UI 走无衬线。
中文正文行高 1.8，标题行高 1.45。

### 字级

定义于 `@theme`（Tailwind v4 同时生成 `text-*` 工具类与同名 CSS 变量）：

| Token             | 值               | 行高        | 用途                                        |
| ----------------- | ---------------- | ----------- | ------------------------------------------- |
| `--text-overline` | 0.6875rem (11px) | 1.4         | 大写区段标签、图注、代码块语言标            |
| `--text-caption`  | 0.75rem (12px)   | 1.4         | 辅助小字、动作按钮                          |
| `--text-note`     | 0.8125rem (13px) | 1.5         | 旁注、代码块、次级正文（页边批注的字号）    |
| `--text-body`     | 1rem (16px)      | 1.8（散文） | 默认正文                                    |
| `--text-lead`     | 1.15rem          | 1.45        | h2、引言级                                  |
| `--text-title`    | 1.3rem           | 1.45        | h1、卡片大标题                              |
| `--text-wheel`    | 1.9rem           | 1           | 学科滚轮衬线大字（`--ow-font-size` 默认值） |

### 规则

- 跟随父级缩放的相对字级（`0.9em` 表格、`0.875em` 行内代码、`0.95em` 引用标、
  `0.42em` 滚轮副标等）是排版力学，保持 em 原样，不进 token。
- 字距（letter-spacing）按场景保留在使用处：overline 类标签 0.08em–0.22em，
  正文与标题不加字距（标题仅 0.01em 的衬线校正）。
- 正文不低于 14px；overline/caption 仅用于标签与元信息，不承载段落。

## 4. 间距与布局

### 基准

间距 token 以 **4px** 为基，定义于 `@theme`：

| Token        | 值             | 用途                 |
| ------------ | -------------- | -------------------- |
| `--space-1`  | 0.25rem (4px)  | 图标与文字间         |
| `--space-2`  | 0.5rem (8px)   | 紧凑：列表项、行内组 |
| `--space-3`  | 0.75rem (12px) | 默认：表单内边距     |
| `--space-4`  | 1rem (16px)    | 标准：卡片内边距     |
| `--space-5`  | 1.25rem (20px) | 宽裕：区块内部       |
| `--space-6`  | 1.5rem (24px)  | 卡片组之间           |
| `--space-8`  | 2rem (32px)    | 页内区块             |
| `--space-10` | 2.5rem (40px)  | 大区块间隔           |

### 布局机制

- 工作区为 app shell：左栏（历史/课程）+ 主对话区 + 右侧 Canvas/Studio 抽屉；
  学习页另有可拖拽中缝分屏。滚动归属各面板自身，页面级不设横向滚动。
- `html` 预留 `scrollbar-gutter: stable`，抽屉开合不引起横向抖动。
- 断点：组件级现用 760px（窄屏折叠）；Tailwind 默认 sm/md/lg/xl 可用。

### 规则

- token 化「意图」（间距步进），保留「力学」原样：`auto`、 `%`、`clamp()`、
  `minmax()`、以及散文排版的 em 节奏（`0.65em` 段距、`1.4em` 列表缩进等）。
- 组件精调值（0.24rem、0.375rem、0.55rem 等视觉微调）属组件力学，不强行入 token；
  新组件应优先从 scale 取值。

## 5. 组件

只记录复用 ≥2 次或已共享的原件。状态与动效细节以源码注释为准。

### 渐变描边输入框（`.ec-input` / `.ec-field`）

- **结构**：裸 input/textarea 用 `.ec-input`；「图标 + input」容器用 `.ec-field`（`:focus-within` 判定）。
- **机制**：padding-box/border-box 双层背景画渐变描边；静止墨紫→纸线，聚焦墨紫→朱砂 + 墨紫柔光。
- **状态**：default / focus（描边转两支笔渐变 + 3px 柔光圈）。
- **规则**：套用后须移除组件原有 border/bg 工具类以免相互抵消。

### Sheet（抽屉，`features/workspace/shared/sheet.tsx`）

- **结构**：遮罩 + 面板 + 焦点管理（ModalFocus），GSAP 驱动开合。
- **状态**：open / closed；遮罩 `autoAlpha` 0.25s，面板位移 0.5s，内容 stagger 入场。
- **无障碍**：焦点圈禁、Esc 关闭；reduced-motion 下时长收敛。

### PillNav（胶囊导航）

- **结构**：`ul` 胶囊列表 + GSAP 圆形指示器 + 双层 label（base/hover 换位）。
- **状态**：default / hover（label 上翻染色）/ is-active（底部墨紫点）/ focus-visible（墨紫 outline）。
- **已知债**：投影误用 Tailwind 默认 `--shadow-sm`（纯黑），应迁回墨色系，见第 8 节。

### OptionWheel（学科/来源两级滚轮，Studio）

- **结构**：绝对定位条目沿圆弧排布，rAF 逐帧写 transform/opacity/filter；
  `--ow-p`（0..1）驱动字色由 ink-faint/ink-muted 融向墨紫。
- **状态**：default / selected（衬线 600）/ disabled（斜体弱化但仍可滚过）/ dragging（抓手光标）。
- **规则**：颜色由调用方经 props 注入 token（`textColor`/`activeColor`）；组件 CSS 里的
  React Bits 原生 hex 只是兜底默认值，不得直接在画面上出现。

### 旁注导航（LineSidebar / marginalia-nav）

- **结构**：编号 + 发丝标记线列表；`--effect`（0..1）由 rAF 指数平滑写入，
  位移/染色/标记线同步无错拍。
- **状态**：proximity 高亮（鼠标邻近度驱动）/ focus-visible / reduced-motion 退化为静态选中高亮。

### 图标

- UI 图标一律 `@phosphor-icons/react`，全站唯一 UI 图标集。
- 真实技术品牌 logo（Next.js、Docker 等）走 `react-icons/si`（Simple Icons）——
  Phosphor 不收录品牌标识，这是唯一的非 Phosphor 例外。
- 禁止用 emoji 充当图标。
- `components.json` 的 `iconLibrary: lucide` 仅是 shadcn CLI 元数据，运行时代码不得据此
  引入 Lucide；新增基础件仍使用 Phosphor 或不含图标。

### 共享状态与 Canvas 表面

- `components/ui/empty-state.tsx` 统一无数据/失败状态的标题、说明、图标和动作层级。
- `components/ui/skeleton.tsx` 统一列表加载骨架；加载、空数据、失败必须是三种独立状态，
  不得把请求失败伪装为「暂无数据」。
- `features/canvas/canvas-surface.tsx` 统一 Tier 1 Canvas 的纸面、描边、圆角和交互焦点；
  Slides、Flashcards、Mind Map 只在内容布局上保留差异。

### 招牌氛围件（不承载信息）

- `spotlight-card`：跟随鼠标的墨紫径向柔光（JS 写 `--spot-x/y`）。
- `hero-ink-text` + `hero-ink-char`：SplitText 逐字落字 + 逐字呼吸（4.8s 循环）。
- `stream-shimmer`：流式占位灰条 + GSAP 平移墨紫微光。
- `aurora-ink` / `ink-flow-line` / PixelBlast 墨点场 / `agent-busy-overlay` 工作态氛围：
  纯装饰，`pointer-events: none`，reduced-motion 全部有降级（停帧或静态化）。
- Live Voice 左侧液态球叠加 React Bits 原版 RippleDistortion；右侧图片工作台跟随图片
  原始宽高比且保持无失真，缩略图切换不隐式改变上下文启停，原图查看与圈点仍走
  安全 Renderer。

## 6. 动效与交互

### 时长

定义于 `@theme`（`--duration-*` 为 CSS 变量；GSAP 侧在 R2 统一消费）：

| Token                 | 值    | 用途                                                |
| --------------------- | ----- | --------------------------------------------------- |
| `--duration-instant`  | 120ms | reduced-motion 降级下限（不降为 0，保留状态可感知） |
| `--duration-micro`    | 160ms | 悬停着色、按下反馈                                  |
| `--duration-fast`     | 220ms | 描边、透明度微交互                                  |
| `--duration-standard` | 300ms | 面板/卡片过渡、抽屉遮罩                             |
| `--duration-emphasis` | 420ms | 入场位移、布局强调                                  |
| `--duration-slow`     | 520ms | 全屏氛围层淡入淡出                                  |
| `--duration-hero`     | 900ms | 扉页装饰（扫光等）                                  |

无限循环的氛围动画（aurora 20s、墨点场、hero 呼吸 4.8s、流动线 6s/1.35s）
是各效果的内在参数，不进时长 token。

### 缓动

| Token             | 值                             | 用途                  |
| ----------------- | ------------------------------ | --------------------- |
| `--ease-enter`    | cubic-bezier(0.16, 1, 0.3, 1)  | 入场/落位（先快后稳） |
| `--ease-emphasis` | cubic-bezier(0.22, 1, 0.36, 1) | 较大位移的入场        |
| `--ease-spring`   | cubic-bezier(0.2, 0.8, 0.2, 1) | 缩放类回弹感          |

Tailwind 默认的 `ease-out` / `ease-in-out` 工具类沿用其默认曲线，不覆写；
CSS 关键字 `ease`/`linear` 保持原样可用。

### 规则

- 只动画 `transform` / `opacity` / `filter`；永不动画布局属性。
- 每个动效必须映射到真实的交互、状态变化或可供性；无信息目的的装饰动效是 slop。
- 邻近度驱动件（OptionWheel、LineSidebar）用 rAF 逐帧写 CSS 变量，不用 CSS transition 叠加。
- `prefers-reduced-motion: reduce`：循环氛围全部停帧或静态化；过渡收敛到
  `--duration-instant` 或取消；组件层另有 `use-reduced-motion` hook 与
  `motion-reduce:` 工具修饰符。
- GSAP 状态迁移（面板/列表/菜单/遮罩/Flip 布局）一律经
  `features/theme/motion.ts` 的 `motionDuration()` 消费上表 token，禁止再写裸秒数。
  签名入场（hero 落字、空态扉页、双笔迹、Studio 级联）与氛围/机制件（呼吸墨点、
  CountUp、StreamShimmer、PillNav、CircularText）的时长是效果内在参数，保持原样。

## 7. 深度与表面

### 策略

**mixed**：纸面层级色阶为主（tonal-shift），1px 纸线描边为辅，墨色系投影仅用于浮起层。

### 投影（墨色染调，非纯黑）

| Token                 | 值（亮态）                             | 用途           |
| --------------------- | -------------------------------------- | -------------- |
| `--shadow-float`      | 0 1px 2px + 0 10px 32px（墨色 5%/10%） | 浮起卡片、气泡 |
| `--shadow-card-hover` | 0 2px 4px + 0 16px 40px（6%/14%）      | 悬停加深       |
| `--shadow-sheet`      | 0 8px 40px（深墨 22%）                 | 抽屉/模态      |

暗态同 token 覆写为纯黑高透明度版本（暗纸面上墨色投影不可见）。

### 层级（z-index）

侧栏 40 < Agent 工作态氛围 45 < 抽屉 50 < 纸纹 60（纸纹永远在最上但 pointer-events 穿透）。

## 8. 无障碍约束与已接受的债

### 约束

- 对比度：信息文字用 `--color-ink-muted`（≥4.5:1）；`--color-ink-faint` 只用于
  装饰/图标（≥3:1），不得承载信息（globals.css 注释已固化此约定）。
- 每个可交互元素有 focus-visible 态：2px `--color-accent` outline + 2px offset。
- `prefers-reduced-motion` 全量尊重（第 6 节）；另有 `prefers-reduced-transparency`
  对 Studio 级联模糊的降级。
- 主题切换无水合闪烁（layout.tsx 内联脚本在水合前写 `data-theme` + `color-scheme`）。
- 键盘可达：Sheet 焦点圈禁、滚轮可聚焦、胶囊导航为真实链接/按钮。

### 已接受的债

| 项                                                                                                                                                             | 位置                                            | 为什么接受                                                    | 处理时机               |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------- | ---------------------- |
| OptionWheel/LineSidebar CSS 内含 React Bits 原生 hex 兜底默认值                                                                                                | `components/OptionWheel.css`、`LineSidebar.css` | 所有调用方都经 props 注入 token，画面上不出现；改动无视觉收益 | 组件重写或 R3 清理时   |
| 字级微调合并：PillNav 0.79rem、Studio 输入 0.8rem → `--text-note`(0.8125rem)；Studio 提示 0.68rem → `--text-overline`(0.6875rem)；时长 0.2s→220ms、0.26s→300ms | 对应 CSS                                        | 差异 ≤0.32px / ≤40ms，不可感知；合并才能形成 scale            | 已在本轮执行，记录备查 |
| react-grab / react-scan / react-doctor 开发工具未安装                                                                                                          | 全 app                                          | 待用户确认引入开发依赖                                        | 下一轮开工前确认       |
