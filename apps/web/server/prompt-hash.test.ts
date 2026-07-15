import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { hashPromptMaterial } from './prompt-hash';

describe('prompt hash', () => {
  it('对象键顺序不改变 digest，内容变化会改变 digest', () => {
    const first = hashPromptMaterial({ b: ['x'], a: { z: 1, y: true } });
    const reordered = hashPromptMaterial({ a: { y: true, z: 1 }, b: ['x'] });
    const changed = hashPromptMaterial({ a: { y: true, z: 2 }, b: ['x'] });

    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(reordered).toBe(first);
    expect(changed).not.toBe(first);
  });

  it('拒绝非 JSON 数值与循环结构', () => {
    expect(() => hashPromptMaterial({ value: Number.NaN })).toThrow(
      'prompt_hash_non_finite',
    );
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    expect(() => hashPromptMaterial(cyclic)).toThrow('prompt_hash_cycle');
  });
});
