# 设计：EduCanvas 桌面助手小窗（Electron）

> 日期：2026-08-08 · 状态：已批准（brainstorming 会话）
> 前置需求（用户逐题确认）：本地后端 / Electron / 关闭进托盘 / 不持久化对话历史 / 只做对话不复刻原界面 / 零安装（portable exe）

## 1. 目标与边界

桌面小对话窗口，独立于浏览器常驻（托盘），零安装体验。只做对话：输入自然语言指令 → 调用本地 EduCanvas 的 assistant API → 气泡反馈。不做：

- 登录/账号流程（本地环境身份自动回退 `local:owner`）
- 对话历史持久化（每次打开全新对话，与网页助手一致）
- 页面跳转/产物渲染（open_artifact/open_panel 只反馈文案）
- 开机自启、全局快捷键（YAGNI，后续可加）

## 2. 工程结构

新 top-level 目录 `apps/desktop/`（**按仓库规则需 Code Owner 审批**，PR body 注明）。

```
apps/desktop/
├── package.json                   # electron/vite/react/electron-builder 均为 devDependencies
├── electron-builder.yml           # target: portable（绿色单 exe，零安装）
├── vite.config.ts                 # 仅构建 renderer
├── tsconfig.json
├── src/
│   ├── main/
│   │   ├── index.ts               # 生命周期：单实例锁、createWindow、Tray
│   │   ├── window.ts              # 380×600 标准框小窗；close=hide
│   │   ├── tray.ts                # 托盘图标/菜单（显示/退出）
│   │   └── assistant-proxy.ts     # 核心：ipc 'assistant:turn' → fetch 本地 API
│   ├── preload/index.ts           # contextBridge 暴露 window.desktopAssistant.turn(text, signal)
│   └── renderer/                  # Vite+React 轻量对话 UI
│       ├── index.html / main.tsx
│       ├── App.tsx                # 气泡列表+输入框（复用 assistant-panel 的 UI 模式）
│       ├── use-assistant-turn.ts  # 移植 useAssistantStream（fetch → ipc）
│       ├── turn-request.ts        # 请求构造纯函数（供单测）
│       └── turn-response.ts       # 响应/错误解析纯函数（供单测）
└── tests/assistant-proxy.test.ts  # 单测（逻辑与 electron 解耦）
```

根 `package.json` workspace 加入 `"apps/desktop"`。图标：复用紫色墨点图形（与 PWA 图标同源生成），产 .ico（窗口+托盘）与 png。

## 3. 数据流

```
Renderer 输入指令
  → window.desktopAssistant.turn(text, signal)      [preload, contextBridge]
  → ipcRenderer.invoke('assistant:turn', {text})    [AbortSignal 透传]
  → Main assistant-proxy：
      fetch POST {baseUrl}/api/v1/assistant/turn
      headers: { 'content-type': 'application/json' }   ← 无 Origin / 无 sec-fetch-site
      body: { text, clientMessageId: randomUUID() }
  → 本地 web dev (默认 http://localhost:3000)
      isTrustedSameOriginWrite 无 Origin 分支通过
      本地模式 readAnonymousIdentity 回退 local:owner（免登录）
  → 200 { action, message, ... } → 气泡渲染
```

关键约束（依赖现有后端行为，不得改动 apps/web 鉴权代码）：

- `isTrustedSameOriginWrite`（`apps/web/server/http/request-security.ts`）：无 Origin 头时仅检查 `sec-fetch-site !== 'cross-site'`——Node fetch 两头部不带，天然通过。
- 本地身份回退：`EDUCANVAS_DEPLOYMENT_ENV=local` 且 `EDUCANVAS_LOCAL_USER_ID`（或默认 `local:owner`）→ 无需 cookie。
- 若后端将来收紧该分支，桌面壳需同步演进（新增专用无鉴权入口或 token），超出本设计范围。

响应处理（与网页面板一致）：

