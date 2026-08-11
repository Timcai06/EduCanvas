/**
 * 桌宠角色包 manifest 解析与校验（spec §4 契约）。
 * renderer 加载角色包时调用一次，非法直接 throw（fail-fast）。
 * 帧索引与 sprite sheet 总帧数的对齐由 sprites 生成测试保证，
 * 渲染层对越界帧做 safeFrameIndex 保护。
 */

export interface PetManifest {
  frameWidth: number;
  frameHeight: number;
  fps: number;
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

  const states = m.states as Record<string, unknown> | undefined;
  if (!states || typeof states !== 'object')
    throw new Error('states 必须为对象');

  for (const name of REQUIRED_STATES) {
    if (!(name in states)) throw new Error(`缺少状态: ${name}`);
  }

  for (const [name, st] of Object.entries(states)) {
    if (!st || typeof st !== 'object')
      throw new Error(`状态 ${name} 必须为对象`);
    const s = st as Record<string, unknown>;
    const frames = s.frames;
    if (!Array.isArray(frames) || frames.length === 0)
      throw new Error(`状态 ${name} 缺 frames`);
    for (const f of frames) {
      if (typeof f !== 'number' || !Number.isInteger(f) || f < 0)
        throw new Error(`状态 ${name} 帧索引非法: ${String(f)}`);
    }
    if (typeof s.fps !== 'number' || s.fps <= 0)
      throw new Error(`状态 ${name} fps 必须为正数`);
    if (typeof s.loop !== 'boolean')
      throw new Error(`状态 ${name} loop 必须为布尔`);
  }

  return m as unknown as PetManifest;
}
