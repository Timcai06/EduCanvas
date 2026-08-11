import { app, ipcMain, session } from 'electron';
import { createPetWindow } from './pet-window';
import type { PetWindowController } from './pet-window';
import { createTray } from './tray';
import { createAssistantProxy } from './assistant-proxy';
import { createVoiceProxy } from './voice-proxy';
import { isAllowedVoicePermission } from './voice-permission';
import { IpcAbortRegistry } from './ipc-abort-registry';
import type { DragPoint } from '../shared/pet-drag';
import type { VoiceAudioInput } from '../shared/voice-result';

// 仓库本地 Web 约定端口 3101（tooling/local-orchestrator-config.mjs 默认值）。
// 非标准端口部署可用 EDUCANVAS_DESKTOP_API_BASE 覆盖。
const BASE_URL =
  process.env['EDUCANVAS_DESKTOP_API_BASE'] ?? 'http://127.0.0.1:3101';

// 单实例锁：二次启动聚焦已有窗口而非再开一个
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  const proxy = createAssistantProxy({ baseUrl: BASE_URL });
  const voiceProxy = createVoiceProxy({ baseUrl: BASE_URL });
  const abortRegistry = new IpcAbortRegistry();

  ipcMain.handle(
    'assistant:turn',
    async (_event, payload: { requestId: string; text: string }) => {
      const signal = abortRegistry.begin(payload.requestId);
      try {
        return await proxy.turn({ text: payload.text }, signal);
      } finally {
        abortRegistry.finish(payload.requestId, signal);
      }
    },
  );
  ipcMain.handle(
    'voice:transcribe',
    async (_event, payload: { requestId: string; input: VoiceAudioInput }) => {
      const signal = abortRegistry.begin(payload.requestId);
      try {
        return await voiceProxy.transcribe(payload.input, signal);
      } finally {
        abortRegistry.finish(payload.requestId, signal);
      }
    },
  );
  ipcMain.handle(
    'voice:synthesize',
    async (_event, payload: { requestId: string; text: string }) => {
      const signal = abortRegistry.begin(payload.requestId);
      try {
        return await voiceProxy.synthesize({ text: payload.text }, signal);
      } finally {
        abortRegistry.finish(payload.requestId, signal);
      }
    },
  );
  ipcMain.on('operation:cancel', (_event, requestId: string) => {
    abortRegistry.cancel(requestId);
  });

  // 桌宠窗口动作 IPC（controller 在 whenReady 后创建，注册期为空则安全 no-op）
  let petController: PetWindowController | null = null;
  ipcMain.handle('pet:drag-move', (_event, p: DragPoint) =>
    petController?.dragMove(p),
  );
  ipcMain.handle('pet:move-by', (_event, dx: number, dy: number) =>
    petController?.moveBy(dx, dy),
  );
  ipcMain.handle('pet:get-bounds', () => petController?.getBounds());
  ipcMain.handle('pet:set-expanded', (_event, expanded: boolean) =>
    petController?.setExpanded(expanded),
  );
  ipcMain.on('pet:set-mouse-passthrough', (_event, passthrough: boolean) =>
    petController?.setMousePassthrough(passthrough),
  );

  app.on('second-instance', () => {
    if (petController && !petController.win.isDestroyed()) {
      petController.win.show();
      petController.win.focus();
    }
  });

  app.whenReady().then(() => {
    petController = createPetWindow();
    const petWebContentsId = petController.win.webContents.id;
    session.defaultSession.setPermissionRequestHandler(
      (webContents, permission, callback, details) => {
        const mediaTypes =
          'mediaTypes' in details ? details.mediaTypes : undefined;
        callback(
          webContents.id === petWebContentsId &&
            isAllowedVoicePermission({
              permission,
              isMainFrame: details.isMainFrame,
              mediaTypes,
              requestingUrl: details.requestingUrl,
              documentUrl: webContents.getURL(),
            }),
        );
      },
    );
    session.defaultSession.setPermissionCheckHandler(
      (webContents, permission, _origin, details) =>
        webContents?.id === petWebContentsId &&
        isAllowedVoicePermission({
          permission,
          isMainFrame: details.isMainFrame,
          mediaTypes:
            details.mediaType === 'audio'
              ? ['audio']
              : [details.mediaType as 'video'],
          requestingUrl: details.requestingUrl,
          documentUrl: webContents.getURL(),
        }),
    );
    createTray(petController.win);
  });

  app.on('before-quit', () => abortRegistry.cancelAll());

  // 覆盖默认「全部窗口关闭即退出」：关闭=隐藏到托盘，仅托盘「退出」结束进程
  app.on('window-all-closed', () => {
    /* no-op */
  });
}
