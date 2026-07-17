# 视觉回归与动效验收

- 状态：`accepted`
- 最后验证时间：2026-07-16

本文维护可重复的视觉、无障碍和动效性能证据。仓库根目录不再保存一次性视觉验收记录；稳定规格回写到产品/工程文档，自动化证据保存在测试与快照目录，人工验收结论更新本文。

## 当前自动化证据

| 流程 | 测试 | 快照 |
| --- | --- | --- |
| Chat-empty 桌面/移动端 | `tests/e2e/learning-visual.spec.ts` | `tests/e2e/learning-visual.spec.ts-snapshots/` |
| AI 不可用诚实失败态 | `tests/e2e/learning-visual.spec.ts` | `chat-unavailable-mobile-*` |
| `pipeline_flow` 桌面/移动/reduced-motion | `tests/e2e/pipeline-flow.spec.ts` | `tests/e2e/pipeline-flow.spec.ts-snapshots/` |
| 主学习流程、Canvas、判分与进度 | `tests/e2e/learning-flow.spec.ts` | 行为断言，不以截图代替状态断言 |

Darwin 与 Linux 快照都进入版本控制，用于区分字体/栅格化差异。更新快照前必须确认是设计变化而非动画未稳定、字体缺失或数据库 Fixture 漂移。

## Halo 与 GSAP 性能边界

- 大面积 gradient 与 `filter: blur()` 固定在静态视觉子层；Timeline 只改变 wrapper 的 `transform` 与 `opacity/autoAlpha`；
- `useGSAP()` 必须绑定局部 scope，并在组件卸载时清理 Timeline 与 matchMedia；
- 页面 hidden 时暂停无限动画，visible 时恢复；
- `prefers-reduced-motion: reduce` 不创建无限 Timeline，只设置静态终态；
- 移动端减少动态层数量和 blur 尺寸；
- 首次栅格化后，5 秒录制窗口不应出现 Halo 导致的持续 Layout、连续 Paint 或超过 50ms 的长任务。

当前实现位于 `apps/web/features/workspace/shared/ambient-halo.tsx` 与 `apps/web/app/globals.css`。Halo 只提供环境层次，不承担产品状态、Agent 状态或 Artifact 动画协议。

## Canvas 动画边界

- 模型只能生成通过白名单 Schema 的语义参数，不能提交 selector、Timeline、任意属性或 GSAP 源码；
- `AnimationShell` 负责播放、暂停、跳转、重置、速度和 reduced-motion；
- 客户端动画观察是不可信事件，不能直接更新学习状态或掌握度；
- 视觉完成与可信业务完成必须分离，只有 runtime 验证后的领域事件可以改变 K12 投影。

## 人工验收清单

- [ ] Chat-empty 与参考方向在同一视口并排检查，确认 Composer 是最高注意力层级、光场无硬边；
- [ ] 390×844、320px 和 200% 缩放无横向溢出；
- [ ] 键盘、读屏、焦点归还、Canvas/Sheet 模态语义通过；
- [ ] reduced-motion 下无无限呼吸或装饰性自动播放；
- [ ] 一台低端或节能模式设备复核滚动、输入和 Halo 并行时无明显掉帧；
- [ ] Canvas Sidecar、Sources Drawer、Studio 等新表面加入后补同视口回归状态。

## 事实边界

本文件只证明视觉和交互基线，不证明真实 Provider、RAG、Artifact 生成或学习状态闭环已经完成。产品能力状态以 canonical 产品/架构文档和 active plan 为准。