- `created/renamed/deleted/switched` → 显示 `message`（操作已在 db 生效）
- `open_artifact/open_panel/list_artifacts` → 显示返回 `message`，不做跳转
- `unknown` → 显示能力说明 message

取消：`ipcRenderer.invoke` 支持透传 AbortSignal；main 侧监听 abort 中止 fetch。

## 4. 窗口与托盘

- BrowserWindow：380×600、标准框（系统标题栏可拖动缩放）、`show: false` 就绪后显示
- `close` 事件 → `preventDefault` + `hide()`；首次隐藏向 renderer 发提示「已最小化到托盘，右键托盘图标可退出」
- Tray：单击 toggle 显示/隐藏；右键菜单「显示」「退出」；`app.quit` 前 `tray.destroy`
- 单实例锁：`app.requestSingleInstanceLock`，二次启动 `show()` 聚焦已有窗口
- 主进程不加载远程内容，仅 `loadFile` 本地构建产物（renderer 无 Node 权限，contextIsolation: true）

## 5. 错误处理

| 场景 | 判定 | 表现 |
|---|---|---|
| 本地服务未启动 | fetch 抛 ECONNREFUSED | 气泡红字「本地服务未启动（先 pnpm dev:all）」 |
| HTTP 4xx/5xx | 状态码 400/401/403/404/429/503 | 解析 `error.message` 显示，保留默认兜底文案 |
| 模型超时 | 20s 超时（AbortSignal.timeout 组合） | 「请求超时，请重试」 |
| 用户取消 | AbortSignal abort | 气泡保持 pending 态清空，不显示错误 |

渲染层复用现有面板的 busy/disabled/失败重发交互。

## 6. 测试

- `tests/assistant-proxy.test.ts`（vitest，**不 import electron**，注入 `fetch`/`baseUrl` 依赖）：
  - 请求头：无 Origin、无 sec-fetch-site、content-type 正确
  - URL 拼接与 `clientMessageId` 生成（每次调用新 UUID）
  - 错误映射：ECONNREFUSED → backend_offline；各状态码 → 文案
  - Abort：fetch 收到 signal.aborted
- renderer 的请求构造/响应解析抽纯函数（`turn-request.ts`/`turn-response.ts`）单测
- 手动验收项（本地）：窗口打开/关闭进托盘/托盘点击恢复/退出；对话成功/服务未启动两条路径；portable exe 双击可运行

## 7. CI 与治理

- `tooling/quality/ci-impact.mjs`：`apps/desktop` 改动分类 → checks lane（lint/typecheck/unit 全仓跑），新增 **desktop build job**（`pnpm --filter @educanvas/desktop build` + `electron-builder --dir` 验证可构建；Linux CI 上 electron-builder 打包 portable 需 win 目标——job 内仅验证 `--dir` 构建产物，Windows 安装包留本地/手动发布）
- secret-scan 自动覆盖新代码；gitleaks allowlist 不得为桌面壳新增通配忽略
- dependency-review：electron 依赖树大，PR 需核对 license（MIT）与 high 级漏洞；如有 high 漏洞按供应链文档流程处理（升级/替代/审批豁免）
- repo governance（`pnpm file:check`）：新包遵循 `apps/` 现有模式（同 apps/web 的 package.json 约定）
- 覆盖门禁无影响（仅 telemetry/agent-core/agent-runtime 三包有阈值）
- 分支：`feat/20260808-desktop-assistant`；PWA 三个 commit 所在分支 `feat/20260808-pwa-install` 删除（方向已否决，未 push）
- 新 top-level 目录 → 合并需 Code Owner 审批（PR body 注明本设计文档链接）

## 8. 验收标准

1. `pnpm --filter @educanvas/desktop dev`（或 `pnpm dev:desktop`）启动小窗，对话成功（依赖本地 dev:all 全套）
2. 关闭进托盘；托盘单击恢复；右键退出干净（进程结束）
3. 本地服务未启动时气泡给出明确指引
4. CI 全绿（含 desktop build job 与 dependency-review）
5. 手动验证 portable exe 双击即用
