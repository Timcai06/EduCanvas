# 闪卡翻面与自评交互参考调研：react-anki 与 Synapse

- 状态：`draft`
- 负责人：hzlgou
- 创建时间：2026-08-26
- 相关分支：`docs/20260826-artifact-display-research`

## 一、调研定位

**目标**：为 EduCanvas 只读闪卡渲染器（`apps/web/features/canvas/flashcards-renderer.tsx`）的显示优化提供源码级参考。

**当前渲染器的显示短板**（对照 2026-08-26 main @ `4f97d7d6`）：

1. 翻面是瞬间文本切换，无任何过渡动画；
2. 无键盘操作（空格翻面/数字键自评）；
3. 进度只有「1 / N」文字，无进度条、无已记住计数实时可见；
4. 无洗牌能力。

**范围边界**：

- ✅ 3D 翻面 CSS 结构、键盘分态处理、进度展示、评分按钮流、按键提示体系
- ❌ SM-2/FSRS 调度算法——EduCanvas 闪卡是**自评式**（ADR-0004：自评仅存浏览器内存，不上行、不参与可信学习事件），不引入间隔重复调度

## 二、项目概览

| 项目 | 版本（克隆 HEAD） | 许可 | 定位 |
| --- | --- | --- | --- |
| [react-anki](https://github.com/sjgorsky/react-anki) | `a7c56a0` 2026-03-10 | **无 LICENSE 文件** | React 18 + TS + Tailwind 的 SM-2 闪卡应用 |
| [Synapse](https://github.com/Emadab/Synapse) | master @ 克隆日 2026-08-26 | MIT | Anki 兼容桌面应用，Tauri + React，keyboard-first 复习界面 |

⚠️ react-anki 无 LICENSE：默认版权保留，**只能作为模式线索参考，禁止复制任何代码片段到 EduCanvas**。本文所有「结构描述」为模式提炼。Synapse 为 MIT，可作为主要落地参考。

## 三、实现分析

### 3.1 3D 翻面三层结构（核心）

外层容器给 `perspective`，中间层管旋转（`transform-style: preserve-3d` + transition），正反两面绝对定位铺满且各自 `backface-visibility: hidden`；背面预旋转 180°：

```tsx
<div style={{ perspective: '1000px' }}>
  <div className="transition-transform duration-500"
    style={{ transformStyle: 'preserve-3d',
             transform: isFlipped ? 'rotateY(180deg)' : 'rotateY(0deg)' }}>
    <div className="absolute inset-0"
         style={{ backfaceVisibility: 'hidden' }}>正面</div>
    <div className="absolute inset-0"
         style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}>背面</div>
  </div>
</div>
```

要点：**过渡加在中间层而非面层**；两面同尺寸绝对定位避免高度跳变。

### 3.2 键盘分态处理

全局 `window` keydown（无需焦点），Space 恒翻面，数字键仅在翻开后生效（`src/components/Flashcard.tsx`）:

```ts
if (e.code === 'Space') { e.preventDefault(); onFlip(); }
if (isFlipped) {
  const n = e.key === '1' ? 1 : /* ... */ e.key === '4' ? 4 : 0
  if (n >= 1 && n <= 4) { e.preventDefault(); onRate(n) }
}
```

配套 a11y：卡片本体 `role="button" tabIndex={0}` + Enter 兜底；评分按钮 `stopPropagation()` 防止冒泡触发翻面。

### 3.3 进度展示与评分流

- ProgressBar 为纯受控组件 `{current, total, label}`：轨道 `h-2 rounded-full` + 内条宽度百分比 + `transition-all duration-300`；
- 评分按钮只渲染在背面（翻开才可见），点击后：调度 → 翻回正面 → 前进下一张（clamp 到末尾）；
- 会话进度 = currentIndex / 总数，「记住 x / N」实时统计。

### 3.4 Synapse：单布尔状态机 + 键盘守卫（MIT，主要落地参考）

复习会话只有一个布尔状态 `revealed` 驱动全部 UI（`apps/desktop/src/routes/StudySessionScreen.tsx`）：翻面 = `setRevealed(true)`；评分成功后换卡并复位——**单状态机不易出现「卡在中间态」**。

键盘是 window 级监听但带守卫：先排除输入框聚焦（`typing` 判定），再按阶段匹配按键（未翻开只认 Space/Enter，翻开后才认数字键）；mutation pending 时键盘路径直接 return 实现软禁用。

**三层按键提示体系**：按钮内嵌 `Kbd` 芯片、底部常驻一行微字快捷键提示条、每个评分按钮自带数字角标——键盘优先但鼠标用户也不迷失。

**reduced-motion 感知的过渡编排**：`lib/motion.ts` 集中 duration/easing/stagger；framer-motion 真 3D 翻转（preserve-3d + 双面 backface-hidden），`useReducedMotion()` 时降级为无动画纯切换；评分后旧按钮淡出、新卡以 fade/slide 浮入（key 重挂载）。

⚠️ Synapse 的卡面渲染用 open Shadow Root + adoptedStyleSheets 隔离 Anki 牌组样式，且**故意不 sanitize、重建 script 执行模板脚本**——桌面端信任本地内容的取舍。EduCanvas 的模型产出属不可信输入，**绝不可照搬脚本执行**；其 Shadow DOM 样式隔离层思路仅在引入富文本卡面时再评估。

## 四、对 EduCanvas 渲染器的借鉴映射

按性价比排序（目标文件 `apps/web/features/canvas/flashcards-renderer.tsx`）：

| # | 借鉴点 | 来源 | 落地方式 |
| --- | --- | --- | --- |
| 1 | **单布尔状态机 + 键盘守卫** | Synapse §3.4 | `flipped` 一个状态驱动全部 UI；keydown 先排除输入框聚焦再分阶段匹配；评分 pending 时软禁用键盘 |
| 2 | **三层翻转结构** | react-anki §3.1 + Synapse | 用现有 token 重写：外层 `perspective`、中层 rotateY 过渡、双面 backface-hidden；`prefers-reduced-motion: reduce` 时降级为现有瞬时切换或淡入淡出（GSAP `matchMedia` 或 CSS media query） |
| 3 | **键盘分态** | 两者一致 | Space/Enter 翻面；翻开后 `1`=没记住、`2`=记住了；监听组件根元素 keydown 而非 window（嵌入面板不抢全局快捷键） |
| 4 | **进度条 + 实时计数** | react-anki §3.3 | 顶部细进度条（当前张/总数），底部常驻「记住 gotCount」小徽标，替代纯文字 |
| 5 | **按键提示体系** | Synapse §3.4 | 翻面前显示「Space 翻面」Kbd 芯片、翻开后自评按钮自带数字角标，底部一行微字提示条 |
| 6 | **洗牌按钮** | 自有需求 | 仅打乱本地渲染顺序（Fisher-Yates），重置 index/flipped/marks；不改 cards 数据本身，符合「自评不上行」边界 |

**不采纳**：SM-2/FSRS 调度与持久化（ADR-0004 边界）；Again/Hard/Good/Easy 四级评分（Schema 与产品语义是二元自评）；window 级全局监听（多实例共存风险，Synapse 的守卫思路保留但挂载点改为组件根元素）；Shadow DOM 卡面隔离与脚本执行（模型产出不可信，见 §3.4 警示）。

## 五、证据与边界

- 证据等级：**事实**——两仓库克隆源码直读，版本见表二，快照日期 2026-08-26；
- react-anki 无 LICENSE：其相关小节只提炼交互结构与状态流，落地代码必须以 EduCanvas token/GSAP 体系原创实现；Synapse 为 MIT，可作主要落地参考；
- 实施约束：翻面动画遵守 `prefers-reduced-motion`；键盘处理不得干扰画布其他面板的既有快捷键；marks 状态保持组件内存即弃。
