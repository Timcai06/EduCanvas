# 画布界面与可访问性优化

- 任务分配名：`F 画布界面`
- 状态：`completed`
- 负责人：协作开发者
- 代码审核与最终验收：Codex
- 最后验证时间：2026-07-30
- 已完成关联计划：[UV 画布语音](UV-画布语音.md)
- 产品规范：[学生界面规范](../../01-product/02-学生界面规范.md)
- 视觉规范：[视觉回归](../../06-quality/04-视觉回归.md)

## 一、交付目标

在不修改 Canvas 协议、资源读取、Renderer、Runtime、语音、数据库或 Gateway 的前提下，
收口 Canvas 外壳的焦点、键盘、响应式、安全区、单滚动所有权、状态展示和视觉回归。

## 二、实际交付

- `CanvasHost` 统一进入焦点、Escape 关闭与关闭后焦点归还；
- 小屏、桌面、全屏和四向 safe-area 使用同一外壳契约；
- Canvas 内容区是唯一纵向滚动所有者，页面 body 不产生第二条滚动条；
- `CanvasShellStatus` 统一 loading、empty、failed、unavailable、denied 的语义、
  可访问角色和安全重试入口；
- 真实页面 E2E 覆盖键盘、长标题、长内容、失败态、暗色和 reduced-motion；
- 未复制主线协议、registry、资源加载或权限判断。

## 三、最终文件边界

- `apps/web/features/canvas/canvas-host.tsx`
- `apps/web/features/canvas/canvas-host-utils.ts`
- `apps/web/features/canvas/canvas-host.test.ts`
- `apps/web/features/canvas/canvas-shell-status.tsx`
- `apps/web/features/canvas/canvas-shell-status-contract.ts`
- `apps/web/features/canvas/canvas-shell-status.test.ts`
- `tests/e2e/canvas-shell-visual.spec.ts`
- `docs/06-quality/04-视觉回归.md`

## 四、验收证据

| 任务             | 结论   | 证据                                                                                         |
| ---------------- | ------ | -------------------------------------------------------------------------------------------- |
| F00 基线与所有权 | `PASS` | 文件边界和调用方已复核，与主线开发文件无交集                                                 |
| F01 焦点与键盘   | `PASS` | `CanvasHost` 直接处理进入、Escape 和焦点归还；相邻单元测试通过                               |
| F02 响应式与滚动 | `PASS` | 四向 safe-area、单滚动所有者和长标题契约均有代码与测试                                       |
| F03 状态组件     | `PASS` | 五种状态的 role、文案、重试和长内容契约均有直接测试                                          |
| F04 视觉与 E2E   | `PASS` | `canvas-shell-visual.spec.ts` 真实断言 overflowY、scrollHeight/clientHeight 与 body overflow |
| F05 收口         | `PASS` | 主线现有 CanvasHost/CanvasShellStatus 31 条相邻测试通过，F 线文件已合入                      |

## 五、关键偏差与后续去向

- E2E 曾暴露共享 Worker/Fixture 不稳定，但不是 F 线视觉代码缺陷；CI 可信度门禁由独立
  测试基础设施修复处理。
- 资源、Renderer 和持久 Runtime 已由 [UV 画布语音](UV-画布语音.md)完成收口；本计划
  不再恢复为 active。
