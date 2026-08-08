# EduCanvas 桌面助手小窗（Electron）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 一个独立于浏览器的桌面小对话窗口：托盘常驻、零安装（portable exe）、只做对话，通过主进程代理调用本地 EduCanvas 的 `/api/v1/assistant/turn`。

**Architecture:** 新 top-level 目录 `apps/desktop/`（Electron + electron-vite + React）。三进程模型：renderer（轻量对话 UI）→ preload（contextBridge）→ main（窗口/托盘/生命周期 + `assistant-proxy` 用 Node fetch 代理 API）。Node fetch 不带 Origin/sec-fetch-site 头，恰好通过后端 `isTrustedSameOriginWrite` 的无 Origin 分支；本地部署模式身份自动回退 `local:owner`，零登录。

**Tech Stack:** Electron、electron-vite、electron-builder（portable）、React 19（与 apps/web 同版本）、Vite、TypeScript、vitest（复用仓库工具链）。

## Global Constraints

- 依赖后端 `apps/web` 现有行为，**不得改动** `apps/web` 鉴权代码（`isTrustedSameOriginWrite`、`readAnonymousIdentity`）
- 不持久化对话历史；不做页面跳转（open_artifact/open_panel 只反馈文案）
- 不做开机自启、全局快捷键（YAGNI）
- `apps/desktop` 是新 top-level 目录 → 合并需 **Code Owner 审批**（PR body 注明 spec 链接）
- 依赖只进 `apps/desktop/package.json` 的 **devDependencies**（vite 打包后运行时无 node_modules 依赖）
- React 版本与 apps/web 对齐：`react@^19.2.7` / `react-dom@^19.2.7`
- 图标沿用紫色墨点设计（底 `#6a4a86` + 三个白点），生成一次后提交二进制产物
- 一个 commit 只做一件事；PR title = commit message（squash merge 规则）

---

### Task 1: apps/desktop 工程骨架

**Files:**
- Create: `apps/desktop/package.json`
- Create: `apps/desktop/tsconfig.json`（单 project，main/preload/renderer 共用一次 typecheck）
- Create: `apps/desktop/electron.vite.config.ts`
- Create: `apps/desktop/vitest.config.ts`
- Create: `apps/desktop/electron-builder.yml`
- Create: `apps/desktop/src/main/index.ts`（最小占位：空窗口）、`src/renderer/index.html`、`src/renderer/src/main.tsx`、`src/renderer/src/App.tsx`（占位文本）
- Create: `apps/desktop/build/icon.ico`（256）、`build/icon.png`（512，托盘 16/32 由 PNG 缩放）
- Modify: 根 `package.json` 加 `"dev:desktop"` 脚本（本任务一并做，属于工程接线）

**Interfaces:**
- Consumes: 仓库约定——`apps/*` workspace 通配已覆盖；turbo 任务（build/test/typecheck/lint）自动发现带脚本的包；eslint 仅 apps/web 有（desktop 不配 eslint，格式由根 `lint:format` 的 prettier glob 覆盖）
- Produces: `@educanvas/desktop` 包，`pnpm dev:desktop` 可启动、`pnpm --filter @educanvas/desktop build` 产出 `out/`、`pnpm --filter @educanvas/desktop test` 空跑通过

- [x] **Step 1: 创建 package.json**

```json
{
  "name": "@educanvas/desktop",
  "version": "0.1.0",
  "engines": {
    "node": ">=22 <23"
  },
  "private": true,
  "main": "out/main/index.js",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "start": "electron-vite preview",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "package:portable": "electron-vite build && electron-builder --win portable"
  },
  "devDependencies": {
    "@types/node": "^22.20.1",
    "@types/react": "^19.2.17",
    "@types/react-dom": "^19.2.3",
    "@vitejs/plugin-react": "^5.0.0",
    "electron": "latest",
    "electron-builder": "latest",
    "electron-vite": "latest",
    "react": "^19.2.7",
    "react-dom": "^19.2.7",
    "typescript": "^5.9.3",
    "vite": "^7.0.0",
    "vitest": "^4.1.10"
  }
}
```

（electron / electron-builder / electron-vite 用 `pnpm add -D` 安装，实际版本由 pnpm 解析并固化进 pnpm-lock.yaml。）

- [x] **Step 2: 创建 tsconfig.json（单 project）**

单个 project 同时含 main/preload/renderer/tests（node + DOM 类型合并，`tsc --noEmit` 一次全查；electron-vite 负责实际构建，tsc 只做类型检查，不需要 composite/references 项目模式）。

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["node"],
    "lib": ["ES2023", "DOM", "DOM.Iterable"]
  },
  "include": [
    "src/main/**/*",
    "src/preload/**/*",
    "src/renderer/src/**/*",
    "src/shared/**/*",
    "tests/**/*",
    "electron.vite.config.ts",
    "vitest.config.ts"
  ]
}
```

- [x] **Step 3: 创建 electron.vite.config.ts**

```ts
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { outDir: 'out/main' },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { outDir: 'out/preload' },
  },
  renderer: {
    plugins: [react()],
    resolve: { alias: { '@renderer': resolve('src/renderer/src') } },
    build: { outDir: 'out/renderer' },
  },
});
```

- [x] **Step 4: 创建 vitest.config.ts**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    passWithNoTests: true, // Task 1 阶段 tests/ 尚不存在，vitest run 不报错
  },
});
```

- [x] **Step 5: 创建 electron-builder.yml**

```yaml
appId: com.educanvas.desktop
productName: EduCanvas助手
directories:
  buildResources: build
files:
  - out/**
  - build/icon.png # 托盘图标在打包后仍需可用（asar 内 build/ 下）
win:
  icon: build/icon.ico
  target:
    - target: portable
      arch:
        - x64
portable:
  artifactName: EduCanvas-助手-${version}.exe
npmRebuild: false
```

