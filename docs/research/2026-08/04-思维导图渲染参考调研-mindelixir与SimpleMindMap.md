# 思维导图渲染参考调研：mind-elixir-core 与 SimpleMindMap

- 状态：`draft`
- 负责人：hzlgou
- 创建时间：2026-08-26
- 相关分支：`docs/20260826-artifact-display-research`

## 一、调研定位

**目标**：为 EduCanvas 只读思维导图渲染器（`apps/web/features/canvas/mind-map-renderer.tsx` + `mind-map-layout.ts`）的显示优化提供源码级参考。只借鉴「读体验」实现模式，不引入任何依赖。

**当前渲染器的显示短板**（对照 2026-08-26 main @ `4f97d7d6`）：

1. 节点无层级配色：全部同款白卡片，`semanticRole` 只有 sr-only 文本；
2. Schema 的 `layoutHint`（tree/radial/timeline）完全未实现；
3. 缩放无可见控件（+/−/适配全靠盲快捷键）；
4. 折叠/展开是瞬间重排，无过渡。

**范围边界**：

- ✅ 节点/连线绘制技术、分支配色、布局算法、展开折叠交互、缩放平移
- ❌ 编辑能力（拖节点、改文本、右键菜单）、协作、导入导出——EduCanvas 渲染器只读

## 二、项目概览

