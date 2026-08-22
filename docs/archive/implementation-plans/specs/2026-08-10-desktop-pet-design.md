# 设计：EduCanvas 桌宠壳（P1，Electron 像素桌宠）

> 日期：2026-08-10 · 状态：已批准（brainstorming 会话）
> 依据：ADR-0024「远端桌宠运行形态与语音交互边界」（方案 B：Electron + React + 2D 像素 Sprite）
> 用户逐项确认：双平台（macOS 优先演示、Windows 同流程） / 素材先占位后定 / apps/desktop 演进替换文本小窗

## 1. 目标与边界

把现有 `apps/desktop`（380×600 标准框文本助手）演进为**透明无框像素桌宠壳**：独立常驻、可拖动、状态动画（idle/listen/think/speak/success/error）、点击交互占位。为 P2（语音链路）、P3（gateway 身份）提供形态与契约地基。

P1 不做（后续 P 系列）：

- 真实录音 / ASR / TTS / 语音 Provider
- gateway 第一方会话、OAuth 登录、deep link
- Web/Canvas handoff、气泡字幕、恢复操作
- 真实角色素材（占位角色后置替换）
- macOS 打包验证（P5 统一双平台验收）
- 透明区鼠标穿透（P1 窗口严格贴合角色，无透明交互区；P2 加气泡后再做）

## 2. 工程结构（apps/desktop 演进）

```
apps/desktop/
├── scripts/generate-pet-sprites.mjs   # 零依赖生成占位 sprite sheet + manifest（Node zlib 手写 PNG 编码）
├── assets/pet/
│   ├── sprite-sheet.png               # 生成产物，git 跟踪（assets/ 非治理禁止段）
│   └── manifest.json                  # 帧尺寸/FPS/循环/锚点/状态映射（角色包替换契约）
├── src/shared/
│   ├── pet-state.ts                   # 状态机纯函数（状态/事件/转换表）
│   └── pet-clamp.ts                   # 多屏钳制纯函数
├── src/main/
│   ├── pet-window.ts                  # 透明无框窗、拖动 IPC、位置记忆、钳制、置顶
│   ├── index.ts                       # 改造：pet 窗口替换文本窗；托盘/单实例保留
│   └── assistant-proxy.ts             # 保留（P2/P3 语音 turn 复用骨架）
├── src/preload/index.ts               # 改造：暴露 pet 事件与位置/拖动桥
├── src/renderer/src/
│   ├── App.tsx                        # 整体替换：canvas sprite 渲染 + 状态机驱动 + 点击/拖动
│   ├── pet-sprite.ts                  # canvas 帧渲染（nearest-neighbor 整数倍）
│   └── pet-demo.ts                    # P1 演示时序：点击 → 完整状态序列（P2 换真事件）
├── tests/                             # pet-state / pet-clamp / manifest / 生成产物 单测
└── (旧对话 UI：App 重写，use-assistant-turn/turn-request/turn-response 暂保留)
```

## 3. 窗口行为（ADR §2）

- `BrowserWindow`：`transparent: true, frame: false, resizable: false`，尺寸 **128×128**（32×32 素材 ×4 整数倍）
- 初始位置：主屏 `workArea` 底部居中；之后记忆上次位置（userData `pet-window.json`）
- **拖动**：renderer pointer 事件——按下记录起点，移动距离 >6px 判定拖动（经 IPC 用屏幕坐标 `setPosition`），松开未拖动 = 点击。mousedown/mouseup 语义与点击不冲突
- **多屏钳制**（`pet-clamp.ts` 纯函数）：窗口矩形不在任何 display `workArea` 内时，钳回最近的 workArea 内（不永久丢到屏幕外）；显示器/分辨率变化时重新钳制
- `alwaysOnTop` 适度置顶（`level: 'floating'`），不默认全屏；焦点不抢
- 无边框窗口在 Windows/macOS 的显示差异由 main 封装，不泄漏到 renderer 契约

## 4. 角色与渲染（ADR §3）

**占位角色**（`generate-pet-sprites.mjs`，零依赖）：

- 32×32 像素角色，字符画 2D 数组定义（`#` 轮廓 / 主体色 / `.` 透明），程序化生成帧
- 帧集：`idle` 2 帧（呼吸 ±1px）、`walk` 4 帧（踏步）、`think`/`speak`/`success`/`error` 各 1-2 帧（表情/姿态差异）——共 11 帧
- 输出：`sprite-sheet.png`（32×N）+ `manifest.json`；PNG 用 Node `zlib` 手写 IHDR/IDAT/IEND + CRC32（无新依赖）
- 生成后单测校验：IHDR 尺寸、帧数 = manifest 声明、透明像素存在

**manifest 契约**（角色包替换接口）：

```json
{
  "frameWidth": 32, "frameHeight": 32, "fps": 8,
  "anchor": { "x": 16, "y": 32 },
  "states": {
    "idle":   { "frames": [0, 1],          "fps": 4, "loop": true },
    "walk":   { "frames": [2, 3, 4, 5],    "fps": 10, "loop": true },
    "think":  { "frames": [6, 7],          "fps": 4, "loop": true },
    "speak":  { "frames": [8],             "fps": 8, "loop": true },
    "success":{ "frames": [9],             "fps": 8, "loop": false },
    "error":  { "frames": [10],            "fps": 8, "loop": false }
  }
}
```

