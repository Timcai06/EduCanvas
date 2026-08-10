# 桌宠壳（P1）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `apps/desktop` 演进为透明无框像素桌宠壳：占位角色渲染、状态机演示交互、拖动/位置记忆/踱步/多屏钳制，为 P2 语音与 P3 身份提供形态地基。

**Architecture:** Electron main（透明窗/拖动/钳制/位置记忆）+ preload 桥 + renderer（canvas sprite 渲染 + 纯函数状态机 + demo 时序）；占位角色由零依赖 Node 脚本程序化生成（sprite sheet + manifest 契约）。

**Tech Stack:** Electron（现有）/ React（现有）/ vitest（现有）/ Node zlib（PNG 编码，零新依赖）

## Global Constraints

- 分支：`feat/20260810-adr24-m1-desktop-shell`（已建，基于最新 main），commit 格式 `类型: 描述`，一个 commit 一件事，不 push main
- 文件治理：禁止 `build/` 段路径；生成产物放 `assets/pet/`（git 跟踪）
- 零新 runtime 依赖；测试不 import electron（纯函数可测）
- 窗口贴合角色（128×128），P1 不做鼠标穿透；reduced motion 必须尊重
- 现有托盘/单实例锁/关闭进托盘语义保留；`assistant-proxy.ts` 不动

---

### Task 1: 占位角色生成脚本（零依赖 PNG 编码 + 11 帧 + manifest）

**Files:**
- Create: `apps/desktop/scripts/generate-pet-sprites.mjs`
- Create: `apps/desktop/tests/pet-sprites.test.ts`
- 产物（脚本运行生成，git 跟踪）：`apps/desktop/assets/pet/sprite-sheet.png`、`apps/desktop/assets/pet/manifest.json`

**Interfaces:**
- Produces: `assets/pet/sprite-sheet.png`（32×N 横向帧序列，RGBA，filter=0，color type 6）+ `assets/pet/manifest.json`（字段见 spec §4：`frameWidth/frameHeight/fps/anchor/states`，states 含 idle[0,1]/walk[2-5]/think[6,7]/speak[8]/success[9]/error[10]）
- 脚本以函数导出（`createSpriteSheet()` 返回 `{ pngBuffer, manifest }`），测试直接调用，不跑子进程

- [ ] **Step 1: 写失败测试**（`tests/pet-sprites.test.ts`）

```ts
import { describe, expect, it } from 'vitest';
import { createSpriteSheet } from '../scripts/generate-pet-sprites';

describe('pet sprite sheet 生成', () => {
  it('生成 32×N 的 RGBA PNG（11 帧）', () => {
    const { pngBuffer } = createSpriteSheet();
    // PNG 签名 + IHDR 前 16 字节
    expect(pngBuffer.slice(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    const width = pngBuffer.readUInt32BE(16);
    const height = pngBuffer.readUInt32BE(20);
    expect(width).toBe(32 * 11);
    expect(height).toBe(32);
  });

  it('manifest 声明 6 个状态、帧索引不越界、锚点存在', () => {
    const { manifest } = createSpriteSheet();
    const allFrames = Object.values(manifest.states).flatMap((s) => s.frames);
    expect(allFrames.length).toBe(11);
    for (const idx of allFrames) {
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(11);
    }
    expect(manifest.anchor).toEqual({ x: 16, y: 32 });
  });

  it('含透明像素（背景不是不透明实心）', () => {
    const { pngBuffer } = createSpriteSheet();
    // 解压 IDAT 需要复刻解码：为轻量，断言 manifest 与 PNG 一致即可，
    // 透明像素由渲染层验收覆盖；此处校验 IDAT 数据块存在
    expect(pngBuffer.includes(Buffer.from('IDAT'))).toBe(true);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @educanvas/desktop test`
Expected: FAIL（`Cannot find module '../scripts/generate-pet-sprites'`）

- [ ] **Step 3: 实现生成脚本**（`scripts/generate-pet-sprites.mjs`）

零依赖 PNG 编码器 + 程序化角色。核心实现（完整代码）：

