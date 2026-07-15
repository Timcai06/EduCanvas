# Chat-first Halo v2 视觉与性能验收

- 状态：`implementation candidate`
- 结论：单层高饱和椭圆已替换为近黑背景上的三层环境光场；自动化边界已经建立，最终质感仍需同视口人工并排与真实低端设备 trace 签字。
- 参考截图：`/Users/tim/.codex/visualizations/2026/07/14/019f5efd-61fb-78d1-9bfd-bdb67b45f75b/gemini-dark-reference-1512x771.jpg`
- 当前实现截图：`/Users/tim/.codex/visualizations/2026/07/14/019f5efd-61fb-78d1-9bfd-bdb67b45f75b/educanvas-dark-empty-1512x771.jpg`

本文件记录可重复的实现与证据，不把 Gemini 截图中的品牌色值、精确位置或动画参数冒充为 Google 规范。

## 当前事实

- 页面已经使用近黑背景、居中问候和单一 Composer 的 Chat-empty 起点。
- 光场由 haze、bloom、core 三个错位 wrapper 组成，叠加暗部 vignette；每层 gradient/blur 固定在静态子层。
- GSAP 只负责 wrapper 的进入、轻微位移/缩放和透明度呼吸；页面 hidden 时暂停，visible 时恢复。
- reduced-motion 只设置静态终态，不创建无限 Timeline并移除 `will-change`；移动端隐藏 bloom，只动画 core。
- 当前生产入口不再调用固定教师话术；无真实 Provider 时明确显示 AI 服务未接入。
- Canvas、进度、资产与 Studio 仍是按需表面，不在初始状态展开。

## 固定截图状态

| 状态               | 视口       | 动态偏好 | 自动化证据                         |
| ------------------ | ---------- | -------- | ---------------------------------- |
| Chat-empty desktop | 1440 × 900 | reduce   | `chat-empty-desktop-dark.png`      |
| Chat-empty mobile  | 390 × 844  | reduce   | `chat-empty-mobile-dark.png`       |
| AI unavailable     | 390 × 844  | reduce   | `chat-unavailable-mobile-dark.png` |

截图由 `tests/e2e/learning-visual.spec.ts` 生成。视觉断言禁用动画并模拟 reduced-motion，避免无限呼吸 Timeline 造成像素基线漂移。

## 2026-07-15 本地自动化证据

- Chromium，1440×900，等待进入动画 1.8 秒后录制 5 秒 DevTools Timeline：`Layout=0`、`Paint/PaintImage=0`、`>50ms RunTask=0`；该结论证明当前空态呼吸阶段保持 compositor-only，不替代低端真机验收；
- reduced-motion 下分别在加载后和 5 秒后截图，原始像素 Buffer 一致；
- 浏览器行为检查已覆盖移动 Canvas `dialog + aria-modal`、顶栏/Chat `inert`、可见焦点循环与关闭归还；
- 320px 与 640px 视口下模拟 200% CSS zoom，`documentElement.scrollWidth <= innerWidth`。
- 颜色 token 计算：正文/Canvas 对比度约 17.4:1，弱正文/Canvas 约 7.4:1，强调焦点/Surface 约 5.0:1，组件边界/Surface 约 3.0:1。

## 动画性能边界

- GSAP 只改变 `transform` 与 `opacity/autoAlpha`。
- 渐变、`filter: blur()` 和几何尺寸保持静态，避免逐帧触发大面积绘制。
- `useGSAP()` 必须绑定组件 scope，并在组件卸载时清理 Timeline/matchMedia。
- `prefers-reduced-motion: reduce` 下不运行无限 Timeline，只设置静态终态。
- 5 秒 Performance trace 应在首次栅格化后无Halo导致的持续Layout/连续Paint，也不得出现由Halo导致的>50ms长任务；未取得trace前不得把性能项标记为pass。

## `pipeline_flow` C2 证据

- 默认关闭的`/design-qa/pipeline-flow`只在`EDUCANVAS_ENABLE_DESIGN_QA=true`时通过服务端gate动态加载固定fixture；页面不接收输入，也不读取数据库或Provider；生产构建未设置该开关时实测HTTP 404，浏览器静态chunks检索不到fixture内容；
- 快照：`pipeline-flow-desktop-chromium-darwin.png`、`pipeline-flow-mobile-chromium-darwin.png`、`pipeline-flow-reduced-motion-chromium-darwin.png`，位于`tests/e2e/pipeline-flow.spec.ts-snapshots/`；
- Chromium E2E覆盖桌面键盘跳转、1.5×播放、人工暂停点、重置，390×844移动无横向溢出，以及reduced-motion同步前进并禁用速度选择；
- `completionMessage`只在最后一步展示；Renderer使用React生成的本地ID维持`aria-labelledby`，即使协议中的`artifactId`含空格也不破坏region名称；reduced-motion下动画节点的`will-change`计算值为`auto`；
- 播放窗口PerformanceObserver证据：`layoutShift=0`、`longTasks=0`。Timeline只修改卡片/连接线的transform与opacity，不逐帧改布局、blur或gradient；
- 客户端只显示“不可信动画观察”。协议回归证明普通`animation_step_completed`不能通过现有判分路径，因此不会产生mastery；可信完成仍须由后续runtime边界确认。

## 人工与设备验收清单

- [ ] 1512×771 同视口下参考图与实现图并排，确认光场无硬边、Composer亮度高于背景且中心不贴输入框；
- [ ] 390×844 与320px确认haze裁切自然、标题和Composer无横向溢出；
- [ ] 200%缩放、键盘、读屏状态和reduced-motion复核；
- [ ] 桌面Chrome录制5秒Performance trace并记录Layout/Paint/长任务结论；
- [ ] 一台低端或节能模式设备复核滚动、输入与Halo并行时无明显掉帧。
