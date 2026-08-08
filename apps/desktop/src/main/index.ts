import { app, ipcMain } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { createAssistantWindow } from './window';
import { createTray } from './tray';
import { createAssistantProxy } from './assistant-proxy';

const BASE_URL = process.env['EDUCANVAS_DESKTOP_API_BASE'] ?? 'http://localhost:3000';

// 单实例锁：二次启动聚焦已有窗口而非再开一个
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  const proxy = createAssistantProxy({ baseUrl: BASE_URL });

  // invoke 透传 AbortSignal：renderer 取消时 event.signal 同步中止（Electron invoke 约定）。
  // 注：electron 43 的 d.ts 缺 IpcMainInvokeEvent.signal（运行时存在），此处局部增强。
  ipcMain.handle('assistant:turn', (event, payload: { text: string }) =>
    proxy.turn(payload, (event as IpcMainInvokeEvent & { signal: AbortSignal }).signal),
  );

  let mainWindow: Electron.BrowserWindow | null = null;

  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    mainWindow = createAssistantWindow(() => {
      mainWindow?.webContents.send('assistant:toast', '已最小化到托盘，右键托盘图标可退出。');
    });
    createTray(mainWindow);
  });

  // 覆盖默认「全部窗口关闭即退出」：关闭=隐藏到托盘，仅托盘「退出」结束进程
  app.on('window-all-closed', () => {
    /* no-op */
  });
}