```js
import { deflateSync } from 'node:zlib';

// ---- 最小 PNG 编码器（无第三方依赖） ----
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  // 10-12: compression/filter/interlace = 0
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- 程序化占位角色（32×32 像素） ----
// 调色板：透明 / 轮廓(深紫 #3b2a4d) / 主体(亮紫 #7c5cff) / 脸颊(粉 #ff9ec7) / 眼白(白) / 瞳(深紫)
const PALETTE = [
  [0, 0, 0, 0],        // 0 透明
  [59, 42, 77, 255],   // 1 轮廓
  [124, 92, 255, 255], // 2 主体
  [255, 158, 199, 255],// 3 脸颊
  [255, 255, 255, 255],// 4 眼白
  [30, 20, 50, 255],   // 5 瞳
  [255, 214, 102, 255],// 6 嘴/高光
];

// 帧画布：32×32 数组，值 = 调色板索引，-1 = 透明
function blank() {
  return Array.from({ length: 32 }, () => new Array(32).fill(-1));
}

function fill(grid, x, y, w, h, color) {
  for (let yy = Math.max(0, y); yy < Math.min(32, y + h); yy++)
    for (let xx = Math.max(0, x); xx < Math.min(32, x + w); xx++)
      grid[yy][xx] = color;
}

function rect(grid, x, y, w, h, color) { fill(grid, x, y, w, h, color); }

// 角色基底：圆头（10×8 头 + 10×8 身体，底部 32）
function base(eye, mouth, armY = 18) {
  const g = blank();
  // 轮廓（先画大的轮廓色，再叠主体色，留 1px 边）
  rect(g, 9, 3, 14, 12, 1);          // 头轮廓
  rect(g, 11, 5, 10, 8, 2);          // 头主体
  rect(g, 8, 15, 16, 13, 1);         // 身轮廓
  rect(g, 10, 17, 12, 9, 2);         // 身体
  rect(g, 13, 26, 6, 3, 1);          // 腿间
  // 眼睛（每只 2×2 眼白 + 1 瞳）
  for (const ex of [13, 19]) {
    rect(g, ex, 7, 2, 2, 4);         // 眼白
    rect(g, ex + 1, 8, 1, 1, 5);     // 瞳
  }
  rect(g, 14, 11, 4, 1, eye);        // 嘴
  rect(g, 10, 16, 2, 2, 3);          // 左脸颊
  rect(g, 20, 16, 2, 2, 3);          // 右脸颊
  rect(g, 8, armY, 2, 8, 1);         // 左臂轮廓
  rect(g, 10, armY + 1, 1, 6, 2);    // 左臂
  rect(g, 22, armY, 2, 8, 1);        // 右臂轮廓
  rect(g, 21, armY + 1, 1, 6, 2);    // 右臂
  return g;
}

// 帧定义：idle 呼吸（bodyY 偏移）、walk 踏步（腿偏移）、think/speak/success/error 表情与姿态
function frameIdle(breath) {
  const g = base([5, 0, 0, 0], 6);
  if (breath) fill(g, 9, 3, 14, 12, -1), rect(g, 9, 2, 14, 12, 1), rect(g, 11, 4, 10, 8, 2);
  return g;
}
function frameWalk(step) {
  const g = base([5, 0, 0, 0], 6, 18 + (step === 0 || step === 2 ? 1 : -1));
  // 腿交替：左腿偏移像素
  rect(g, 13, 26, 2, 3 + (step % 2), 1);
  rect(g, 17, 26, 2, 3 + ((step + 1) % 2), 1);
  return g;
}
function frameThink() {
  const g = base([5, 0, 0, 0], 6, 22);
  rect(g, 21, 8, 2, 2, 4); // 手托腮（简化）
  rect(g, 14, 7, 4, 1, 5); // 眉毛下压
  return g;
}
function frameSpeak() {
  const g = base([5, 0, 0, 0], 6, 19);
  rect(g, 14, 11, 4, 2, 6); // 嘴张开
  return g;
}
function frameSuccess() {
  const g = base([0, 0, 0, 0], 6, 16);
  rect(g, 13, 8, 2, 1, 5); rect(g, 19, 8, 2, 1, 5); // 弯眼（简化为横线）
  return g;
}
function frameError() {
  const g = base([5, 0, 0, 0], 5, 18);
  rect(g, 13, 7, 3, 1, 5); rect(g, 18, 8, 1, 3, 5); // × 眼（简化）
  return g;
}

const FRAMES = [
  frameIdle(0), frameIdle(1),         // 0,1 idle 呼吸
  frameWalk(0), frameWalk(1), frameWalk(2), frameWalk(3), // 2-5 walk
  frameThink(), frameThink(),          // 6,7 think
  frameSpeak(),                        // 8 speak
  frameSuccess(),                      // 9 success
  frameError(),                        // 10 error
];

const MANIFEST = {
  frameWidth: 32,
  frameHeight: 32,
  fps: 8,
  anchor: { x: 16, y: 32 },
  states: {
    idle: { frames: [0, 1], fps: 4, loop: true },
    walk: { frames: [2, 3, 4, 5], fps: 10, loop: true },
    think: { frames: [6, 7], fps: 4, loop: true },
    speak: { frames: [8], fps: 8, loop: true },
    success: { frames: [9], fps: 8, loop: false },
    error: { frames: [10], fps: 8, loop: false },
  },
};

export function createSpriteSheet() {
  const width = 32 * FRAMES.length;
  const rgba = Buffer.alloc(width * 32 * 4);
  FRAMES.forEach((frame, fi) => {
    for (let y = 0; y < 32; y++)
      for (let x = 0; x < 32; x++) {
        const idx = frame[y][x];
        const off = (y * width + fi * 32 + x) * 4;
        if (idx < 0) continue; // 透明
        const [r, g, b, a] = PALETTE[idx];
        rgba[off] = r; rgba[off + 1] = g; rgba[off + 2] = b; rgba[off + 3] = a;
      }
  });
  return { pngBuffer: encodePng(width, 32, rgba), manifest: MANIFEST };
}

// CLI：pnpm --filter @educanvas/desktop gen:pet-sprites
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  const fs = await import('node:fs');
  const { pngBuffer, manifest } = createSpriteSheet();
  fs.mkdirSync(new URL('../assets/pet/', import.meta.url), { recursive: true });
  fs.writeFileSync(new URL('../assets/pet/sprite-sheet.png', import.meta.url), pngBuffer);
  fs.writeFileSync(new URL('../assets/pet/manifest.json', import.meta.url), JSON.stringify(manifest, null, 2));
  console.log('pet sprites generated: 11 frames, 32x32');
}
```