- [x] **Step 6: 最小占位源码**（保证 build 可跑）

`src/main/index.ts`:
```ts
import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';

const createWindow = (): void => {
  const win = new BrowserWindow({
    width: 380,
    height: 600,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
    },
  });
  win.on('ready-to-show', () => win.show());
  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }
};

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
```

`src/preload/index.ts`（空壳占位，Task 3 填充）:
```ts
// Task 3 填充 contextBridge 暴露
export {};
```

`src/renderer/index.html`:
```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <title>EduCanvas 助手</title>
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'"
    />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`src/renderer/src/main.tsx`:
```tsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

`src/renderer/src/App.tsx`（占位）:
```tsx
export default function App(): React.JSX.Element {
  return <main className="placeholder">EduCanvas 助手（骨架）</main>;
}
```

`src/renderer/src/styles.css`:
```css
:root {
  --accent: #6a4a86;
  --ink: #2b2333;
  --surface: #ffffff;
}
* { box-sizing: border-box; }
html, body, #root { height: 100%; margin: 0; }
body { font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; }
.placeholder { height: 100%; display: grid; place-items: center; color: var(--accent); }
```

- [x] **Step 7: 生成图标并提交**（PowerShell System.Drawing，紫色底 + 三白点）

```powershell
Add-Type -AssemblyName System.Drawing
function New-IconPng($size, $path) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $bg = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(106, 74, 134))
  $g.FillRectangle($bg, 0, 0, $size, $size)
  $white = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
  $d = [int]($size * 0.18); $gap = [int]($size * 0.07); $y = [int]($size * 0.41)
  $x0 = [int](($size - (3 * $d + 2 * $gap)) / 2)
  $g.FillEllipse($white, $x0, $y, $d, $d)
  $g.FillEllipse($white, $x0 + $d + $gap, $y, $d, $d)
  $g.FillEllipse($white, $x0 + 2 * ($d + $gap), $y, $d, $d)
  $g.Dispose()
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
}
New-IconPng 512 'D:\Projects\EduCanvas\apps\desktop\build\icon.png'
# icon.ico：用 PowerShell 调 .NET 把 256px PNG 编码为 ICO（见下方命令序列）
```

`build/icon.ico` 生成：用 System.Drawing `Icon.FromHandle` 不可靠；改为在 PowerShell 中手工组装 ICO 头 + PNG 数据（256×256 PNG 内嵌 ICO 为合法格式）：

```powershell
# 1) 生成 256 PNG 到临时路径
New-IconPng 256 "$env:TEMP\icon256.png"
# 2) 组装 ICO（256x256 PNG-compressed 条目）
$png = [System.IO.File]::ReadAllBytes("$env:TEMP\icon256.png")
$ms = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter($ms)
$bw.Write([uint16]0); $bw.Write([uint16]1); $bw.Write([uint16]1)   # reserved/type/count
$bw.Write([byte]0); $bw.Write([byte]0); $bw.Write([byte]0); $bw.Write([byte]0)  # 256=>0
$bw.Write([uint16]1); $bw.Write([uint16]32)  # planes/bpp
$bw.Write([uint32]$png.Length); $bw.Write([uint32]22)  # size/offset
$bw.Write($png)
$bw.Flush()
[System.IO.File]::WriteAllBytes('D:\Projects\EduCanvas\apps\desktop\build\icon.ico', $ms.ToArray())
```

- [x] **Step 8: 根 package.json 加 dev:desktop 脚本**

在根 `package.json` scripts 的 `dev:core` 附近加：

```json
"dev:desktop": "pnpm --filter @educanvas/desktop dev",
```

- [x] **Step 9: 安装依赖并验证**

Run:
```bash
cd /d/Projects/EduCanvas
pnpm install
pnpm --filter @educanvas/desktop typecheck
pnpm --filter @educanvas/desktop build
pnpm --filter @educanvas/desktop test
```
Expected: typecheck 通过；build 产出 `out/main/index.js`、`out/preload/index.js`、`out/renderer/index.html`；test 报告 0 个测试文件通过（vitest 无测试时 exit 0）。

- [x] **Step 10: Commit**

```bash
git add apps/desktop package.json pnpm-lock.yaml
git commit -m "feat(desktop): Electron 工程骨架（electron-vite + React + 托盘图标）"
```

---

### Task 2: main 进程 assistant-proxy（TDD）

**Files:**
- Create: `apps/desktop/src/shared/turn-result.ts`
- Create: `apps/desktop/tests/assistant-proxy.test.ts`
- Create: `apps/desktop/src/main/assistant-proxy.ts`

**Interfaces:**
- Consumes: 无（纯 Node 模块，不 import electron；fetch 与 baseUrl 依赖注入）
- Produces:
  - `src/shared/turn-result.ts` 定义 `TurnResult` 判别联合（main/preload/renderer 三侧共用，Task 3/4 引用）：
    ```ts
    export type TurnResult =
      | { ok: true; action: string; message: string; artifactId?: string; panel?: string }
      | { ok: false; code: 'backend_offline' | 'timeout' | 'aborted' | 'http'; message: string };
    ```
  - `createAssistantProxy(options: { fetchImpl?: typeof fetch; baseUrl?: string; timeoutMs?: number }): AssistantProxy`
  - `AssistantProxy.turn(input: { text: string }, signal?: AbortSignal): Promise<TurnResult>`

- [x] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from 'vitest';
import { createAssistantProxy } from '../src/main/assistant-proxy';

