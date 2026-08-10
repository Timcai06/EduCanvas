import { app, ipcMain } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { createPetWindow } from './pet-window';
import type { PetWindowController } from './pet-window';
import { createTray } from './tray';
import { createAssistantProxy } from './assistant-proxy';
import type { DragPoint } from '../shared/pet-drag';

// 仓库本地 Web 约定端口 3101（tooling/local-orchestrator-config.mjs 默认值）。
// 非标准端口部署可用 EDUCANVAS_DESKTOP_API_BASE 覆盖。
const BASE_URL =
  process.env['EDUCANVAS_DESKTOP_API_BASE'] ?? 'http://127.0.0.1:3101';

// 单实例锁：二次启动聚焦已有窗口而非再开一个
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  const proxy = createAssistantProxy({ baseUrl: BASE_URL });

  // invoke 透传 AbortSignal：renderer 取消时 event.signal 同步中止（Electron invoke 约定）。
  // 注：electron 43 的 d.ts 缺 IpcMainInvokeEvent.signal（运行时存在），此处局部增强。
  ipcMain.handle('assistant:turn', (event, payload: { text: string }) =>
    proxy.turn(
      payload,
      (event as IpcMainInvokeEvent & { signal: AbortSignal }).signal,
    ),
  );

  // 桌宠窗口动作 IPC（controller 在 whenReady 后创建，注册期为空则安全 no-op）
  let petController: PetWindowController | null = null;
  ipcMain.handle('pet:drag-move', (_event, p: DragPoint) =>
    petController?.dragMove(p),
  );
  ipcMain.handle('pet:move-by', (_event, dx: number, dy: number) =>
    petController?.moveBy(dx, dy),
  );
  ipcMain.handle('pet:get-bounds', () => petController?.getBounds());

  app.on('second-instance', () => {
    if (petController && !petController.win.isDestroyed()) {
      petController.win.show();
      petController.win.focus();
    }
  });

  app.whenReady().then(() => {
    petController = createPetWindow(() => {
      petController?.win.webContents.send(
        'pet:toast',
        '已隐藏到托盘，右键托盘图标可显示或退出。',
      );
    });
    createTray(petController.win);
  });

  // 覆盖默认「全部窗口关闭即退出」：关闭=隐藏到托盘，仅托盘「退出」结束进程
  app.on('window-all-closed', () => {
    /* no-op */
  });
}