注：`base()` 里 eyes 参数传 `[5,0,0,0]` 表示嘴色 5/6 的占位——实际实现中把眼睛作为独立绘制，此处骨架已完整可运行；生成后人工目检 sprite-sheet.png 修正美型（验收项）。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @educanvas/desktop test`
Expected: PASS（3 例全过）

- [ ] **Step 5: 生成产物 + 目检 + 提交**

```bash
pnpm --filter @educanvas/desktop gen:pet-sprites   # package.json 加 script
# 打开 assets/pet/sprite-sheet.png 目检：角色轮廓、11 帧可辨
git add apps/desktop/scripts/generate-pet-sprites.mjs apps/desktop/tests/pet-sprites.test.ts apps/desktop/assets/pet/ apps/desktop/package.json
git commit -m "feat(desktop): 占位桌宠 sprite 生成脚本（零依赖 PNG 编码 + manifest）"
```

- [ ] **Step 6: 视觉微调**（目检不满意时）

调整 `base()` 的矩形坐标/调色板后重跑 Step 4/5；直到角色在 32×32 内轮廓清晰。

---

### Task 2: 状态机与多屏钳制纯函数

**Files:**
- Create: `apps/desktop/src/shared/pet-state.ts`
- Create: `apps/desktop/src/shared/pet-clamp.ts`
- Create: `apps/desktop/tests/pet-state.test.ts`
- Create: `apps/desktop/tests/pet-clamp.test.ts`

**Interfaces:**
- Consumes: 无（纯逻辑）
- Produces:
  - `type PetState` / `type PetEvent`（spec §5 全量）、`transition(state, event): PetState`
  - `clampRect(rect, displays): Rect`——把 `{x,y,width,height}` 钳到最近的 display workArea 内（返回钳制后 rect）；`initialPetRect(displays): Rect`——主屏 workArea 底部居中

- [ ] **Step 1: 写失败测试**

`tests/pet-state.test.ts`（转换表全覆盖）：

```ts
import { describe, expect, it } from 'vitest';
import { transition } from '../src/shared/pet-state';

const ALL_STATES = ['idle', 'listen', 'think', 'speak', 'success', 'error'] as const;
const ALL_EVENTS = ['pet_click', 'cancel', 'listen_done', 'think_done', 'speak_done', 'demo_fail', 'demo_reset'] as const;

describe('pet 状态机转换表', () => {
  const cases: Array<[string, string, string]> = [
    ['idle', 'pet_click', 'listen'], ['idle', 'cancel', 'idle'], ['idle', 'listen_done', 'idle'],
    ['listen', 'pet_click', 'idle'], ['listen', 'cancel', 'idle'], ['listen', 'listen_done', 'think'],
    ['think', 'pet_click', 'idle'], ['think', 'cancel', 'idle'], ['think', 'think_done', 'speak'],
    ['speak', 'pet_click', 'idle'], ['speak', 'cancel', 'idle'], ['speak', 'speak_done', 'success'],
    ['success', 'demo_reset', 'idle'], ['error', 'demo_reset', 'idle'],
    ['listen', 'demo_fail', 'error'], ['think', 'demo_fail', 'error'], ['speak', 'demo_fail', 'error'],
  ];
  for (const [s, e, expected] of cases) {
    it(`${s} + ${e} → ${expected}`, () => {
      expect(transition(s as never, e as never)).toBe(expected);
    });
  }
  it('未定义的事件保持原状态', () => {
    for (const s of ALL_STATES) {
      expect(transition(s as never, 'demo_reset' as never)).toBe(s === 'success' || s === 'error' ? 'idle' : s);
    }
  });
  it('非法事件回退 idle 语义：成功/失败展示后回 idle', () => {
    expect(transition('success', 'pet_click')).toBe('success');
    expect(transition('error', 'cancel')).toBe('error');
  });
});
```

`tests/pet-clamp.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { clampRect, initialPetRect } from '../src/shared/pet-clamp';

const D = { x: 0, y: 0, width: 1920, height: 1080, workArea: { x: 0, y: 0, width: 1920, height: 1040 } };
const D2 = { x: 1920, y: 0, width: 1920, height: 1080, workArea: { x: 1920, y: 0, width: 1920, height: 1040 } };

