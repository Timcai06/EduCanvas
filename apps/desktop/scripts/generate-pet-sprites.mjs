// 桌宠占位 sprite 生成器：零依赖（Node zlib 手写 PNG 编码），程序化绘制 11 帧像素角色。
// 产物：assets/pet/sprite-sheet.png + manifest.json（角色包替换契约，见 spec §4）。
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
const PALETTE = [
  [0, 0, 0, 0],         // 0 透明
  [59, 42, 77, 255],    // 1 轮廓（深紫）
  [124, 92, 255, 255],  // 2 主体（亮紫）
  [255, 158, 199, 255], // 3 脸颊（粉）
  [255, 255, 255, 255], // 4 眼白
  [30, 20, 50, 255],    // 5 瞳
  [255, 214, 102, 255], // 6 嘴/高光（黄）
];

const SIZE = 32;

function blank() {
  return Array.from({ length: SIZE }, () => new Array(SIZE).fill(-1));
}

function rect(grid, x, y, w, h, color) {
  for (let yy = Math.max(0, y); yy < Math.min(SIZE, y + h); yy++)
    for (let xx = Math.max(0, x); xx < Math.min(SIZE, x + w); xx++)
      grid[yy][xx] = color;
}

/** 角色基底：圆头 + 身体 + 眼睛 + 脸颊 + 手臂。eye=瞳色，mouth=嘴色，armY=手臂起点。 */
function base(eye, mouth, armY = 18) {
  const g = blank();
  rect(g, 9, 3, 14, 12, 1);   // 头轮廓
  rect(g, 11, 5, 10, 8, 2);   // 头主体
  rect(g, 8, 15, 16, 13, 1);  // 身轮廓
  rect(g, 10, 17, 12, 9, 2);  // 身体
  rect(g, 13, 26, 6, 3, 1);   // 腿
  for (const ex of [13, 19]) {
    rect(g, ex, 7, 2, 2, 4);  // 眼白
    rect(g, ex + 1, 8, 1, 1, eye); // 瞳
  }
  rect(g, 14, 11, 4, 1, mouth); // 嘴
  rect(g, 10, 16, 2, 2, 3);   // 左脸颊
  rect(g, 20, 16, 2, 2, 3);   // 右脸颊
  rect(g, 8, armY, 2, 8, 1);  // 左臂轮廓
  rect(g, 10, armY + 1, 1, 6, 2); // 左臂
  rect(g, 22, armY, 2, 8, 1); // 右臂轮廓
  rect(g, 21, armY + 1, 1, 6, 2); // 右臂
  return g;
}

// 帧定义：idle 呼吸（头上移 1px）/ walk 踏步（臂摆动 + 腿交替）/ 表情状态
function frameIdle(breath) {
  const g = base(5, 6, 18);
  if (breath) {
    // 整体上移 1px：清头轮廓行再重画
    rect(g, 9, 3, 14, 1, -1);
    rect(g, 9, 2, 14, 1, 1);
    rect(g, 11, 3, 10, 1, 2);
  }
  return g;
}

function frameWalk(step) {
  const g = base(5, 6, step % 2 === 0 ? 17 : 19);
  // 腿交替：左右腿长度差 1px
  const l = step % 2;
  rect(g, 13, 26, 2, 3 + l, 1);
  rect(g, 17, 26, 2, 4 - l, 1);
  return g;
}

function frameThink() {
  const g = base(5, 6, 21);
  rect(g, 21, 8, 2, 2, 4);   // 右手托腮（简化）
  rect(g, 14, 6, 4, 1, 5);   // 眉毛下压
  return g;
}

function frameSpeak() {
  const g = base(5, 6, 19);
  rect(g, 14, 11, 4, 2, 6);  // 嘴张开
  return g;
}

function frameSuccess() {
  const g = base(5, 6, 16);
  rect(g, 13, 8, 2, 1, 5);   // 弯眼（简化为横线）
  rect(g, 19, 8, 2, 1, 5);
  rect(g, 8, 13, 2, 4, 1);   // 举手
  rect(g, 10, 13, 1, 3, 2);
  return g;
}

function frameError() {
  const g = base(5, 5, 18);
  rect(g, 13, 7, 3, 1, 5);   // × 眼（简化）
  rect(g, 15, 7, 1, 3, 5);
  rect(g, 19, 7, 3, 1, 5);
  rect(g, 19, 8, 1, 3, 5);
  return g;
}

const FRAMES = [
  frameIdle(0), frameIdle(1),                         // 0,1 idle 呼吸
  frameWalk(0), frameWalk(1), frameWalk(2), frameWalk(3), // 2-5 walk
  frameThink(), frameThink(),                         // 6,7 think
  frameSpeak(),                                       // 8 speak
  frameSuccess(),                                     // 9 success
  frameError(),                                       // 10 error
];

const MANIFEST = {
  frameWidth: SIZE,
  frameHeight: SIZE,
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

/** 生成 sprite sheet PNG + manifest。测试直接调用（不跑子进程）。 */
export function createSpriteSheet() {
  const width = SIZE * FRAMES.length;
  const rgba = Buffer.alloc(width * SIZE * 4);
  FRAMES.forEach((frame, fi) => {
    for (let y = 0; y < SIZE; y++)
      for (let x = 0; x < SIZE; x++) {
        const idx = frame[y][x];
        const off = (y * width + fi * SIZE + x) * 4;
        if (idx < 0) continue; // 透明
        const [r, g, b, a] = PALETTE[idx];
        rgba[off] = r;
        rgba[off + 1] = g;
        rgba[off + 2] = b;
        rgba[off + 3] = a;
      }
  });
  return { pngBuffer: encodePng(width, SIZE, rgba), manifest: MANIFEST };
}

// CLI：pnpm --filter @educanvas/desktop gen:pet-sprites
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  const fs = await import('node:fs');
  const { pngBuffer, manifest } = createSpriteSheet();
  const dir = new URL('../assets/pet/', import.meta.url);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(new URL('sprite-sheet.png', dir), pngBuffer);
  fs.writeFileSync(new URL('manifest.json', dir), JSON.stringify(manifest, null, 2));
  console.log(`pet sprites generated: ${FRAMES.length} frames, ${SIZE}x${SIZE} -> assets/pet/`);
}