/** 记录 fetch 调用（URL、headers、body、signal）并返回指定响应的 fake。 */
function fakeFetch(responder: (info: {
  url: string; headers: Headers; body: unknown; signal: AbortSignal | null;
}) => Response | Promise<Response>) {
  const calls: Array<{ url: string; origin: string | null; secFetchSite: string | null; body: unknown }> = [];
  const impl = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({
      url: String(url),
      origin: (init?.headers as Record<string, string> | undefined)?.['origin'] ?? null,
      secFetchSite: (init?.headers as Record<string, string> | undefined)?.['sec-fetch-site'] ?? null,
      body,
    });
    return responder({ url: String(url), headers: new Headers(init?.headers), body, signal: init?.signal ?? null });
  };
  return { impl: impl as typeof fetch, calls };
}

const okJson = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

describe('assistant-proxy', () => {
  it('请求不带 Origin 与 sec-fetch-site 头（通过后端同源检查的无 Origin 分支）', async () => {
    const { impl, calls } = fakeFetch(() => okJson({ action: 'unknown', message: 'hi' }));
    const proxy = createAssistantProxy({ fetchImpl: impl, baseUrl: 'http://localhost:3000' });
    await proxy.turn({ text: '有哪些笔记本' });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.origin).toBeNull();
    expect(calls[0]!.secFetchSite).toBeNull();
    expect(calls[0]!.url).toBe('http://localhost:3000/api/v1/assistant/turn');
  });

  it('每次调用生成新的 clientMessageId（幂等去重键）', async () => {
    const { impl, calls } = fakeFetch(() => okJson({ action: 'unknown', message: 'ok' }));
    const proxy = createAssistantProxy({ fetchImpl: impl, baseUrl: 'http://localhost:3000' });
    await proxy.turn({ text: 'a' });
    await proxy.turn({ text: 'b' });
    const [first, second] = calls.map((c) => (c.body as { clientMessageId: string }).clientMessageId);
    expect(first).toMatch(/^[0-9a-f-]{36}$/i);
    expect(first).not.toBe(second);
  });

  it('ECONNREFUSED 映射为 backend_offline（本地服务未启动）', async () => {
    const { impl } = fakeFetch(() => {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    });
    const proxy = createAssistantProxy({ fetchImpl: impl, baseUrl: 'http://localhost:3000' });
    const result = await proxy.turn({ text: 'hi' });
    expect(result).toMatchObject({ ok: false, code: 'backend_offline' });
  });

  it('HTTP 429/503 解析 error.message 文案', async () => {
    const { impl } = fakeFetch(() =>
      okJson({ error: { code: 'budget_exceeded', message: '今日额度已用完' } }, 429),
    );
    const proxy = createAssistantProxy({ fetchImpl: impl, baseUrl: 'http://localhost:3000' });
    const result = await proxy.turn({ text: 'hi' });
    expect(result).toMatchObject({ ok: false, code: 'http', message: '今日额度已用完' });
  });

  it('超过 timeoutMs 映射为 timeout', async () => {
    const { impl } = fakeFetch(() => new Promise(() => {})); // 永不 resolve
    const proxy = createAssistantProxy({ fetchImpl: impl, baseUrl: 'http://localhost:3000', timeoutMs: 50 });
    const result = await proxy.turn({ text: 'hi' });
    expect(result).toMatchObject({ ok: false, code: 'timeout' });
  });

  it('用户 signal 中止映射为 aborted，且信号透传给 fetch', async () => {
    let received: AbortSignal | null = null;
    const { impl } = fakeFetch(({ signal }) => {
      received = signal;
      return new Promise(() => {});
    });
    const proxy = createAssistantProxy({ fetchImpl: impl, baseUrl: 'http://localhost:3000' });
    const ac = new AbortController();
    const pending = proxy.turn({ text: 'hi' }, ac.signal);
    ac.abort();
    const result = await pending;
    expect(received?.aborted).toBe(true);
    expect(result).toMatchObject({ ok: false, code: 'aborted' });
  });

  it('成功响应透传 action/message/artifactId/panel', async () => {
    const { impl } = fakeFetch(() =>
      okJson({ action: 'open_artifact', message: '已打开', artifactId: 'art-1' }),
    );
    const proxy = createAssistantProxy({ fetchImpl: impl, baseUrl: 'http://localhost:3000' });
    const result = await proxy.turn({ text: '打开宇宙导图' });
    expect(result).toEqual({ ok: true, action: 'open_artifact', message: '已打开', artifactId: 'art-1' });
  });
});
```

- [x] **Step 2: 运行确认失败**

Run: `pnpm --filter @educanvas/desktop test`
Expected: FAIL —— `Cannot find module '../src/main/assistant-proxy'`

- [x] **Step 3: 实现 assistant-proxy.ts**

```ts
import { randomUUID } from 'node:crypto';
import type { TurnResult } from '../shared/turn-result';

export interface AssistantProxy {
  turn(input: { text: string }, signal?: AbortSignal): Promise<TurnResult>;
}

const DEFAULT_TIMEOUT_MS = 20_000;
const FALLBACK_MESSAGE = '抱歉，暂时无法处理。';

/**
 * 桌面壳 → 本地 web 的 turn 代理。
 *
 * 关键设计：Node fetch 默认不带 Origin / sec-fetch-site 头，恰好通过后端
 * isTrustedSameOriginWrite 的无 Origin 分支（sec-fetch-site !== 'cross-site'）；
 * 本地部署模式身份回退 local:owner，无需 cookie。
 * 与 electron 解耦（fetch/baseUrl 注入），单测不启动 Electron。
 */