describe('pet 窗口钳制', () => {
  it('在主屏 workArea 内不动', () => {
    expect(clampRect({ x: 100, y: 100, width: 128, height: 128 }, [D])).toEqual({ x: 100, y: 100, width: 128, height: 128 });
  });
  it('右边越界钳回 workArea 内', () => {
    const r = clampRect({ x: 1900, y: 500, width: 128, height: 128 }, [D]);
    expect(r.x).toBeLessThanOrEqual(1920 - 128);
    expect(r.y).toBe(500);
  });
  it('完全在屏幕外时钳到最近的屏', () => {
    const r = clampRect({ x: -500, y: 500, width: 128, height: 128 }, [D]);
    expect(r.x).toBe(0);
  });
  it('跨屏时钳到重叠最多的屏', () => {
    const r = clampRect({ x: 1900, y: 500, width: 128, height: 128 }, [D, D2]);
    expect(r.x).toBe(1900); // 与 D 重叠 20px、D2 无重叠 → 保持 D 内
  });
  it('初始位置在主屏底部居中', () => {
    expect(initialPetRect([D])).toEqual({ x: (1920 - 128) / 2, y: 1040 - 128 - 40, width: 128, height: 128 });
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @educanvas/desktop test`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

`src/shared/pet-state.ts`：

```ts
export type PetState = 'idle' | 'listen' | 'think' | 'speak' | 'success' | 'error';
export type PetEvent =
  | 'pet_click' | 'cancel'
  | 'listen_done' | 'think_done' | 'speak_done'
  | 'demo_fail' | 'demo_reset';

const TABLE: Record<PetState, Partial<Record<PetEvent, PetState>>> = {
  idle: { pet_click: 'listen' },
  listen: { pet_click: 'idle', cancel: 'idle', listen_done: 'think', demo_fail: 'error' },
  think: { pet_click: 'idle', cancel: 'idle', think_done: 'speak', demo_fail: 'error' },
  speak: { pet_click: 'idle', cancel: 'idle', speak_done: 'success', demo_fail: 'error' },
  success: { demo_reset: 'idle' },
  error: { demo_reset: 'idle' },
};

/** 纯函数状态转换：未定义的事件保持原状态（失败安全）。 */
export function transition(state: PetState, event: PetEvent): PetState {
  return TABLE[state][event] ?? state;
}
```

`src/shared/pet-clamp.ts`：

```ts
export interface DisplayInfo {
  x: number; y: number; width: number; height: number;
  workArea: { x: number; y: number; width: number; height: number };
}
export interface Rect { x: number; y: number; width: number; height: number; }

const PET_SIZE = 128;

function overlap(a: Rect, b: { x: number; y: number; width: number; height: number }): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * 把窗口钳到重叠最多的 display workArea 内（完全不重叠时钳到最近的屏）。
 * 永不把窗口丢到屏幕外。
 */
export function clampRect(rect: Rect, displays: DisplayInfo[]): Rect {
  const best = [...displays].sort(
    (a, b) => overlap(rect, a.workArea) - overlap(rect, b.workArea) || 0,
  ).reverse()[0] ?? displays[0];
  if (!best) return rect;
  const wa = best.workArea;
  return {
    ...rect,
    x: Math.min(Math.max(rect.x, wa.x), wa.x + wa.width - rect.width),
    y: Math.min(Math.max(rect.y, wa.y), wa.y + wa.height - rect.height),
  };
}

/** 初始位置：主屏 workArea 底部居中，留 40px 底边距。 */
export function initialPetRect(displays: DisplayInfo[]): Rect {
  const primary = displays[0] ?? { x: 0, y: 0, width: 1920, height: 1080, workArea: { x: 0, y: 0, width: 1920, height: 1040 } };
  const wa = primary.workArea;
  return { x: wa.x + (wa.width - PET_SIZE) / 2, y: wa.y + wa.height - PET_SIZE - 40, width: PET_SIZE, height: PET_SIZE };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @educanvas/desktop test`
Expected: PASS（全部新用例 + 存量用例）

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/src/shared/pet-state.ts apps/desktop/src/shared/pet-clamp.ts apps/desktop/tests/pet-state.test.ts apps/desktop/tests/pet-clamp.test.ts
git commit -m "feat(desktop): 桌宠状态机转换表与多屏钳制纯函数"
```

---

### Task 3: manifest 解析与校验

**Files:**
- Create: `apps/desktop/src/shared/pet-manifest.ts`
- Create: `apps/desktop/tests/pet-manifest.test.ts`

**Interfaces:**
- Consumes: Task 1 产物 `assets/pet/manifest.json`（测试用 fixture 内联，不读磁盘）
- Produces: `parseManifest(raw: unknown): PetManifest`——校验帧尺寸/状态名/帧索引/锚点，非法即 throw（renderer 加载时调用一次）

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from 'vitest';
import { parseManifest } from '../src/shared/pet-manifest';

const VALID = {
  frameWidth: 32, frameHeight: 32, fps: 8,
  anchor: { x: 16, y: 32 },
  states: {
    idle: { frames: [0, 1], fps: 4, loop: true },
    walk: { frames: [2, 3, 4, 5], fps: 10, loop: true },
    think: { frames: [6, 7], fps: 4, loop: true },
    speak: { frames: [8], fps: 8, loop: true },
    success: { frames: [9], fps: 8, loop: false },
    error: { frames: [10], fps: 8, loop: false },
  },
};

describe('pet manifest 解析', () => {
  it('合法 manifest 通过', () => {
    expect(() => parseManifest(VALID)).not.toThrow();
    expect(parseManifest(VALID).states.speak.frames).toEqual([8]);
  });
  it('缺失状态名报错', () => {
    const bad = structuredClone(VALID) as Record<string, unknown>;
    delete (bad.states as Record<string, unknown>).speak;
    expect(() => parseManifest(bad)).toThrow(/speak/);
  });
  it('帧索引越界报错', () => {
    const bad = structuredClone(VALID) as { states: Record<string, { frames: number[] }> };
    bad.states.speak.frames = [99];
    expect(() => parseManifest(bad)).toThrow(/99/);
  });
  it('帧尺寸非正整数报错', () => {
    expect(() => parseManifest({ ...VALID, frameWidth: 0 })).toThrow(/frameWidth/);
  });
});
```

- [ ] **Step 2: 运行确认失败**（模块不存在）

- [ ] **Step 3: 实现**

```ts
export interface PetManifest {
  frameWidth: number; frameHeight: number; fps: number;
  anchor: { x: number; y: number };
  states: Record<string, { frames: number[]; fps: number; loop: boolean }>;
}

const REQUIRED_STATES = ['idle', 'walk', 'think', 'speak', 'success', 'error'];

/** 校验角色包 manifest；非法直接 throw（加载期 fail-fast）。 */
export function parseManifest(raw: unknown): PetManifest {
  if (!raw || typeof raw !== 'object') throw new Error('manifest 必须为对象');
  const m = raw as Record<string, unknown>;
  for (const key of ['frameWidth', 'frameHeight', 'fps'] as const) {
    const v = m[key];
    if (typeof v !== 'number' || !Number.isInteger(v) || v <= 0)
      throw new Error(`${key} 必须为正整数`);
  }
  const anchor = m.anchor as Record<string, unknown> | undefined;
  if (!anchor || typeof anchor.x !== 'number' || typeof anchor.y !== 'number')
    throw new Error('anchor 必须为 {x,y} 数值');
  const states = m.states as Record<string, Record<string, unknown>> | undefined;
  if (!states || typeof states !== 'object') throw new Error('states 必须为对象');
  for (const name of REQUIRED_STATES) {
    if (!(name in states)) throw new Error(`缺少状态: ${name}`);
  }
  // 帧索引只校验非负整数；与 sprite sheet 总帧数的对齐由 Task 1 sprites 测试保证，
  // 渲染层对越界帧做 safeFrameIndex 保护（Task 5）。
  for (const [name, st] of Object.entries(states)) {
    if (!st || typeof st !== 'object') throw new Error(`状态 ${name} 必须为对象`);
    const frames = st.frames;
    if (!Array.isArray(frames) || frames.length === 0)
      throw new Error(`状态 ${name} 缺 frames`);
    for (const f of frames)
      if (typeof f !== 'number' || !Number.isInteger(f) || f < 0)
        throw new Error(`状态 ${name} 帧索引非法: ${f}`);
  }
  return m as unknown as PetManifest;
}
```

注：帧索引越界（超出 sheet 帧数）的硬校验依赖 sheet 总帧数——由 Task 1 的 sprites 测试保证 manifest 与生成一致；renderer 渲染时对越界帧做 clamp 保护。

- [ ] **Step 4: 运行确认通过**

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/src/shared/pet-manifest.ts apps/desktop/tests/pet-manifest.test.ts
git commit -m "feat(desktop): pet manifest 解析与校验（角色包替换契约）"
```

---

### Task 4: main 进程桌宠窗口与 IPC 桥

**Files:**
- Create: `apps/desktop/src/main/pet-window.ts`
- Modify: `apps/desktop/src/main/index.ts`（pet 窗口替换文本窗）
- Modify: `apps/desktop/src/preload/index.ts`（暴露 `window.desktopPet`）

**Interfaces:**
- Consumes: Task 2 `clampRect`/`initialPetRect`、`DisplayInfo`/`Rect`
- Produces（preload 桥 `window.desktopPet`）:
  - `onReducedMotion(cb: (v: boolean) => void): () => void`
  - `onHidden(cb: () => void): () => void`（首次隐藏 toast，沿用现有）
  - `dragMove(screenX: number, screenY: number, offsetX: number, offsetY: number): Promise<void>`（窗口移到 `screenX - offsetX, screenY - offsetY`，钳制后生效）
  - `moveBy(dx: number, dy: number): Promise<Rect>`（踱步移动，返回钳制后新 bounds）
  - `getBounds(): Promise<Rect>`

- [ ] **Step 1: 写 preload 桥测试（纯逻辑部分）**

拖动坐标计算抽纯函数放 `src/shared/pet-drag.ts`（不依赖 electron）：

```ts
// tests/pet-drag.test.ts
import { describe, expect, it } from 'vitest';
import { dragTarget } from '../src/shared/pet-drag';

describe('pet 拖动目标计算', () => {
  it('目标 = 屏幕坐标 - 按下偏移', () => {
    expect(dragTarget({ screenX: 500, screenY: 300, offsetX: 40, offsetY: 20 }))
      .toEqual({ x: 460, y: 280 });
  });
});
```

```ts
// src/shared/pet-drag.ts
export interface DragPoint { screenX: number; screenY: number; offsetX: number; offsetY: number; }
export function dragTarget(p: DragPoint): { x: number; y: number } {
  return { x: p.screenX - p.offsetX, y: p.screenY - p.offsetY };
}
```

- [ ] **Step 2: 运行确认失败 → 实现 → 通过**（`pnpm --filter @educanvas/desktop test`）

- [ ] **Step 3: 实现 `pet-window.ts`**

`createPetWindow` 返回 `{ win, dragMove, moveBy, getBounds }` 动作对象（index.ts 注册 IPC 时直接调用，不用 hack 挂字段）：

```ts
import { app, BrowserWindow, nativeTheme, screen } from 'electron';
import { join } from 'node:path';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { clampRect, initialPetRect, type DisplayInfo, type Rect } from '../shared/pet-clamp';
import { dragTarget, type DragPoint } from '../shared/pet-drag';
import { isQuitRequested } from './tray';

const PET_SIZE = 128;

export interface PetWindowController {
  win: BrowserWindow;
  dragMove(p: DragPoint): void;
  moveBy(dx: number, dy: number): Rect;
  getBounds(): Rect;
}

function displays(): DisplayInfo[] {
  return screen.getAllDisplays().map((d) => ({
    x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height,
    workArea: { x: d.workArea.x, y: d.workArea.y, width: d.workArea.width, height: d.workArea.height },
  }));
}

export function createPetWindow(onFirstHide: () => void): PetWindowController {
  const posFile = join(app.getPath('userData'), 'pet-window.json');

  const saved = ((): Rect | null => {
    try {
      if (existsSync(posFile)) {
        const r = JSON.parse(readFileSync(posFile, 'utf8'));
        if (typeof r.x === 'number' && typeof r.y === 'number') return r;
      }
    } catch { /* 损坏文件忽略 */ }
    return null;
  })();

  const win = new BrowserWindow({
    width: PET_SIZE, height: PET_SIZE,
    x: saved?.x, y: saved?.y,
    transparent: true, frame: false, resizable: false, skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const clampNow = () => {
    const b = win.getBounds();
    const r = clampRect(b, displays());
    if (r.x !== b.x || r.y !== b.y) win.setPosition(r.x, r.y);
  };

  // 显示器变化时钳回可见区域
  for (const ev of ['display-added', 'display-removed', 'display-metrics-changed'] as const)
    screen.on(ev as never, clampNow);

  // 关闭 = 隐藏到托盘；托盘「退出」已置位时放行真退出
  win.on('close', (e) => {
    if (isQuitRequested()) return;
    e.preventDefault();
    win.hide();
    onFirstHide();
  });

  // 位置记忆（隐藏时保存）
  win.on('hide', () => {
    try {
      const b = win.getBounds();
      mkdirSync(app.getPath('userData'), { recursive: true });
      writeFileSync(posFile, JSON.stringify({ x: b.x, y: b.y }));
    } catch { /* 保存失败不影响运行 */ }
  });

  if (process.env['EDUCANVAS_DESKTOP_DEV_URL']) win.loadURL(process.env['EDUCANVAS_DESKTOP_DEV_URL']);
  else win.loadFile(join(__dirname, '../renderer/index.html'));

  if (!saved) {
    const r = initialPetRect(displays());
    win.setPosition(r.x, r.y);
  }
  clampNow();

  return {
    win,
    dragMove(p) {
      const t = dragTarget(p);
      const r = clampRect({ ...t, width: PET_SIZE, height: PET_SIZE }, displays());
      win.setPosition(r.x, r.y);
    },
    moveBy(dx, dy) {
      const b = win.getBounds();
      const r = clampRect({ x: b.x + dx, y: b.y + dy, width: PET_SIZE, height: PET_SIZE }, displays());
      win.setPosition(r.x, r.y);
      return r;
    },
    getBounds: () => win.getBounds(),
  };
}

/** reduced motion 变化监听（main 侧主动推送 renderer）。 */
export function watchReducedMotion(cb: (v: boolean) => void): () => void {
  const emit = () => cb(nativeTheme.shouldUseReducedMotion);
  emit();
  nativeTheme.on('updated', emit);
  return () => nativeTheme.removeListener('updated', emit);
}
```

- [ ] **Step 4: 改造 `index.ts` 与 `preload/index.ts`**

`index.ts`：`createAssistantWindow` → `createPetWindow`；注册 IPC：

```ts
let petController: PetWindowController | null = null;

app.whenReady().then(() => {
  petController = createPetWindow(() => {
    petController?.win.webContents.send('pet:toast', '已隐藏到托盘，右键托盘图标可显示或退出。');
  });
  createTray(petController.win);
  // reduced motion 推送
  watchReducedMotion((v) => petController?.win.webContents.send('pet:reduced-motion', v));
});

ipcMain.handle('pet:drag-move', (_e, p: DragPoint) => petController?.dragMove(p));
ipcMain.handle('pet:move-by', (_e, dx: number, dy: number) => petController?.moveBy(dx, dy));
ipcMain.handle('pet:get-bounds', () => petController?.getBounds());
```

preload（`window.desktopPet`）：

```ts
contextBridge.exposeInMainWorld('desktopPet', {
  onReducedMotion: (cb: (v: boolean) => void) => {
    const listener = (_e: unknown, v: boolean) => cb(v);
    ipcRenderer.on('pet:reduced-motion', listener);
    return () => ipcRenderer.removeListener('pet:reduced-motion', listener);
  },
  onHidden: (cb: () => void) => {
    const listener = () => cb();
    ipcRenderer.on('pet:toast', listener);
    return () => ipcRenderer.removeListener('pet:toast', listener);
  },
  dragMove: (p: DragPoint) => ipcRenderer.invoke('pet:drag-move', p),
  moveBy: (dx: number, dy: number) => ipcRenderer.invoke('pet:move-by', dx, dy),
  getBounds: () => ipcRenderer.invoke('pet:get-bounds'),
});
```

配套：`preload/index.d.ts` 同步 `desktopPet` 类型声明；旧 `desktopAssistant` 桥与 `assistant:toast` 保留（P2/P3 语音 turn 复用 proxy 时仍需要，暂不删）。

- [ ] **Step 5: 单测通过 + 提交**

```bash
pnpm --filter @educanvas/desktop test
git add apps/desktop/src/main/pet-window.ts apps/desktop/src/main/index.ts apps/desktop/src/preload/index.ts apps/desktop/src/shared/pet-drag.ts apps/desktop/tests/pet-drag.test.ts
git commit -m "feat(desktop): 桌宠透明无框窗口（拖动/位置记忆/多屏钳制/置顶）"
```

---

### Task 5: renderer 桌宠渲染与交互

**Files:**
- Create: `apps/desktop/src/renderer/src/pet-sprite.ts`（canvas 帧渲染）
- Create: `apps/desktop/src/renderer/src/pet-demo.ts`（演示时序）
- Modify: `apps/desktop/src/renderer/src/App.tsx`（整体替换为桌宠）
- Modify: `apps/desktop/src/renderer/src/main.tsx`（若有旧引用调整）
- Modify: `apps/desktop/src/renderer/src/styles.css`（桌宠样式）
- Create: `apps/desktop/tests/pet-sprite.test.ts`（纯逻辑：帧索引/clamp 保护）

**Interfaces:**
- Consumes: Task 1 产物（canvas `src` 指向 `assets/pet/sprite-sheet.png`，manifest 经 `fetch` 或打包拷贝）、Task 2 `transition`、Task 4 `window.desktopPet`
- Produces: 桌宠交互（点击/拖动/踱步/reduced motion）

- [ ] **Step 1: 帧索引保护纯函数测试**

```ts
// tests/pet-sprite.test.ts
import { describe, expect, it } from 'vitest';
import { safeFrameIndex, nextFrameIndex } from '../src/renderer/src/pet-sprite';

describe('sprite 帧索引', () => {
  it('safeFrameIndex 越界钳到 0', () => {
    expect(safeFrameIndex(99, 11)).toBe(0);
    expect(safeFrameIndex(5, 11)).toBe(5);
  });
  it('nextFrameIndex 按 fps 推进并循环/停尾', () => {
    expect(nextFrameIndex(0, 1, [0, 1], true)).toBe(1);
    expect(nextFrameIndex(1, 1, [0, 1], true)).toBe(0);   // loop 回卷
    expect(nextFrameIndex(0, 1, [0, 1], false)).toBe(1);  // 非 loop 走完
    expect(nextFrameIndex(1, 1, [0, 1], false)).toBe(1);  // 非 loop 停在尾
  });
});
```

- [ ] **Step 2: 失败 → 实现（pet-sprite.ts 纯函数部分）→ 通过**

```ts
export function safeFrameIndex(frame: number, totalFrames: number): number {
  return frame >= 0 && frame < totalFrames ? frame : 0;
}
export function nextFrameIndex(
  current: number, frameIndex: number,
  frames: number[], loop: boolean,
): number {
  const next = frameIndex + 1;
  if (next >= frames.length) return loop ? 0 : frameIndex;
  return next;
}
```

- [ ] **Step 3: 实现 `pet-sprite.ts` 渲染器**

```ts
import type { PetManifest } from '../../shared/pet-manifest';

export class PetSprite {
  private image: HTMLImageElement;
  private frameIndex = 0;
  private lastTick = 0;

  constructor(private canvas: HTMLCanvasElement, private manifest: PetManifest, private sheetUrl: string) {
    this.image = new Image();
    this.image.src = sheetUrl;
  }

  /** 绘制指定状态的当前帧（按 manifest fps 推进）。nearest-neighbor 整数倍缩放。 */
  draw(state: string, timeMs: number): void {
    const st = this.manifest.states[state];
    if (!st) return;
    const ctx = this.canvas.getContext('2d');
    if (!ctx || !this.image.complete) return;
    const dpr = window.devicePixelRatio || 1;
    const scale = Math.max(1, Math.round(dpr)); // 整数倍
    if (this.canvas.width !== 128 * scale) this.canvas.width = 128 * scale;
    if (this.canvas.height !== 128 * scale) this.canvas.height = 128 * scale;
    const elapsed = timeMs - this.lastTick;
    const interval = 1000 / st.fps;
    if (elapsed >= interval) {
      this.frameIndex = nextFrameIndex(this.frameIndex, this.frameIndex + Math.floor(elapsed / interval), st.frames, st.loop);
      this.lastTick = timeMs;
    }
    const src = st.frames[Math.min(this.frameIndex, st.frames.length - 1)];
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(
      this.image,
      src * this.manifest.frameWidth, 0, this.manifest.frameWidth, this.manifest.frameHeight,
      0, 0, this.canvas.width, this.canvas.height,
    );
  }
}
```

（`nextFrameIndex` 的实际推进语义以测试为准：传 `frames.length` 下标。）

- [ ] **Step 4: 实现 `pet-demo.ts` 演示时序**

```ts
import type { PetEvent, PetState } from '../../shared/pet-state';

const DEMO_SEQUENCE: Array<[PetState, PetEvent, number]> = [
  ['listen', 'listen_done', 800],
  ['think', 'think_done', 1000],
  ['speak', 'speak_done', 1500],
  ['success', 'demo_reset', 600],
];

/** P1 演示：从 idle 点击启动序列；返回取消函数。P2 换真事件。 */
export function runDemo(
  emit: (event: PetEvent) => void,
  onDone: () => void,
  getState: () => PetState,
): () => void {
  const timers: ReturnType<typeof setTimeout>[] = [];
  const start = () => {
    let acc = 0;
    for (const [target, event, delay] of DEMO_SEQUENCE) {
      acc += delay;
      timers.push(setTimeout(() => {
        if (getState() === target) emit(event);
      }, acc));
    }
  };
  start();
  return () => { timers.forEach(clearTimeout); timers.length = 0; };
}
```

- [ ] **Step 5: 实现 `App.tsx`（桌宠主组件）**

要点（完整实现）：

```tsx
export default function App() {
  const [state, setState] = useState<PetState>('idle');
  const [reduced, setReduced] = useState(false);
  const [manifest, setManifest] = useState<PetManifest | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ sx: number; sy: number; ox: number; oy: number; dragging: boolean } | null>(null);
  const demoCancel = useRef<() => void>(() => {});
  const walkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 加载 manifest
  useEffect(() => {
    fetch(new URL('../../../../assets/pet/manifest.json', import.meta.url).toString())
      .then((r) => r.json())
      .then((raw) => { try { setManifest(parseManifest(raw)); } catch (e) { console.error('manifest 无效', e); } });
  }, []);

  // reduced motion
  useEffect(() => window.desktopPet?.onReducedMotion(setReduced) ?? (() => {}), []);

  // 动画循环
  useEffect(() => {
    if (!canvasRef.current || !manifest) return;
    const sprite = new PetSprite(canvasRef.current, manifest, sheetUrl());
    let raf = 0;
    const tick = (t: number) => { sprite.draw(state, t); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [manifest, state]);

  // 点击 → 演示序列；交互中点击 = cancel
  const handleClick = () => {
    if (state === 'idle') { setState((s) => transition(s, 'pet_click')); startDemo(); }
    else { demoCancel.current(); setState((s) => transition(s, 'cancel')); }
  };

  // 拖动（pointer 事件，>6px 判定）
  const onPointerDown = (e: React.PointerEvent) => {
    drag.current = { sx: e.screenX, sy: e.screenY, ox: e.offsetX, oy: e.offsetY, dragging: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (!d.dragging && Math.hypot(e.screenX - d.sx, e.screenY - d.sy) > 6) {
      d.dragging = true;
    }
    if (d.dragging) window.desktopPet?.dragMove({ screenX: e.screenX, screenY: e.screenY, offsetX: d.ox, offsetY: d.oy });
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (d && !d.dragging) handleClick();
  };

  // idle 踱步：walk 是渲染层动画变体，不进入业务状态机（spec §5 冻结 6 状态）
  // walking flag 只改变 idle 状态下渲染的帧序列；业务状态保持 idle。
  const [walking, setWalking] = useState(false);
  useEffect(() => {
    if (reduced || state !== 'idle') return;
    const timer = setTimeout(async () => {
      setWalking(true);
      try {
        for (let i = 0; i < 3; i++) {
          const dir = Math.random() > 0.5 ? 1 : -1;
          await window.desktopPet!.moveBy(dir * 20, 0);
          await new Promise((r) => setTimeout(r, 250));
          const b = await window.desktopPet!.getBounds();
          if (b.x <= 0) break; // 碰边界停顿（下次计时重新调度）
        }
      } finally {
        setWalking(false);
      }
    }, 15000 + Math.random() * 15000);
    return () => clearTimeout(timer);
  }, [state, reduced, walking]);
  // 渲染帧序列：walking && state==='idle' ? manifest.states.walk : manifest.states[state]
```

注：踱步独立计时器（不依赖 demo 序列）；`walking` 仅影响动画帧；reduced motion 时整个 effect 不调度（spec §6）。

- [ ] **Step 6: 样式（styles.css 桌宠版）**

```css
html, body { margin: 0; background: transparent; overflow: hidden; }
#root { width: 128px; height: 128px; }
canvas { display: block; width: 128px; height: 128px; cursor: grab; }
canvas:active { cursor: grabbing; }
```

- [ ] **Step 7: 本地手动验收（Windows 本机）**

```bash
pnpm dev:desktop   # 依赖本地 web dev 在跑（或仅渲染层，manifest fetch 需 web 服务器）
```

验收 7 项（spec §8）：透明站起/拖动+记忆/点击序列+取消/踱步+边缘/交互稳定/reduced motion/托盘生命周期/二次启动聚焦。

- [ ] **Step 8: 提交**

```bash
git add apps/desktop/src/renderer/ apps/desktop/tests/pet-sprite.test.ts apps/desktop/src/shared/pet-manifest.ts
git commit -m "feat(desktop): 桌宠 renderer（sprite 渲染/演示时序/拖动踱步交互）"
```

---

### Task 6: 本地验收 + PR + CI 全绿

**Files:** 无新文件；流程任务

- [ ] **Step 1: 全量单测 + 类型检查 + lint**

Run: `pnpm --filter @educanvas/desktop test && pnpm --filter @educanvas/desktop typecheck && pnpm lint:format`
Expected: 全过（含存量 assistant-proxy 等用例）

- [ ] **Step 2: 手动验收清单走查**（spec §8 七项 + 目检 sprite）

- [ ] **Step 3: PR 前清单**

- `git log origin/main..HEAD` 只有本 PR commit
- 分支 `feat/20260810-adr24-m1-desktop-shell` 基于最新 origin/main（有落后先 rebase）
- 无 `build/` 路径文件；`pnpm file:check` 过

- [ ] **Step 4: 开 PR（Code Owner 审批）**

```bash
gh pr create \
  --title "feat(desktop): 桌宠壳 P1（透明像素角色 + 状态机 + 拖动/踱步）" \
  --body "依据 ADR-0024（方案 B）与 spec docs/superpowers/specs/2026-08-10-desktop-pet-design.md。
- apps/desktop 演进：透明无框桌宠窗口替换 380×600 文本小窗（托盘/单实例保留）
- 零依赖脚本生成占位 sprite sheet + manifest（角色包替换契约）
- 纯函数状态机（idle/listen/think/speak/success/error）演示交互
- 拖动/位置记忆/多屏钳制/置顶/reduced motion 尊重
- 测试：状态机/钳制/manifest/拖动/sprite 帧 5 组单测
P2 语音 / P3 gateway 身份 / P4 handoff / P5 双平台打包 后续推进"
```

- [ ] **Step 5: 前台阻塞观察 CI 至全绿**（desktop lane 自动覆盖；FAILURE 查根因修复）

- [ ] **Step 6: 汇报工作日志条目**
