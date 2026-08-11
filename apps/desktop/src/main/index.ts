import { promises as fileSystem } from 'node:fs';
import { join, resolve } from 'node:path';
import { app, ipcMain, safeStorage, session, shell } from 'electron';
import { gatewayDesktopProtocol } from '@educanvas/gateway-core';
import { createPetWindow } from './pet-window';
import type { PetWindowController } from './pet-window';
import { createTray } from './tray';
import { createAssistantProxy } from './assistant-proxy';
import { createVoiceProxy } from './voice-proxy';
import { isAllowedVoicePermission } from './voice-permission';
import { IpcAbortRegistry } from './ipc-abort-registry';
import { createDesktopSessionStore } from './desktop-session-store';
import {
  createDesktopAuthCoordinator,
  type DesktopAuthCoordinator,
} from './desktop-auth-service';
import type { DesktopAuthStatus } from '../shared/desktop-auth';
import { findDesktopDeepLink } from './native-auth';
import type { DragPoint } from '../shared/pet-drag';
import type { VoiceAudioInput } from '../shared/voice-result';

const WEB_BASE_URL =
  process.env['EDUCANVAS_DESKTOP_WEB_URL'] ??
  process.env['EDUCANVAS_DESKTOP_API_BASE'] ??
  'http://127.0.0.1:3101';
const GATEWAY_BASE_URL =
  process.env['EDUCANVAS_DESKTOP_GATEWAY_URL'] ?? 'http://127.0.0.1:3200';

// Electron deep-link registration and platform callbacks follow the official pattern:
// https://www.electronjs.org/docs/latest/tutorial/launch-app-from-url-in-another-app
if (process.defaultApp && process.argv[1]) {
  app.setAsDefaultProtocolClient(gatewayDesktopProtocol, process.execPath, [
    resolve(process.argv[1]),
  ]);
} else {
  app.setAsDefaultProtocolClient(gatewayDesktopProtocol);
}

let authCoordinator: DesktopAuthCoordinator | null = null;
let queuedDeepLink: string | null = null;
let petController: PetWindowController | null = null;

function focusPet(): void {
  if (!petController || petController.win.isDestroyed()) return;
  petController.win.show();
  petController.win.focus();
}

function dispatchDeepLink(raw: string): void {
  if (!authCoordinator) {
    queuedDeepLink = raw;
    return;
  }
  void authCoordinator.handleDeepLink(raw).finally(focusPet);
}

// macOS delivers both cold and warm custom-scheme launches through open-url.
app.on('open-url', (event, url) => {
  event.preventDefault();
  dispatchDeepLink(url);
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  const authAccess = {
    getSession: () => authCoordinator?.getSession() ?? Promise.resolve(null),
    invalidateSession: () =>
      authCoordinator?.invalidateSession() ??
      Promise.resolve({ state: 'signed_out' as const }),
  };
  const proxy = createAssistantProxy(authAccess);
  const voiceProxy = createVoiceProxy(authAccess);
  const abortRegistry = new IpcAbortRegistry();

  ipcMain.handle(
    'auth:get-status',
    () =>
      authCoordinator?.getStatus() ?? Promise.resolve({ state: 'signed_out' }),
  );
  ipcMain.handle(
    'auth:sign-in',
    () => authCoordinator?.signIn() ?? Promise.resolve({ state: 'signed_out' }),
  );
  ipcMain.handle(
    'auth:sign-out',
    () =>
      authCoordinator?.signOut() ?? Promise.resolve({ state: 'signed_out' }),
  );
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

  // Windows/Linux send custom schemes to the existing single instance command line.
  app.on('second-instance', (_event, commandLine) => {
    const deepLink = findDesktopDeepLink(commandLine);
    if (deepLink) dispatchDeepLink(deepLink);
    focusPet();
  });

  void app.whenReady().then(async () => {
    petController = createPetWindow();
    const publishAuthStatus = (status: DesktopAuthStatus): void => {
      if (petController?.win.isDestroyed() === false) {
        petController.win.webContents.send('auth:status', status);
      }
    };
    authCoordinator = createDesktopAuthCoordinator({
      webBaseUrl: WEB_BASE_URL,
      gatewayBaseUrl: GATEWAY_BASE_URL,
      sessionStore: createDesktopSessionStore({
        filePath: join(app.getPath('userData'), 'desktop-session.enc'),
        safeStorage,
        fileSystem,
      }),
      openExternal: (url) => shell.openExternal(url),
      onStatus: publishAuthStatus,
    });
    await authCoordinator.getStatus();

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
    createTray(petController.win, {
      onSignOut: () => authCoordinator?.signOut(),
    });

    const initialDeepLink =
      queuedDeepLink ??
      (process.platform === 'darwin'
        ? null
        : findDesktopDeepLink(process.argv));
    queuedDeepLink = null;
    if (initialDeepLink) dispatchDeepLink(initialDeepLink);
  });

  app.on('before-quit', () => abortRegistry.cancelAll());
  app.on('window-all-closed', () => {
    /* Closing hides to tray; only the tray Quit action terminates the process. */
  });
}