export function createAssistantProxy(options: {
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  timeoutMs?: number;
}): AssistantProxy {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = (options.baseUrl ?? 'http://localhost:3000').replace(/\/$/, '');
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const parseBody = async (response: Response): Promise<unknown> => {
    try {
      return await response.json();
    } catch {
      return null;
    }
  };

  const httpError = (status: number, body: unknown): TurnResult & { ok: false } => {
    const message =
      (body as { error?: { message?: string } } | null)?.error?.message ?? FALLBACK_MESSAGE;
    return { ok: false, code: 'http', message };
  };

  return {
    async turn(input, signal) {
      const userSignal = signal ?? null;
      const controller = new AbortController();
      const onUserAbort = () => controller.abort();
      if (userSignal) {
        if (userSignal.aborted) return { ok: false, code: 'aborted', message: '已取消。' };
        userSignal.addEventListener('abort', onUserAbort, { once: true });
      }
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetchImpl(`${baseUrl}/api/v1/assistant/turn`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ clientMessageId: randomUUID(), text: input.text }),
          signal: controller.signal,
        });
        const body = await parseBody(response);
        if (!response.ok) return httpError(response.status, body);
        const data = body as {
          action?: string;
          message?: string;
          artifactId?: string;
          panel?: string;
        };
        return {
          ok: true,
          action: data.action ?? 'unknown',
          message: data.message ?? '完成',
          ...(data.artifactId ? { artifactId: data.artifactId } : {}),
          ...(data.panel ? { panel: data.panel } : {}),
        };
      } catch (error) {
        if (userSignal?.aborted) return { ok: false, code: 'aborted', message: '已取消。' };
        if (controller.signal.aborted) {
          // 超时与用户取消共用 AbortController；用户取消在上面分支已拦截
          return { ok: false, code: 'timeout', message: '请求超时，请重试。' };
        }
        const cause = (error as { cause?: { code?: string } }).cause;
        if (cause?.code === 'ECONNREFUSED') {
          return {
            ok: false,
            code: 'backend_offline',
            message: '本地服务未启动（先 pnpm dev:all）。',
          };
        }
        return { ok: false, code: 'http', message: '连接中断，请重试。' };
      } finally {
        clearTimeout(timeout);
        if (userSignal) userSignal.removeEventListener('abort', onUserAbort);
      }
    },
  };
}
```

- [x] **Step 4: 运行确认通过**

Run: `pnpm --filter @educanvas/desktop test`
Expected: 7 个测试 PASS

- [x] **Step 5: Commit**

```bash
git add apps/desktop/src/shared/turn-result.ts apps/desktop/tests/assistant-proxy.test.ts apps/desktop/src/main/assistant-proxy.ts
git commit -m "feat(desktop): assistant turn 代理（无 Origin 头过同源检查，错误映射与超时）"
```

---

### Task 3: preload 桥 + main 窗口/托盘/生命周期

**Files:**
- Create: `apps/desktop/src/preload/index.ts`、`apps/desktop/src/preload/index.d.ts`
- Create: `apps/desktop/src/main/window.ts`、`apps/desktop/src/main/tray.ts`
- Modify: `apps/desktop/src/main/index.ts`（替换占位）

**Interfaces:**
- Consumes: Task 2 的 `createAssistantProxy`、`TurnResult`（main 侧持有唯一 proxy 实例）
- Produces:
  - preload 暴露 `window.desktopAssistant.turn(text: string, signal?: AbortSignal): Promise<TurnResult>`
  - main IPC：`ipcMain.handle('assistant:turn', (event, payload: { text: string }) => proxy.turn(payload, event.signal))`
  - main → renderer 事件：`webContents.send('assistant:toast', message: string)`（首次隐藏托盘提示）
  - 生命周期：单实例锁；close=hide；Tray 单击 toggle、右键菜单（显示/退出）
  - baseUrl 读取：`EDUCANVAS_DESKTOP_API_BASE` 环境变量，默认 `http://127.0.0.1:3101`（执行期修正：仓库本地 Web 约定端口是 3101，见 tooling/local-orchestrator-config.mjs）

- [x] **Step 1: preload/index.ts**

> 执行修正：`index.d.ts` 分离声明未被单 project tsconfig 的 include glob 收录（tsc 编译单元外），
> `declare global` 合并进 `index.ts`（含此文件的编译单元即全 project 可见），不单独建 d.ts。

```ts
import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';
import type { TurnResult } from '../shared/turn-result';

// renderer 侧类型：window.desktopAssistant 由此声明（含此文件的编译单元即全 project 可见）
declare global {
  interface Window {
    desktopAssistant: {
      turn(text: string, signal?: AbortSignal): Promise<TurnResult>;
      onToast(callback: (message: string) => void): () => void;
    };
  }
}

/**
 * contextBridge 暴露给 renderer 的唯一 API。
 * onToast：main 的 webContents.send('assistant:toast') → 回调；返回退订函数。
 */
contextBridge.exposeInMainWorld('desktopAssistant', {
  turn(text: string, signal?: AbortSignal): Promise<TurnResult> {
    // invoke 的最后一个参数支持 AbortSignal：abort 时 main 侧 event.signal 同步中止
    return ipcRenderer.invoke('assistant:turn', { text }, signal);
  },
  onToast(callback: (message: string) => void): () => void {
    const listener = (_event: IpcRendererEvent, message: string): void => callback(message);
    ipcRenderer.on('assistant:toast', listener);
    return () => {
      ipcRenderer.removeListener('assistant:toast', listener);
    };
  },
});
```

- [x] **Step 2: main/window.ts**

```ts
import { BrowserWindow } from 'electron';
import { join } from 'node:path';
import { isQuitRequested } from './tray';

export function createAssistantWindow(onFirstHide: () => void): BrowserWindow {
  const win = new BrowserWindow({
    width: 380,
    height: 600,
    title: 'EduCanvas 助手',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
    },
  });

  let hideToastShown = false;
  win.on('close', (event) => {
    if (!win.isDestroyed()) {
      event.preventDefault();
      win.hide();
      if (!hideToastShown) {
        hideToastShown = true;
        onFirstHide();
      }
    }
  });

  win.on('ready-to-show', () => win.show());

  const rendererUrl = process.env['ELECTRON_RENDERER_URL'];
  if (rendererUrl) {
    void win.loadURL(rendererUrl);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }
  return win;
}
```

- [x] **Step 3: main/tray.ts**

electron-vite 把 main 构建为 CJS，顶层 `import { app } from 'electron'` 可用。

