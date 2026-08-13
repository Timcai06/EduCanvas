import { describe, expect, it } from 'vitest';

import { PET_WINDOW_APPEARANCE } from '../src/main/pet-window-appearance';

describe('透明桌宠窗口外观', () => {
  it('首个合成帧也是透明底色，避免重新显示时闪出默认白底', () => {
    expect(PET_WINDOW_APPEARANCE).toMatchObject({
      transparent: true,
      backgroundColor: '#00000000',
    });
  });

  it('窗口隐藏时仍持续合成 APNG，避免角色唤出时跳闪', () => {
    expect(PET_WINDOW_APPEARANCE).toMatchObject({
      webPreferences: {
        backgroundThrottling: false,
      },
    });
  });
});