- 渲染：canvas 2D `drawImage` + `imageSmoothingEnabled = false`，整数倍缩放（retina 下按 devicePixelRatio 再整数倍），像素锐利
- 业务状态机只消费 manifest 声明的状态名；角色包换包 = 替换 `assets/pet/` 下两个文件

**reduced motion**：`nativeTheme.shouldUseReducedMotion`（监听变化经 preload 推送）——禁用 idle 踱步与 walk，只保留表达状态的最小动画（帧切换保留）

## 5. 状态机（`pet-state.ts`）

```ts
type PetState = 'idle' | 'listen' | 'think' | 'speak' | 'success' | 'error';
type PetEvent =
  | 'pet_click'        // idle 下点击 = 开始（P1 演示；P2 后 = 开始录音）
  | 'cancel'           // 交互中点击 = 取消回 idle
  | 'listen_done' | 'think_done' | 'speak_done'   // 演示时序驱动
  | 'demo_fail';       // 演示可模拟失败路径 → error
  | 'demo_reset';      // 演示终态（success/error）展示完后回 idle
```

转换表（纯函数 `transition(state, event) → state`）：

| 状态 \ 事件 | pet_click | cancel | listen_done | think_done | speak_done | demo_fail | demo_reset |
|---|---|---|---|---|---|---|---|---|
| idle | listen | idle | — | — | — | — | — |
| listen | idle | idle | think | — | — | error | — |
| think | idle | idle | — | speak | — | error | — |
| speak | idle | idle | — | — | success | error | — |
| success | — | — | — | — | — | — | idle |
| error | — | — | — | — | — | — | idle |

**P1 演示时序**（`pet-demo.ts`）：idle 点击 → `listen`（800ms）→ `think`（1s）→ `speak`（1.5s）→ `success`（600ms）→ 回 idle。交互中点击 = `cancel` 立即回 idle（对应 ADR「再次点击取消」）。P2 接入真语音后，demo 事件换成 Voice/Agent 真实事件，状态机与表现层不动。

## 6. idle 踱步行为（ADR §2「偶尔小范围移动」）

- idle 且非交互时，每 15-30s（随机）触发一次踱步：`walk` 动画 + 位置微移（≤60px/次），到达窗口边界停顿 ≥2s 再回走
- **交互中（listen/think/speak/success/error）位置稳定**，不移动
- reduced motion 下禁用踱步
- 踱步实现：renderer 发起目标偏移（经 IPC 让 main `setPosition`），main 做边界钳制

## 7. 托盘与生命周期（沿用现有，微调文案）

- 保留：单实例锁、托盘（图标 + 「显示/隐藏」「退出」）、关闭=隐藏到托盘、仅托盘退出真退出
- toast 文案改：首次隐藏提示「已隐藏到托盘，右键托盘图标可显示或退出。」

## 8. 测试

**单测（vitest，不启动 Electron）**：

- `pet-state.test.ts`：转换表全覆盖（每单元格至少一例；非法事件/状态保持原状态）
- `pet-clamp.test.ts`：窗口在各 workArea 内/外/跨屏的钳制结果
- `pet-manifest.test.ts`：manifest 解析、帧索引越界、状态名缺失报错
- `sprites.test.ts`：生成脚本产物校验（PNG IHDR 尺寸、帧数、manifest 一致性）

**手动验收（Windows 本机；macOS 对齐留 P5）**：

1. `pnpm dev:desktop` 桌面站起透明像素角色，无边框
2. 拖动角色 → 位置跟随；重开应用位置记忆生效
3. 点击 → listen→think→speak→success 动画序列 → 回 idle；交互中点击立即取消回 idle
4. idle 等待 ≤30s 出现踱步，边缘停顿；交互中不移动
5. 系统开启 reduced motion → 踱步停止，最小动画保留
6. 托盘隐藏/显示/退出干净；单实例二次启动聚焦
7. 关掉显示器分辨率场景（如有条件）位置钳回可见区域

## 9. 验收标准

1. 桌宠壳在 Windows 上以透明无框像素角色形态常驻，托盘生命周期完整
2. 拖动/位置记忆/踱步/钳制行为符合 ADR §2；reduced motion 符合 ADR §3
3. 状态机转换表 100% 单测覆盖，生成产物校验通过
4. manifest 契约可支撑后续真实素材直接换包
5. CI 全绿（desktop lane 覆盖新测试与构建）

## 10. 后续衔接（不在 P1 范围）

- P2 语音链路：Voice Port + ASR/TTS Provider + 点击=录音（状态机事件换真），气泡字幕 → 引入窗口尺寸扩展与穿透
- P3 远端身份：gateway 第一方会话 + OAuth + deep link（macOS open-url / Windows 单实例回调）
- P4 Web/Canvas handoff；P5 双平台打包验证