```ts
import { app, Menu, Tray, nativeImage } from 'electron';
import { join } from 'node:path';
import type { BrowserWindow } from 'electron';

/** 托盘「退出」置位后 app.quit()；window.ts 的 close 拦截据此放行，实现「仅托盘退出真退出」。 */
let quitRequested = false;
export const isQuitRequested = (): boolean => quitRequested;
export const requestQuit = (): void => {
  quitRequested = true;
  app.quit();
};

export function createTray(win: BrowserWindow): Tray {
  const icon = nativeImage.createFromPath(join(__dirname, '../../build/icon.png'));
  const tray = new Tray(icon.resize({ width: 16, height: 16 }));
  tray.setToolTip('EduCanvas 助手');
  tray.on('click', () => {
    if (win.isVisible()) win.hide();
    else win.show();
  });
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '显示助手', click: () => win.show() },
      { type: 'separator' },
      { label: '退出', click: requestQuit },
    ]),
  );
  return tray;
}
```

- [x] **Step 4: 重写 main/index.ts**

退出链路：托盘「退出」（requestQuit 置位 → app.quit）→ 触发 window close → `isQuitRequested()===true` 不拦截 → 窗口正常关闭 → `window-all-closed` 不拦 → 默认退出。窗口 × 按钮：close 被 window.ts 拦截为 hide，进程常驻托盘。

```ts
import { app, ipcMain } from 'electron';
import { createAssistantWindow } from './window';
import { createTray } from './tray';
import { createAssistantProxy } from './assistant-proxy';

// 仓库本地 Web 约定端口 3101（tooling/local-orchestrator-config.mjs 默认值）。
// 非标准端口部署可用 EDUCANVAS_DESKTOP_API_BASE 覆盖。
const BASE_URL = process.env['EDUCANVAS_DESKTOP_API_BASE'] ?? 'http://127.0.0.1:3101';

// 单实例锁：二次启动聚焦已有窗口而非再开一个
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  const proxy = createAssistantProxy({ baseUrl: BASE_URL });

  // invoke 透传 AbortSignal：renderer 取消时 event.signal 同步中止（Electron invoke 约定）
  ipcMain.handle('assistant:turn', (event, payload: { text: string }) =>
    proxy.turn(payload, event.signal),
  );

  let mainWindow: Electron.BrowserWindow | null = null;

  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    mainWindow = createAssistantWindow(() => {
      mainWindow?.webContents.send('assistant:toast', '已最小化到托盘，右键托盘图标可退出。');
    });
    createTray(mainWindow);
  });

  // 覆盖默认「全部窗口关闭即退出」：关闭=隐藏到托盘，仅托盘「退出」结束进程
  app.on('window-all-closed', () => {
    /* no-op */
  });
}
```

- [x] **Step 5: 验证 typecheck 与构建**

Run:
```bash
pnpm --filter @educanvas/desktop typecheck
pnpm --filter @educanvas/desktop build
```
Expected: 通过，`out/preload/index.js` 存在

- [x] **Step 6: 手动启动验证（本地 GUI）**

Run: `pnpm dev:desktop`（需本机已起本地 web 服务；窗口 380×600 出现、关闭后托盘图标存在、单击托盘恢复、右键「退出」进程结束）
Expected: 全部行为符合预期。此步骤失败（如托盘不可见）需修复后继续。

- [x] **Step 7: Commit**

```bash
git add apps/desktop/src
git commit -m "feat(desktop): 窗口/托盘/单实例与 turn IPC 桥接"
```

---

### Task 4: renderer 对话 UI（纯函数 TDD + 组件）

**Files:**
- Create: `apps/desktop/tests/turn-request.test.ts`、`apps/desktop/tests/turn-response.test.ts`
- Create: `apps/desktop/src/renderer/src/turn-request.ts`、`turn-response.ts`、`use-assistant-turn.ts`
- Modify: `apps/desktop/src/renderer/src/App.tsx`、`styles.css`（替换占位）

**Interfaces:**
- Consumes: Task 3 的 `window.desktopAssistant.turn(text, signal)`（类型来自 `preload/index.d.ts`）
- Produces:
  - `buildTurnRequest(text: string): { text: string; clientMessageId: string } | null`（空/超长 2048 字节返回 null）
  - `turnResultToBubble(result: TurnResult): { text: string; status: 'completed' | 'failed' }`
  - `useAssistantTurn(): { bubbles: Bubble[]; busy: boolean; send(text: string): void; cancel(): void }`
    - `Bubble = { id: string; role: 'user' | 'assistant'; text: string; status: 'pending' | 'completed' | 'failed' }`

- [x] **Step 1: 写 turn-request 失败测试**

```ts
import { describe, expect, it } from 'vitest';
import { buildTurnRequest } from '../src/renderer/src/turn-request';

describe('buildTurnRequest', () => {
  it('生成 clientMessageId 并 trim 文本', () => {
    const req = buildTurnRequest('  新建物理笔记本  ');
    expect(req).not.toBeNull();
    expect(req!.text).toBe('新建物理笔记本');
    expect(req!.clientMessageId).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it('空白指令返回 null', () => {
    expect(buildTurnRequest('   ')).toBeNull();
  });

  it('超过 2048 字节返回 null（与后端 MAX_TEXT_BYTES 一致）', () => {
    expect(buildTurnRequest('x'.repeat(2049))).toBeNull();
  });
});
```

- [x] **Step 2: 实现 turn-request.ts 并确认通过**

```ts
const MAX_TEXT_BYTES = 2_048;

/** 构造 turn 请求负载；空白或超过 2048 字节（与后端 MAX_TEXT_BYTES 一致）返回 null。 */
export function buildTurnRequest(text: string): { text: string; clientMessageId: string } | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (new TextEncoder().encode(trimmed).length > MAX_TEXT_BYTES) return null;
  return { text: trimmed, clientMessageId: crypto.randomUUID() };
}
```