| 项目 | 版本（克隆 HEAD） | 许可 | 定位 |
| --- | --- | --- | --- |
| [mind-elixir-core](https://github.com/ssshooter/mind-elixir-core) | `0aaa83a` 2026-08-07 | MIT | 框架无关思维导图内核，DOM 流式布局 |
| [SimpleMindMap](https://github.com/wanglin2/mind-map) | `e8e5ef9` 2026-07-07 | MIT | SVG 架构的全功能导图库，14 种布局 |

## 三、实现分析

### 3.1 mind-elixir-core

**节点 DOM：自定义元素 + CSS 流式布局，没有 JS 坐标循环。**
结构为 `me-nodes > me-main(.lhs/.rhs) > me-wrapper > me-parent > me-tpc`，兄弟集合包在 `me-children` 里（`src/utils/dom.ts:116`）。排布完全交给 flex + CSS 变量间距（`src/index.css:156`）：

```css
me-main > me-wrapper { margin: var(--main-gap-y) var(--main-gap-x); }
me-parent { padding: 6px var(--node-gap-x); margin-top: var(--node-gap-y); }
```

坐标只在事后读取用于画线（`getOffsetLT`，`src/utils/index.ts:121`，沿 offsetParent 链累加 offsetLeft/Top）。「先排版、后连线」两阶段管线，局部更新只重画受影响分支（`linkDiv.ts`）。

**分支配色：一级取模分色、子树继承。**
只有一级主节点按索引从 palette 取色，之后沿递归继承；显式 `branchColor` 可覆盖。节点边框与连线共用一色（`src/linkDiv.ts:51,102`）：

```ts
const branchColor = tpc.nodeObj.branchColor || palette[i % palette.length]
tpc.style.borderColor = branchColor          // 一级节点描边同色
const bc = childP.firstChild.nodeObj.branchColor || branchColor // 子级继承
```

**连线：SVG path，曲率参数绑定间距变量。**
主干二次贝塞尔控制点取 `(起点的x, 终点的y)`；子级三次贝塞尔的水平收尾偏移 `∝ Δy × GAP`，GAP 直接读 `--node-gap-x`（`src/utils/generateBranch.ts`）：

```ts
return `M ${x1} ${y1} Q ${x1} ${y2} ${x2} ${y2}`
// 子级：C 曲线 + H 收尾段，弯曲度随垂直距离自适应
const offset = (Math.abs(y1 - y2) / 300) * GAP
return `M ${x1} ${y1} C ${xMid} ${y1} ${xMid - offset} ${y2} ${x2} ${y2} H ${end}`
```

主干线宽 3、子线宽 2；虚线仅用于关联箭头（`stroke-dasharray: '8,2'`）。

**展开/折叠：瞬时重排 + 视口锚定补偿。**
点击 expander 后翻转 `expanded` → 增删该分支 DOM → 重画该分支连线 → **drift 补偿**：重排前后各取一次 `getBoundingClientRect()`，差值 `move()` 移回视口（`src/interact.ts:365-417`）。没有 FLIP、没有布局过渡动画；仅 expander 图标和画布平移有 0.3s transition。

**缩放：单层 transform + 光标为中心。**
`translate3d(x,y,0) scale(s)` 作用于画布容器；以光标为中心的缩放公式见 `src/interact.ts:130-154`，滚轮 delta 按 deltaMode 归一化后 clamp。拖拽平移有边界 clamp：内容边缘不允许越过容器中心。

**主题：palette[10] + cssVar[20]。**
`{ name, type, palette, cssVar }` 结构，cssVar 含 4 个 gap、3 个 radius、root 三件套、正文颜色等（`src/const.ts:8-66`）。`changeTheme` 合并 base 后逐个 `setProperty`。

### 3.2 SimpleMindMap

**架构：SVG 三层分离。**
背景（容器 CSS）→ `lineDraw`（全部连线 path）→ `nodeDraw`（节点 `<g>` 内含形状 + `<foreignObject>` 承载 HTML 文字）（`simple-mind-map/src/core/render/node/nodeLayout.js:265`）。

**主题分级 merge 规则。**
默认主题分 `root / second / node(三级+) / generalization` 四组样式；解析优先级：**节点自带样式 > 所属层级 > 最外层全局**（`core/render/node/Style.js:75`）。替代散落的条件样式判断。

**树布局三阶段（asyncRun 分步让出主线程）。**
先序遍历定 x → 后序累计子树高度并垂直居中 → 兄弟冲突时 `updateBrothers` 把兄弟上下推开并**向上递归传播**（`layouts/LogicalStructure.js`）。节点尺寸测量用离屏 div + `getBoundingClientRect()`，`Math.ceil(w)+1` 修正小数换行。

**连线三种风格（`layouts/Base.js:426-453`）。**
曲线（根二次 `{` 型，其余三次贝塞尔控制点取水平中点）、直线折线（拐角 `Q` 圆角）、直连。核心公式：

```js
cx1 = x1 + (x2 - x1) / 2; cy1 = y1
cx2 = cx1;                cy2 = y2
return `M ${x1},${y1} C ${cx1},${cy1} ${cx2},${cy2} ${x2},${y2}`
```

**收起角标：后代计数圆点。**
展开按钮 Circle 底 + ±图标；收起态可显示后代总数（递归求和写进 Circle Text，`nodeExpandBtn.js`）。默认 hover 才显示，透明占位矩形维持热区。

**概要（summary）：groups 的直接参考。**
概要本身是一个真实节点实例；括号线是二次贝塞尔 `M x1,y1 Q cx,cy x2,y2`，其中 `cx=x±20, cy=(y1+y2)/2`，支持 `range:[i,j]` 指定覆盖区间，概要节点放括号外 margin 处垂直居中（`LogicalStructure.js:338`）。对应 EduCanvas Schema 的 `groups`（id/label/nodeIds[]）可用「包围盒 + 侧挂标签」可视化。

**性能三板斧。**
render 防抖合并（clearTimeout+setTimeout(0)）；布局分阶段 asyncRun；LRU 节点实例池（上限 1000，按 uid 复用 DOM）+ 视口外跳过内容渲染。

## 四、对 EduCanvas 渲染器的借鉴映射

按性价比排序（目标文件均为 `apps/web/features/canvas/mind-map-renderer.tsx` / `mind-map-layout.ts`）：

| # | 借鉴点 | 来源 | 落地方式 |
| --- | --- | --- | --- |
| 1 | **一级分支取模配色 + 子树继承** | mind-elixir §配色 | 在 layout 阶段给每个 L1 分支分配 token 色相（现有 accent 系扩展），节点左边框 + 连线共用一色；`semanticRole` 徽标（question/annotation/action）用 Phosphor 图标替代 sr-only |
| 2 | **三次贝塞尔水平中点公式** | SMM §连线 | 现有 `C (x1+x2)/2 y1, ...` 已接近，可加 mind-elixir 的 `offset ∝ Δy × gap` 自适应弯曲度，让密集区域曲线更平缓 |
| 3 | **缩放控件浮层** | 两者通用 | 右下角浮出 +/−/fit 三键组（fit 复用现有 `fitView`），配 aria-label；快捷键保留 |
| 4 | **收起角标（后代数）** | SMM §展开 | 折叠圆点内显示后代计数，帮助用户判断「点开有多大」，数据在 layout 时顺带算出 |
| 5 | **groups 的括号线可视化** | SMM §概要 | V2 Schema 的 groups 画包围盒 + 侧挂标签（Q 曲线括号），非 hierarchy 边保持虚线 |
| 6 | 折叠视口锚定补偿 | mind-elixir §折叠 | 折叠后图尺寸突变导致视野漂移，可在 setTransform 前做 before/after 包围盒差值补偿 |

**不采纳**：CSS 流式布局替代自研布局（我们已有深度约束校验 + v1/v2 双格式兼容，重写风险大于收益）；minimap（120 节点上限内 fit-view 足够）；radial/timeline 布局（Schema 有 layoutHint 但生成链从未产出，先不做死代码）。

## 五、证据与边界

- 证据等级：**事实**——以上均来自两仓库克隆源码直读，版本见表二；
- 两库均为 MIT，但本文档仅提炼模式，**不复制代码**；落地实现须以 EduCanvas 现有 React/Tailwind/token 体系重写；
- 许可与版本快照日期：2026-08-26；
- 后续实施须遵守：动画走 `gsap.matchMedia` 或 CSS transition 并支持 `prefers-reduced-motion`；渲染器入口重过公开 Schema 的既有纪律不变。
