# Slides 展示交互参考调研：reveal.js

- 状态：`draft`
- 负责人：hzlgou
- 创建时间：2026-08-26
- 相关分支：`docs/20260826-artifact-display-research`

## 一、调研定位

**目标**：为 EduCanvas 只读 Slides 渲染器（`apps/web/features/canvas/slides-renderer.tsx`）的显示优化提供源码级参考。

**当前渲染器的显示短板**（对照 2026-08-26 main @ `4f97d7d6`）：

1. Schema 的 `notes`（演讲者备注，≤500 字/页）**完全不渲染**；
2. 只有「1 / N」文字，无进度条；
3. 无页面总览，翻页只能线性点击/方向键。

**范围边界**：

- ✅ 进度条、备注面板、总览网格、翻页过渡、键盘与触屏导航、页码
- ❌ 编辑、独立演讲者弹窗窗口、3D 过渡全家桶——EduCanvas 是嵌入面板内的只读查看器

## 二、项目概览

| 项目 | 版本（克隆 HEAD） | 许可 | 定位 |
| --- | --- | --- | --- |
| [reveal.js](https://github.com/hakimel/reveal.js) | `807b430` 2026-08-24 | MIT | HTML 演示框架事实标准 |

## 三、实现分析

### 3.1 进度条：scaleX 而非 width

DOM 为外层 `div.progress` + 内层 `span` 填充条；更新只改一个 transform，动画交给 CSS（`js/controllers/progress.js:65` + `css/reveal.scss:624`）：

```js
this.bar.style.transform = 'scaleX(' + scale + ')'
```

```css
.reveal .progress span {
  transition: transform 800ms cubic-bezier(0.26,0.86,0.44,0.985);
  transform-origin: 0 0;
}
```

要点：`scaleX` 避免重排；**进度条可点击跳页**（clickX/宽度 × 总页数）。

### 3.2 备注内嵌面板（对 EduCanvas 最相关）

数据源是 slide 内 `<aside class="notes">` 或 `data-notes` 属性。展示形态三种：内嵌侧栏（内置）、独立演讲者窗口（插件）、打印注入。**内嵌形态是纯 CSS 布局切换**（`css/reveal.scss:1898-1982`）：

- 宽屏：备注栏绝对定位在主区右侧 25%，主区 `max-width: 100% - 25%` 让位；
- <1024px：变为底部 30vh 面板；
- 元素带 `data-prevent-swipe` 防止在备注上滑动误触翻页。

可见性判断：「deck 中任一页有备注才显示入口」。

### 3.3 总览模式（overview）

进入即加 `.overview` 类 → 每张 slide 平移到网格位（步长 = 幻灯片尺寸 + 70px 边距），视口整体缩放平移到当前页（`js/controllers/overview.js:90,121`）:

```js
transformElement(hslide, 'translate3d(' + (h * this.overviewSlideWidth) + 'px, 0, 0)')
// 缩略图目标尺寸 = max(min(视口宽高)/5, 150px)
const scale = Math.max(Math.min(innerWidth, innerHeight) / 5, 150) / vmin
```

进入/退出期间临时 `transition: none` 防网格排布被补间干扰；当前页用主题色 outline 高亮。键盘 ESC/O 切换，Enter/Space 退出并定位。

### 3.4 切换过渡：状态类 + 纯 CSS

JS 只维护 `past/present/future` 三态类（`reveal.js:1710-1769`），CSS 按类定义起止位置：

```scss
.past   { transform: translate(-150%, 0); }
.future { transform: translate(150%, 0); }
```

非 present 页统一 `opacity: 0; pointer-events: none`。方向感来自「离开页去 past 位、进入页从 future 位归零」，过渡本体由每张 slide 自身 CSS transition 完成。**通用架构启示：导航逻辑与视觉过渡解耦**——React 里用 state 表达三态类名即可沿用。

### 3.5 键盘与触屏

- 键盘注册表三层（config 映射 / 插件 / 内建）；**线性模式**：无嵌套幻灯片时四个方向键全部退化为 next/prev（`keyboard.js:203,277`）；输入框聚焦时不拦截按键。
- 触屏 swipe 三要点（`touch.js:4,162`）：40px 阈值 + 主轴判定（|Δx|>|Δy| 才横向）+ 单次手势只触发一次翻页；preventDefault 仅在确实翻页时发出，否则放行页面滚动。

### 3.6 页码

右下角 `div.slide-number`，格式 `c/t`（当前/总）；单轴 deck 自动扁平为纯数字。

## 四、对 EduCanvas 渲染器的借鉴映射

按性价比排序（目标文件 `apps/web/features/canvas/slides-renderer.tsx`）：

| # | 借鉴点 | 落地方式 |
| --- | --- | --- |
| 1 | **备注内嵌面板** | 底部可开关备注区（N 键切换 + 图标按钮），宽屏侧栏/窄屏底部二选一按容器宽度；仅当至少一页有 `notes` 时渲染入口；内容为纯文本受控渲染 |
| 2 | **scaleX 进度条** | 顶部 2px 细条，`scaleX((index+1)/slides.length)` + CSS transition；顺带支持点击跳页 |
| 3 | **页码 c/t 右下角** | 替换现有居中「1 / N」文本或并存 |
| 4 | **总览网格** | ≤20 页直接铺开渲染缩略标题卡（无需懒加载复杂度）：O/Esc 进入网格，点击跳页；缩略图用现有 token 卡片样式 |
| 5 | **swipe 手势** | 移动端左右滑翻页：40px 阈值 + 主轴判定 + touchAction 约束 |

**不采纳**：独立演讲者弹窗窗口（只读嵌入场景不需要）；convex/concave 3D 过渡（违背克制微交互风，保留现有 GSAP fade-slide 即可）；嵌套幻灯片方向语义（Schema 是一维数组）。

## 五、证据与边界

- 证据等级：**事实**——reveal.js 克隆源码直读，版本见表二，快照日期 2026-08-26；
- MIT 许可；本文档只提炼模式不复制代码；
- 实施约束：Schema 不动（`notes` 字段已存在，纯属渲染层缺失）；动画遵守 `prefers-reduced-motion`；键盘处理需避开输入框聚焦态（复用 reveal 的 focused 条件思路）。