（`TextEncoder` 在浏览器与 Node 22 均为全局，renderer 无需 Node polyfill。）

Run: `pnpm --filter @educanvas/desktop test` → 3 PASS

- [x] **Step 3: 写 turn-response 失败测试**

```ts
import { describe, expect, it } from 'vitest';
import { turnResultToBubble } from '../src/renderer/src/turn-response';
import type { TurnResult } from '../../src/shared/turn-result';

describe('turnResultToBubble', () => {
  it('成功 → completed + message', () => {
    const r: TurnResult = { ok: true, action: 'created', message: '已创建笔记本「物理」' };
    expect(turnResultToBubble(r)).toEqual({ text: '已创建笔记本「物理」', status: 'completed' });
  });

  it('backend_offline → 服务未启动指引', () => {
    const r: TurnResult = { ok: false, code: 'backend_offline', message: '本地服务未启动（先 pnpm dev:all）。' };
    expect(turnResultToBubble(r)).toEqual({
      text: '本地服务未启动（先 pnpm dev:all）。',
      status: 'failed',
    });
  });

  it('aborted → 不产生失败气泡（静默）', () => {
    const r: TurnResult = { ok: false, code: 'aborted', message: '已取消。' };
    expect(turnResultToBubble(r)).toBeNull();
  });
});
```

- [x] **Step 4: 实现 turn-response.ts 并确认通过**

```ts
import type { TurnResult } from '../../shared/turn-result';

export interface BubblePresentation {
  text: string;
  status: 'completed' | 'failed';
}

export function turnResultToBubble(result: TurnResult): BubblePresentation | null {
  if (result.ok) return { text: result.message, status: 'completed' };
  if (result.code === 'aborted') return null; // 用户取消不报错
  return { text: result.message, status: 'failed' };
}
```

Run: `pnpm --filter @educanvas/desktop test` → 6 PASS

- [x] **Step 5: 实现 use-assistant-turn.ts**

```ts
import { useCallback, useRef, useState } from 'react';

export interface Bubble {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  status: 'pending' | 'completed' | 'failed';
}

export function useAssistantTurn() {
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const busyRef = useRef(false);

  const append = useCallback((bubble: Bubble) => {
    setBubbles((prev) => [...prev, bubble]);
  }, []);

  const updateLastAssistant = useCallback((patch: Partial<Pick<Bubble, 'text' | 'status'>>) => {
    setBubbles((prev) => {
      const next = [...prev];
      for (let i = next.length - 1; i >= 0; i -= 1) {
        if (next[i]!.role === 'assistant') {
          next[i] = { ...next[i]!, ...patch };
          break;
        }
      }
      return next;
    });
  }, []);

  const send = useCallback(
    (raw: string) => {
      if (busyRef.current) return;
      const request = buildTurnRequest(raw);
      if (!request) return;
      busyRef.current = true;
      setBusy(true);

      append({ id: crypto.randomUUID(), role: 'user', text: request.text, status: 'completed' });
      append({ id: crypto.randomUUID(), role: 'assistant', text: '', status: 'pending' });

      const ac = new AbortController();
      controller.current = ac;

      window.desktopAssistant
        .turn(request.text, ac.signal)
        .then((result) => {
          const presentation = turnResultToBubble(result);
          if (presentation) updateLastAssistant(presentation);
        })
        .catch(() => {
          updateLastAssistant({ text: '连接中断，请重试。', status: 'failed' });
        })
        .finally(() => {
          busyRef.current = false;
          setBusy(false);
          if (controller.current === ac) controller.current = null;
        });
    },
    [append, updateLastAssistant],
  );

  const cancel = useCallback(() => {
    controller.current?.abort();
  }, []);

  return { bubbles, busy, send, cancel } as const;
}
```

- [x] **Step 6: 实现 App.tsx 与 styles.css（替换占位）**

`App.tsx`:
```tsx
import { useEffect, useRef, useState } from 'react';
import { useAssistantTurn } from './use-assistant-turn';

export default function App(): React.JSX.Element {
  const { bubbles, busy, send, cancel } = useAssistantTurn();
  const [input, setInput] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // 主进程事件：首次隐藏到托盘的提示（经 preload 桥转发）
  useEffect(() => {
    return window.desktopAssistant.onToast((message) => setToast(message));
  }, []);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [bubbles]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSend = (): void => {
    if (!input.trim() || busy) return;
    send(input);
    setInput('');
  };

  return (
    <main className="app">
      <header className="header">
        <span className="dot" />
        <span className="title">EduCanvas 助手</span>
        <span className="hint">笔记本管理</span>
      </header>

      {toast && (
        <div className="toast" onClick={() => setToast(null)} role="button" aria-label="关闭提示">
          {toast}
        </div>
      )}

      <div className="bubbles" ref={listRef}>
        {bubbles.length === 0 && <p className="empty">输入指令管理笔记本</p>}
        {bubbles.map((b) => (
          <div key={b.id} className={`bubble ${b.role} ${b.status}`}>
            {b.role === 'assistant' && <span className="dot small" />}
            <div className="text">
              {b.text || (b.status === 'pending' ? '...' : '')}
            </div>
          </div>
        ))}
      </div>

      <footer className="input-row">
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder="输入指令..."
          rows={1}
          disabled={busy}
        />
        {busy ? (
          <button className="send" onClick={cancel} aria-label="取消">
            ✕
          </button>
        ) : (
          <button
            className="send"
            onClick={handleSend}
            disabled={!input.trim()}
            aria-label="发送"
          >
            发送
          </button>
        )}
      </footer>
    </main>
  );
}
```

