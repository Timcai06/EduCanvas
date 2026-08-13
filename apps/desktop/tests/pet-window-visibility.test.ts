import { describe, expect, it, vi } from 'vitest';

import {
  showPetWindow,
  togglePetWindow,
} from '../src/main/pet-window-visibility';

function createWindow(visible: boolean) {
  let currentVisibility = visible;
  return {
    isDestroyed: vi.fn(() => false),
    isVisible: vi.fn(() => currentVisibility),
    hide: vi.fn(() => {
      currentVisibility = false;
    }),
    setOpacity: vi.fn(),
    showInactive: vi.fn(() => {
      currentVisibility = true;
    }),
  };
}

describe('桌宠窗口显隐', () => {
  it('从托盘唤出时不抢占当前窗口焦点', () => {
    const win = createWindow(false);

    togglePetWindow(win);

    expect(win.showInactive).toHaveBeenCalledOnce();
    expect(win.hide).not.toHaveBeenCalled();
  });

  it('唤出时先保持全透明，避开系统窗口渐显动画后再完整显示', () => {
    vi.useFakeTimers();
    const win = createWindow(false);

    showPetWindow(win);

    expect(win.setOpacity).toHaveBeenCalledWith(0);
    expect(win.setOpacity).not.toHaveBeenCalledWith(1);
    vi.runAllTimers();
    expect(win.setOpacity).toHaveBeenCalledWith(1);
    vi.useRealTimers();
  });

  it('已经显示时仍可从托盘隐藏', () => {
    const win = createWindow(true);

    togglePetWindow(win);

    expect(win.hide).toHaveBeenCalledOnce();
    expect(win.showInactive).not.toHaveBeenCalled();
  });

  it('窗口销毁后不再尝试显示', () => {
    const win = createWindow(false);
    win.isDestroyed.mockReturnValue(true);

    showPetWindow(win);

    expect(win.showInactive).not.toHaveBeenCalled();
  });
});
