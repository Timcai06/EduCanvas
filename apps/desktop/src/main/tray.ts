import { app, Menu, Tray, nativeImage } from 'electron';
import { join } from 'node:path';
import type { BrowserWindow } from 'electron';
import { showPetWindow, togglePetWindow } from './pet-window-visibility';

/** 托盘「退出」置位后 app.quit()；window.ts 的 close 拦截据此放行，实现「仅托盘退出真退出」。 */
let quitRequested = false;
export const isQuitRequested = (): boolean => quitRequested;
export const requestQuit = (): void => {
  quitRequested = true;
  app.quit();
};

export function createTray(
  win: BrowserWindow,
  options: { onSignOut?: () => void | Promise<unknown> } = {},
): Tray {
  const icon = nativeImage.createFromPath(
    join(__dirname, '../../assets/icon.png'),
  );
  const tray = new Tray(icon.resize({ width: 16, height: 16 }));
  tray.setToolTip('EduCanvas 助手');
  tray.on('click', () => togglePetWindow(win));
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '显示助手', click: () => showPetWindow(win) },
      {
        label: '退出登录',
        click: () => {
          void options.onSignOut?.();
        },
      },
      { type: 'separator' },
      { label: '退出', click: requestQuit },
    ]),
  );
  return tray;
}
