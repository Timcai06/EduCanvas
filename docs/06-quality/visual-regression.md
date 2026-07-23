# 视觉回归与动效验收

- 状态：`accepted`
- 最后验证时间：2026-07-22

本文维护可重复的视觉、无障碍和动效性能证据。仓库根目录不再保存一次性视觉验收记录；稳定规格回写到产品/工程文档，自动化证据保存在测试与快照目录，人工验收结论更新本文。

## 当前自动化证据

| 流程                                     | 测试                                | 快照                                           |
| ---------------------------------------- | ----------------------------------- | ---------------------------------------------- |
| Chat-empty 桌面/移动端                   | `tests/e2e/learning-visual.spec.ts` | `tests/e2e/learning-visual.spec.ts-snapshots/` |
| AI 不可用诚实失败态                      | `tests/e2e/learning-visual.spec.ts` | `chat-unavailable-mobile-*`                    |
| `pipeline_flow` 桌面/移动/reduced-motion | `tests/e2e/pipeline-flow.spec.ts`   | `tests/e2e/pipeline-flow.spec.ts-snapshots/`   |
| 主学习流程、Canvas、判分与进度           | `tests/e2e/learning-flow.spec.ts`   | 行为断言，不以截图代替状态断言                 |

Darwin 与 Linux 快照都进入版本控制，用于区分字体/栅格化差异。更新快照前必须确认是设计变化而非动画未稳定、字体缺失或数据库 Fixture 漂移。

## 装饰动效、GPU 状态反馈与性能边界

受控持续动效是视觉语言的一部分，不等于伪造产品状态。扉页墨点场可以持续呈现纸墨氛围；Agent busy 边缘流光只能由真实 Turn 的 busy 状态驱动，结束、取消或失败后必须退出，不能用固定计时器冒充 Agent 仍在工作。两者都不承载答案、成绩、审批或 Artifact 完成等可信事实。

- Timeline 主要改变 `transform` 与 `opacity/autoAlpha`；DrawSVG 笔触只改变 stroke-dash。持续 WebGL 只用于已登记的扉页墨点场和 Agent busy 边缘反馈，新增用途必须先补本文预算和验收状态；
- `useGSAP()` 必须绑定局部 scope，并在组件卸载时清理 Timeline 与 matchMedia；WebGL 必须幂等释放 RAF、Observer、Texture、Material、Geometry、Composer、Renderer 与 Context；
- `document.visibilityState === 'hidden'` 后停止 JS 无限循环和 WebGL 渲染，恢复 visible 后由单一调度器继续，不能在后台维持空转 RAF；
- `prefers-reduced-motion: reduce` 不创建无限 Timeline 或持续 WebGL，使用信息等价的静态终态；偏好尚未解析时也不能先短暂创建 GPU 上下文；
- 扉页视觉层保持 `pointer-events: none`，交互坐标由页面级监听投影，不能为了涟漪阻断 Composer、侧栏或键盘操作；
- 纸纹肌理是纯静态 CSS 背景（不透明度 <5%），不参与动画；
- 首次栅格化后，5 秒录制窗口不得出现持续 Layout、与动效同步的全屏 Paint 或超过 50ms 的长任务；目标测试设备的活跃动画帧率不得低于 50 FPS；
- 同一工作区常态最多一个扉页 WebGL Context，busy 时最多临时增加一个。重复执行十次“空会话→发送→返回空会话”后，Context、RAF 与监听器数量必须回到当前可见状态的基线；
- Three、Postprocessing 和 Shader 必须保持浏览器动态加载，不得进入服务端或无动效路由的关键 Chunk。涉及依赖或 shader 变化的 PR 必须记录生产构建 Chunk 增量，并在低端或节能模式设备完成一次实跑。

当前实现位于 `apps/web/features/workspace/shared/` 的品牌、墨点场与 Agent busy 组件，以及 `apps/web/app/effects.css`；全局 Token 和正文排版仍由 `apps/web/app/globals.css` 负责。装饰动效不承担教学状态或 Artifact 动画协议，Agent busy 只映照真实运行状态。

## Canvas 动画边界

- 模型只能生成通过白名单 Schema 的语义参数，不能提交 selector、Timeline、任意属性或 GSAP 源码；
- `AnimationShell` 负责播放、暂停、跳转、重置、速度和 reduced-motion；
- 客户端动画观察是不可信事件，不能直接更新学习状态或掌握度；
- 视觉完成与可信业务完成必须分离，只有 runtime 验证后的领域事件可以改变 K12 投影。

## 人工验收清单

- [ ] Chat-empty 在同一视口检查亮/暗双主题，确认 Composer 是最高注意力层级、朱砂只出现在批改/审批/品牌语义处；
- [ ] 390×844、320px 和 200% 缩放无横向溢出；
- [ ] 键盘、读屏、焦点归还、Canvas/Sheet 模态语义通过；
- [ ] reduced-motion 下无无限呼吸或装饰性自动播放（含输入框边缘扫光整层隐去、只保留静态黛青聚焦描边）；
- [ ] 输入框边缘墨光扫光平时极淡、聚焦时提亮，且始终在文字与图标之下（不遮挡内容、不拦截输入/焦点）；
- [ ] 一台低端或节能模式设备复核滚动、输入与流式回答并行时无明显掉帧；
- [ ] Canvas Sidecar、Sources Drawer、Studio 等新表面加入后补同视口回归状态。

## 事实边界

本文件只证明视觉和交互基线，不证明真实 Provider、RAG、Artifact 生成或学习状态闭环已经完成。产品能力状态以 canonical 产品/架构文档和 active plan 为准。
