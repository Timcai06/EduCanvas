# ADR-0033：引入 Motion 与 React Bits 组件模式

- 状态：`accepted`
- 日期：2026-08-24
- 负责人：@Timcai06
- 上位决策：[ADR-0005](./0005-模块化单体产物与持久任务.md)、[ADR-0009](./0009-统一画布工作面与运行时分层.md)、[ADR-0001](./0001-以教育能力为核心的个人智能体平台.md)

## 背景

EduCanvas 前端既往以 GSAP 作为唯一动效引擎（`features/theme/motion.ts` 统一消费 `--duration-*` token），
并把「两支笔」（纸/墨/墨紫/朱砂）作为唯一视觉基线。若要引入 React Bits 这类已封装为
`motion`(framer-motion) 的成品动效与交互组件，会出现第二套动效库与既有 GSAP+token 体系并存。
产品希望在保留最高质感的前提下引入新组件，并接受「为最佳效果适度放宽既有视觉表述」。

## 候选方案

| 方案               | 做法                                                          | 结论                                     |
| ------------------ | ------------------------------------------------------------- | ---------------------------------------- |
| A 单一 GSAP 移植   | 把所有 React Bits 组件移植成 GSAP/CSS，保住唯一动效体系        | 拒绝：复杂组件（carousel/dock/scroll）移植成本高、保真度下降 |
| B 双轨：GSAP+Motion | 既有 GSAP 体系不动，新增 `motion`；按组件原库接入，视觉统一归 token | **采纳**：保真度优先，视觉仍贴合产品       |
| C 全量换 Motion    | 弃用 GSAP，整体迁移到 motion                                   | 拒绝：大规模无收益重写，破坏既有动效       |

## 决定

1. 新增依赖 `motion`（framer-motion 的成品名）。
2. **动效双轨**：既有 GSAP 状态迁移仍走 `features/theme/motion.ts`；采用 `motion` 的组件
   （React Bits 或其重构版）用 motion 原生 API，但**颜色/字体/间距/投影/明暗/reduced-motion
   一律仍走项目 token 与规范**，不使用组件自带硬编码色值。
3. **React Bits 组件接入准则**：只借「结构与动效机制」；视觉与交互按产品重做。默认排除
   与「安静课桌」气质冲突的霓虹/激光/金属类组件。是否接入以「是否真正提升体验」为准，
   不因数量勉强塞入；不接的组件须在 DESIGN.md 记录取舍理由。
4. **Lenis（平滑滚动）**：评估后**不采纳**。ScrollStack 依赖 lenis 劫持 window 滚动，与项目
   「内部容器各自滚动 + `html overflow:hidden`」的模型冲突，且当前无贴合落点；项目滚动维持现状。
5. **WebGL 氛围层（如 Topography）**：沿用项目既有策略——reduced-motion 下不挂载（真省 GPU），
   `pointer-events:none`，只作纯装饰。
6. **设计系统**：`DESIGN.md` 允许在「最佳效果需要」时对旧表述选择性放宽；放宽处更新 DESIGN.md。

## 后果

- 动效链出现 GSAP 与 motion 两套实现，需在 DESIGN.md 明确各自适用范围，避免组件风格漂移。
- 新组件为客户端专用；服务器边界、测试与 lint/typecheck 须保持通过，组件不能引入服务端
  不兼容代码。
- 视觉基线由「两支笔」演化为「产品克制质感 + 必要新组件」；DESIGN.md 相应更新。
- `lenis` 未落地：不引入平滑滚动库，项目滚动体系维持现状，避免滚动接管风险。

