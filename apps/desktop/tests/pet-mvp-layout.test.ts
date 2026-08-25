import { describe, expect, it } from 'vitest';
import {
  MVP_CHAT_WIDTH,
  MVP_PET_SIZE,
  MVP_WINDOW_MAX_HEIGHT,
  MVP_WINDOW_MAX_WIDTH,
  MVP_WINDOW_HEIGHT,
  MVP_WINDOW_MIN_HEIGHT,
  MVP_WINDOW_MIN_WIDTH,
  MVP_WINDOW_WIDTH,
} from '../src/shared/pet-mvp-layout';

describe('桌宠 MVP 有界弹性布局', () => {
  it('默认尺寸容纳聊天框和角色，并允许在安全范围内调整', () => {
    expect(MVP_WINDOW_WIDTH).toBeGreaterThanOrEqual(
      MVP_CHAT_WIDTH + MVP_PET_SIZE,
    );
    expect(MVP_WINDOW_HEIGHT).toBeGreaterThanOrEqual(MVP_PET_SIZE);
    expect(MVP_WINDOW_MIN_WIDTH).toBe(MVP_WINDOW_WIDTH);
    expect(MVP_WINDOW_MIN_HEIGHT).toBe(MVP_WINDOW_HEIGHT);
    expect(MVP_WINDOW_MAX_WIDTH).toBeGreaterThan(MVP_WINDOW_WIDTH);
    expect(MVP_WINDOW_MAX_HEIGHT).toBeGreaterThan(MVP_WINDOW_HEIGHT);
  });
});
