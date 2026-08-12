import { describe, expect, it } from 'vitest';
import {
  MVP_CHAT_WIDTH,
  MVP_PET_SIZE,
  MVP_WINDOW_HEIGHT,
  MVP_WINDOW_WIDTH,
} from '../src/shared/pet-mvp-layout';

describe('桌宠 MVP 固定布局', () => {
  it('聊天框和角色始终容纳在同一个固定窗口中', () => {
    expect(MVP_WINDOW_WIDTH).toBeGreaterThanOrEqual(
      MVP_CHAT_WIDTH + MVP_PET_SIZE,
    );
    expect(MVP_WINDOW_HEIGHT).toBeGreaterThanOrEqual(MVP_PET_SIZE);
  });
});
