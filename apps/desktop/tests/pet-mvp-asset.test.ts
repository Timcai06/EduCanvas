import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('桌宠 MVP 待机素材', () => {
  it('直接使用用户提供的 APNG 动画', async () => {
    const bytes = await readFile(join(__dirname, '../assets/pet/idle.png'));
    expect(bytes.subarray(1, 4).toString('ascii')).toBe('PNG');
    expect(bytes.includes(Buffer.from('acTL'))).toBe(true);
    expect(bytes.includes(Buffer.from('fcTL'))).toBe(true);
  });

  it('直接使用用户提供的思考 APNG 动画', async () => {
    const path = join(__dirname, '../assets/pet/thinking.png');
    expect(existsSync(path)).toBe(true);
    const bytes = await readFile(path);
    expect(bytes.subarray(1, 4).toString('ascii')).toBe('PNG');
    expect(bytes.includes(Buffer.from('acTL'))).toBe(true);
    expect(bytes.includes(Buffer.from('fcTL'))).toBe(true);
  });

  it.each([
    'celebrating.png',
    'login-failed.png',
    'backend-offline.png',
    'confused.png',
    'listening.png',
    'speaking.png',
    'greeting.png',
  ])('直接使用用户提供的状态 APNG 动画：%s', async (name) => {
    const path = join(__dirname, '../assets/pet', name);
    expect(existsSync(path)).toBe(true);
    const bytes = await readFile(path);
    expect(bytes.subarray(1, 4).toString('ascii')).toBe('PNG');
    expect(bytes.includes(Buffer.from('acTL'))).toBe(true);
    expect(bytes.includes(Buffer.from('fcTL'))).toBe(true);
  });
});
