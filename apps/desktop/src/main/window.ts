import { BrowserWindow } from 'electron';
import { join } from 'node:path';
import { isQuitRequested } from './tray';

export function createAssistantWindow(onFirstHide: () => void): BrowserWindow {
  const win = new BrowserWindow({
    width: 380,
    height: 600,
    title: 'EduCanvas 助手',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
    },
  });

  // 关闭 = 隐藏到托盘；仅托盘「退出」（isQuitRequested 置位）时真正放行关闭
  let hideToastShown = false;
  win.on('close', (event) => {
    if (!isQuitRequested()) {
      event.preventDefault();
      win.hide();
      if (!hideToastShown) {
        hideToastShown = true;
        onFirstHide();
      }
    }
  });

  win.on('ready-to-show', () => win.show());

  const rendererUrl = process.env['ELECTRON_RENDERER_URL'];
  if (rendererUrl) {
    void win.loadURL(rendererUrl);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }
  return win;
}