`styles.css`（追加到占位文件）:
```css
.app { height: 100%; display: flex; flex-direction: column; background: var(--surface); color: var(--ink); }
.header { display: flex; align-items: center; gap: 8px; padding: 12px 16px; border-bottom: 1px solid #efe9f4; font-size: 14px; font-weight: 500; color: var(--accent); }
.hint { margin-left: auto; font-size: 12px; font-weight: 400; color: #8b7f97; }
.dot { width: 10px; height: 10px; border-radius: 50%; background: var(--accent); }
.dot.small { width: 8px; height: 8px; flex-shrink: 0; margin-top: 5px; }
.toast { margin: 8px 12px 0; padding: 8px 12px; border-radius: 8px; background: #f3edf8; color: var(--accent); font-size: 12px; cursor: pointer; }
.bubbles { flex: 1; overflow-y: auto; padding: 8px 16px; }
.empty { text-align: center; color: #a89eb4; font-size: 12px; padding-top: 20px; }
.bubble { display: flex; gap: 8px; align-items: flex-start; padding: 8px 0; }
.bubble .text { flex: 1; font-size: 14px; line-height: 1.6; white-space: pre-wrap; word-break: break-word; }
.bubble.failed .text { color: #c0392b; }
.bubble.assistant .text { opacity: 1; }
.bubble.pending .text { opacity: 0.5; }
.input-row { display: flex; align-items: flex-end; gap: 8px; padding: 10px 12px; border-top: 1px solid #efe9f4; }
.input-row textarea { flex: 1; resize: none; border: none; outline: none; font: inherit; font-size: 14px; line-height: 1.5; max-height: 80px; background: transparent; color: var(--ink); }
.send { flex-shrink: 0; width: 48px; height: 32px; border: none; border-radius: 16px; background: var(--accent); color: #fff; font-size: 12px; cursor: pointer; }
.send:disabled { background: transparent; color: #c4bacf; cursor: default; }
```

- [x] **Step 7: 验证构建 + 全量测试**

Run:
```bash
pnpm --filter @educanvas/desktop typecheck
pnpm --filter @educanvas/desktop test
pnpm --filter @educanvas/desktop build
```
Expected: 全过；`out/renderer/index.html` 为完整 UI

- [x] **Step 8: Commit**

```bash
git add apps/desktop/src/renderer apps/desktop/tests
git commit -m "feat(desktop): 对话 UI（气泡/输入/取消/托盘提示）"
```

---

### Task 5: 根脚本与 CI 接线（ci-impact + ci.yml + 测试）

**Files:**
- Modify: `tooling/quality/ci-impact.mjs`（LANES 加 `desktop`、分类规则、`requiredResultFailures`）
- Modify: `tooling/ci-impact.test.mjs`（desktop 用例）
- Modify: `.github/workflows/ci.yml`（changes 输出 + 新 job + checks/release-evidence 接线）
- Modify: 根 `package.json`（`dev:desktop` 已在 Task 1 加过，此处核对）

**Interfaces:**
- Consumes: 现有 ci.yml 结构（changes/secret-scan/quality/integration/windows/runtime-pressure/e2e/release-evidence/checks + dependency-review）
- Produces:
  - `changes` job 输出 `desktop`（布尔）
  - 新 job `desktop-build`（needs: changes；`if: needs.changes.outputs.desktop == 'true'`；跑 `pnpm --filter @educanvas/desktop build` 与单测，产物验证 `out/main/index.js` 存在）
  - `checks`（汇总）与 `release-evidence` 的 needs/if/env 接线加 `desktop-build`
  - ci-impact 分类：`/^apps\/desktop\//` → desktop lane（同时 checks=true 保持默认）

- [x] **Step 1: 写 ci-impact 测试用例（先失败）**

在 `tooling/ci-impact.test.mjs` 追加（先看该文件现有结构再插同类用例，其已有 `classifyChangedPaths` 断言模式）：

```js
test('desktop changes map to desktop lane plus checks', () => {
  const result = classifyChangedPaths(['apps/desktop/src/main/index.ts']);
  assert.equal(result.desktop, true);
  assert.equal(result.checks, true);
  assert.equal(result.e2e, false);
});

test('docs-only changes still skip desktop lane', () => {
  const result = classifyChangedPaths(['docs/plan/active/Q-质量观测成本.md']);
  assert.equal(result.desktop, false);
});
```

- [x] **Step 2: 确认失败**

Run: `node --test tooling/ci-impact.test.mjs`
Expected: FAIL（`result.desktop` 为 undefined）

- [x] **Step 3: 改 ci-impact.mjs**

- `LANES` 数组加 `'desktop'`（放在 `checks` 后）：
```js
const LANES = [
  'checks',
  'desktop',
  'integration',
  'windows',
  'runtime_pressure',
  'e2e',
  'dependency_review',
];
```
- 默认分类加 desktop 规则（在 `const result = { ...NONE, checks: true };` 后）：
```js
result.desktop = matchesAny(paths, [/^apps\/desktop\//]);
```
- `requiredResultFailures` 的循环加 `desktop`：
```js
for (const lane of [
  'checks',
  'desktop',
  'integration',
  'windows',
  'runtime_pressure',
  'e2e',
]) {
  if (expected[lane]) requireSuccess(lane === 'checks' ? 'quality' : lane === 'desktop' ? 'desktop_build' : lane);
}
```
- `verifyResultsFromEnvironment` 的 expected/results 各加一项：
```js
expected: {
  checks: boolean('CHECKS_EXPECTED'),
  desktop: boolean('DESKTOP_EXPECTED'),
  ...
},
results: {
  ...
  desktop_build: process.env.DESKTOP_BUILD_RESULT,
  ...
}
```

- [x] **Step 4: 确认通过**

Run: `node --test tooling/ci-impact.test.mjs`
Expected: PASS（含新用例与既有用例）

- [x] **Step 5: 改 ci.yml**

a) `changes` job 的 outputs 加：
```yaml
      desktop: ${{ steps.impact.outputs.desktop }}
```

