# 绘本翻页参考调研：StPageFlip

- 状态：`draft`
- 负责人：hzlgou
- 创建时间：2026-08-26
- 相关分支：`docs/20260826-artifact-display-research`

## 一、调研定位

**目标**：为 EduCanvas 绘本渲染器（`apps/web/features/canvas/picturebook-renderer.tsx`，#471 引入的第 5 个内容驱动产物）的显示优化提供源码级参考。

**当前渲染器的显示短板**（对照 2026-08-26 main @ `4f97d7d6`）：

1. 翻页是瞬间图片切换，无任何过渡；
2. 点状进度指示**不可点击**，无快速跳页手段；
3. 无 swipe 手势，触屏只能点按钮；
4. 无翻页预加载（`priority` 只有第一页），翻页时可能白屏闪烁。

**范围边界**：

- ✅ 翻页动画机制、swipe 判定、书脊质感、加载与预加载策略
- ❌ 双页对开（嵌入面板宽度有限且 Schema 是线性页序列）、编辑、依赖引入

## 二、项目概览

| 项目 | 版本（克隆 HEAD） | 许可 | 定位 |
| --- | --- | --- | --- |
| [StPageFlip](https://github.com/Nodlik/StPageFlip)（npm: page-flip） | master @ 克隆日 2026-08-26 | MIT | 无依赖的真实感书本翻页库，Canvas/HTML 双模式 |

## 三、实现分析

### 3.1 渲染架构：双后端共享 Render 抽象

Canvas 模式每帧全清重绘（静态页→bottomPage→书脊阴影→flippingPage→内外阴影）；HTML 模式 DOM 元素 + 每帧重写内联 cssText + 4 个常驻阴影 div（`src/Render/CanvasRender.ts` / `HTMLRender.ts`）。软页（soft）/硬页（hard）差异在 `HTMLPage.ts`：

- **hard 页 = 刚体**：绕书脊 `rotateY` 3D 翻转 + `backface-visibility:hidden`；
- **soft 页 = 平面变形**：二维 `rotate(angle)` + `clip-path:polygon(...)` 裁出翻起轮廓，无真实弯曲网格。

### 3.2 翻页数学（`src/Flip/FlipCalculation.ts`）

由拖拽点反解旋转角，标准二维旋转矩阵变换页面四角；拖拽点被限制在半径 pageWidth 的圆内；求旋转后页边与书本边界交点生成裁剪多边形：

```ts
let angle = 2 * Math.acos(left / Math.sqrt(top * top + left * left))
// 标准旋转矩阵，绕拖拽点变换页面四角
x: p.x * cos(angle) + p.y * sin(angle) + startPoint.x
```

### 3.3 状态机（`src/Flip/Flip.ts:27-39`）

```
READ --hover角落--> FOLD_CORNER --移开--> READ
READ --按下拖动>5px--> USER_FOLD --松手--> FLIPPING --动画完--> READ
READ --单击--> FLIPPING --> READ
```

### 3.4 swipe 双阈值判定（`src/UI.ts:259`）

```ts
Math.abs(dx) > this.swipeDistance &&      // 水平 >30px
distY < this.swipeDistance * 2 &&         // 垂直偏移 <60px（主轴判定）
Date.now() - this.touchPoint.time < this.swipeTimeout  // <250ms 快速滑动
```

三条件同时满足才算 swipe 并直接翻页；否则进入 fold 拖拽流。松手判定极简：翻过中线 → 动画补完到对面，否则收回原位（`Flip.stopMove`）。

### 3.5 性能策略与关键取舍

- 常驻 rAF 死循环 + 每帧全量重绘/重写 cssText——对声明式 React 应用是明显负担；
- 动画是预生成帧数组（起点→终点逐像素路径点按时间索引执行），快翻自动加速；
- 阴影 = 旋转 linearGradient 条带，宽度与透明度随翻页进度衰减。

## 四、对 EduCanvas 渲染器的借鉴映射

按性价比排序（目标文件 `apps/web/features/canvas/picturebook-renderer.tsx`）：

| # | 借鉴点 | 来源 | 落地方式 |
| --- | --- | --- | --- |
| 1 | **swipe 双阈值手势** | §3.4 | 约 20 行 Pointer Events 处理（30px 水平/60px 垂直/250ms），移动端体验提升最大 |
| 2 | **CSS 硬页翻转** | §3.1 hard 页 | StPageFlip 自己的 hard 页就是 `rotateY + backface-visibility + perspective`——用 GSAP 复刻即可获得约 80% 书感，天然支持 `prefers-reduced-motion` 降级为淡切 |
| 3 | **书脊静态渐变阴影** | §3.5 | 一条 CSS gradient div 或容器内阴影，约 10 行立刻获得「书」的质感 |
| 4 | **点状条可点击跳页** | 自有需求 | 现有 dots 从纯展示改为 button 组（aria-label=第 N 页）；6-8 页规模无需缩略图总览 |
| 5 | **相邻页预加载** | 自有需求 | 渲染 `pageIndex±1` 两张隐藏 `<link rel=preload>` 或隐藏 Image，消除翻页白屏 |

**不采纳**：引入 page-flip 依赖（常驻 rAF + 每帧重写 cssText 与 React/Tailwind 声明式风格冲突）；软页 clip-path 数学（维护成本高于收益，视觉上限不比硬页高多少）；双页对开（面板宽度受限，Schema 为线性单页流）；hover 角落预折叠（锦上添花，优先级最低）。

## 五、证据与边界

- 证据等级：**事实**——StPageFlip 克隆源码直读，MIT 许可，快照日期 2026-08-26；
- 本文档只提炼模式不复制代码；落地实现须以 EduCanvas token/GSAP 体系原创重写；
- 实施约束：翻页动画遵守 `prefers-reduced-motion`；imageUrl 已由 Schema 强制同源受控路径，优化不得绕过该信任边界；键盘左右方向键行为保留。