b) 新增 job（放在 `windows` 后）：
```yaml
  desktop-build:
    needs: [changes]
    if: needs.changes.outputs.desktop == 'true'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4 tag

      - uses: pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1 # v4 tag

      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4 tag
        with:
          node-version-file: .nvmrc
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Desktop unit tests
        run: pnpm --filter @educanvas/desktop test

      - name: Desktop build
        run: pnpm --filter @educanvas/desktop build

      - name: Verify main artifact
        run: test -f apps/desktop/out/main/index.js && test -f apps/desktop/out/renderer/index.html
```

c) `release-evidence` 的 needs 数组加 `desktop-build`，if 列表加：
```yaml
      contains(fromJSON('["success", "skipped"]'), needs['desktop-build'].result) &&
```

d) `checks` job：needs 数组加 `desktop-build`；env 加：
```yaml
      DESKTOP_EXPECTED: ${{ needs.changes.outputs.desktop }}
      DESKTOP_BUILD_RESULT: ${{ needs['desktop-build'].result }}
```

- [x] **Step 6: 本地验证**

Run:
```bash
node --test tooling/ci-impact.test.mjs
pnpm --filter @educanvas/desktop build
python -c "import yaml,sys; yaml.safe_load(open('.github/workflows/ci.yml')); print('ci.yml OK')" 2>/dev/null || echo "python yaml 不可用，跳过"
```
Expected: 测试全过；构建成功；ci.yml YAML 解析通过（如环境无 python，则用 `npx prettier --check .github/workflows/ci.yml` 代替）

- [x] **Step 7: Commit**

```bash
git add tooling/quality/ci-impact.mjs tooling/ci-impact.test.mjs .github/workflows/ci.yml
git commit -m "ci: desktop lane 与 desktop-build job 接线"
```

---

### Task 6: 本地验收 + PR + CI 观察至全绿

**Files:** 无新文件；流程任务

**Interfaces:**
- Consumes: Task 1-5 全部产物
- Produces: 合并就绪的 PR

- [ ] **Step 1: 核对验收标准（spec §8）**

Run:
```bash
# 1. dev 可启动（手动 GUI 验证窗口/托盘/对话，依赖本地 dev:all 在跑）
pnpm dev:desktop
# 2. 对话成功路径：输入「有哪些笔记本」→ 气泡返回列表
# 3. 服务未启动路径：停掉本地 web 再发指令 → 「本地服务未启动（先 pnpm dev:all）。」
# 4. 关闭进托盘 → 托盘单击恢复 → 右键退出进程结束
# 5. portable exe（Windows 本机）：pnpm --filter @educanvas/desktop package:portable
#    产物 dist/EduCanvas-助手-0.1.0.exe 双击即用（此步在 Windows 本机做，CI 不产 exe）
```
Expected: 5 项全过

- [ ] **Step 2: 核对 PR 前清单**

- `git log origin/main..HEAD` 只有本 PR 的 6 个 commit（骨架/proxy/窗口托盘/UI/CI 接线/文档）
- 分支 `feat/20260808-desktop-assistant` 基于最新 origin/main
- `pnpm lint:format`（prettier）对本 PR 改动文件通过
- 旧的 PWA 分支 `feat/20260808-pwa-install` 已删除（本地未 push，直接 `git branch -D`）

- [ ] **Step 3: 开 PR**

```bash
gh pr create \
  --title "feat(desktop): 桌面助手小窗（Electron 托盘常驻）" \
  --body "实现 docs/superpowers/specs/2026-08-08-desktop-assistant-design.md（brainstorming 已批准）。

- apps/desktop 为新 top-level 目录，**需 Code Owner 审批**（仓库规则）
- main 代理 assistant/turn（无 Origin 头过同源检查，本地身份免登录）
- 托盘常驻、portable 绿色 exe、零安装
- CI：desktop lane + desktop-build job；依赖仅 devDependencies
- 测试：assistant-proxy 7 例、turn-request/turn-response 6 例、ci-impact desktop 用例"
```

- [ ] **Step 4: 前台阻塞观察 CI 至全绿**

模式：`gh pr checks <n> --json name,state` 每 25-30s poll；FAILURE/ERROR/CANCELLED 立即查根因（`gh run view <id> --json jobs` / `--log-failed`）并修复后继续；全部终态且 SUCCESS 即完成。
预期 job：dependency-review（首次含 electron 依赖树，重点核对 license/漏洞）、secret-scan、quality、integration、windows、runtime-pressure、e2e、desktop-build、release-evidence、checks。
已知风险：electron 依赖树的 high 级漏洞可能让 dependency-review 红——按供应链文档流程处理（升级/替代/审批豁免）。

- [ ] **Step 5: 汇报工作日志**

按用户习惯整理当日工作日志条目（今天做了什么，供写工作日志）。

---

## Self-Review 结论（计划自审，随计划提交）

1. **Spec 覆盖**：§2 工程结构→Task 1/3/4；§3 数据流→Task 2/3；§4 窗口托盘→Task 3；§5 错误处理→Task 2/4（backend_offline/http/timeout/aborted 全映射）；§6 测试→Task 2/4/5；§7 CI 与治理→Task 1（目录审批说明）/5；§8 验收→Task 6。无缺口。
2. **占位符**：无 TBD/TODO；所有代码块完整可执行；无「先错后改」的中间态代码（tray.ts/main.ts 直接给最终版）。
3. **类型一致性**：`TurnResult` 定义在 `src/shared/turn-result.ts`（Task 2），main（assistant-proxy）、preload（index.ts/index.d.ts）、renderer（turn-response.ts）、测试统一从 shared 引用；`desktopAssistant.turn`/`onToast` 在 preload、d.ts、App.tsx 三处签名一致；`desktop` lane 在 Task 5 中 LANES/verify-results/ci.yml 三处命名一致。
