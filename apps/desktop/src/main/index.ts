import { promises as fileSystem } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  safeStorage,
  screen,
  session,
  shell,
} from 'electron';
import {
  gatewayDesktopProtocol,
  type GatewayOperationEvent,
} from '@educanvas/gateway-core';
import { GatewayClient } from '@educanvas/gateway-client';
import { createPetWindow } from './pet-window';
import type { PetWindowController } from './pet-window';
import { createTray } from './tray';
import { createAssistantProxy, type TurnTracker } from './assistant-proxy';
import { toAssistantProjection } from './assistant-projection';
import { createOperationRegistry } from './operation-registry';
import { registerOperationIpc } from './operation-ipc';
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
import type { VoiceAudioInput } from '../shared/voice-result';
import { createPetMouseTracker } from './pet-mouse-tracker';
import { createExpandedChatWindow } from './chat-window';
import { createChatHistoryStore } from './chat-history-store';
import type { DesktopChatMessageInput } from '../shared/chat-history';
import type { DesktopAttachmentRef } from '../shared/desktop-attachment';
import { isPetVisualSignal } from '../shared/pet-visual-signal';
import { createAttachmentUpload } from './attachment-upload';
import { createOperationLease } from './operation-lease';
import { createConversationCoordinator } from './conversation-coordinator';
import type { DesktopConversationCreateInput } from '../shared/conversation-directory';
import { registerDesktopResultActions } from './result-opener';
const WEB_BASE_URL =
  process.env['EDUCANVAS_DESKTOP_WEB_URL'] ??
  process.env['EDUCANVAS_DESKTOP_API_BASE'] ??
  'http://127.0.0.1:3000';
const GATEWAY_BASE_URL =
  process.env['EDUCANVAS_DESKTOP_GATEWAY_URL'] ?? 'http://127.0.0.1:3200';

/** renderer 提交的附件投影边界校验（DP10）：字段必须全部是非空短字符串。 */
function isDesktopAttachmentRef(value: unknown): value is DesktopAttachmentRef {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.assetId === 'string' &&
    record.assetId.length > 0 &&
    record.assetId.length <= 160 &&
    typeof record.versionId === 'string' &&
    record.versionId.length > 0 &&
    record.versionId.length <= 160 &&
    typeof record.kind === 'string' &&
    record.kind.length <= 64 &&
    typeof record.mimeType === 'string' &&
    record.mimeType.length <= 255 &&
    typeof record.displayName === 'string' &&
    record.displayName.length <= 300 &&
    typeof record.notebookId === 'string' &&
    record.notebookId.length > 0 &&
    record.notebookId.length <= 160
  );
}
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
let expandedChatWindow: BrowserWindow | null = null;
let petChatExpanded = true;
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
  const chatHistory = createChatHistoryStore();
  const operationLease = createOperationLease();
  const operationRegistry = createOperationRegistry();
  const conversations = createConversationCoordinator({
    getSession: authAccess.getSession,
    invalidateSession: authAccess.invalidateSession,
  });
  const attachmentUpload = createAttachmentUpload({
    showOpenDialog: () =>
      dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [
          {
            name: '图片与 PDF',
            extensions: ['png', 'jpg', 'jpeg', 'webp', 'pdf'],
          },
        ],
      }),
    readFileAsUpload: async (filePath) => {
      const bytes = await fileSystem.readFile(filePath);
      return new File(
        [new Uint8Array(bytes)],
        filePath.split(/[\\/]/).pop() ?? 'attachment',
      );
    },
    uploadAsset: (client, notebookId, file) =>
      client.uploadAsset({ notebookId, file, scope: 'space' }),
    getAsset: (client, assetId, notebookId) =>
      client.getAsset({ assetId, notebookId }),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
  });
  const petMouseTracker = createPetMouseTracker<ReturnType<typeof setInterval>>(
    {
      readCursor: () => screen.getCursorScreenPoint(),
      readWindowBounds: () => petController!.win.getBounds(),
      isChatExpanded: () => petChatExpanded,
      setMousePassthrough: (passthrough) =>
        petController!.win.setIgnoreMouseEvents(passthrough),
      schedule: (callback) => setInterval(callback, 16),
      cancelSchedule: (handle) => clearInterval(handle),
    },
  );

  const isPetSender = (senderId: number): boolean =>
    petController?.win.isDestroyed() === false &&
    petController.win.webContents.id === senderId;
  const isExpandedChatSender = (senderId: number): boolean =>
    expandedChatWindow?.isDestroyed() === false &&
    expandedChatWindow.webContents.id === senderId;
  const isDesktopSender = (senderId: number): boolean =>
    isPetSender(senderId) || isExpandedChatSender(senderId);
  registerDesktopResultActions({
    ipcMain,
    isDesktopSender,
    getSession: authAccess.getSession,
    currentConversationId: () =>
      conversations.currentCursor()?.conversationId ?? null,
    openExternal: (url) => shell.openExternal(url),
  });
  ipcMain.handle('attachment:pick', async (event) => {
    if (!isDesktopSender(event.sender.id))
      throw new Error('Untrusted renderer');
    const session = await authAccess.getSession();
    const notebookId = conversations.currentCursor()?.notebookId ?? null;
    if (!session || !notebookId) {
      return { ok: false, message: '请先登录并选择一个对话。' };
    }
    // 上传绑定 pick 时刻的 notebookId；renderer 随 assistant:turn 带 attachment
    // 时由 assistant-proxy 再次校验 notebookId 是否仍是当前会话。
    const client = new GatewayClient(session.gatewayBaseUrl, session.token);
    return attachmentUpload.pickAndUpload(client, notebookId);
  });
  const sendToDesktopRenderers = (channel: string, payload: unknown): void => {
    for (const win of [petController?.win, expandedChatWindow]) {
      if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
    }
  };
  const publishConversationState = (snapshot = conversations.state()): void => {
    sendToDesktopRenderers('conversation:state', snapshot);
  };
  /** 切换到当前会话并载入其最近一页 canonical Message，重建可删除的 View Cache。 */
  const reloadChatForConversation = async (): Promise<void> => {
    const cursor = conversations.currentCursor();
    if (!cursor) {
      chatHistory.setConversation(null);
      sendToDesktopRenderers('chat:history', chatHistory.state());
      return;
    }
    const conversationId = cursor.conversationId;
    chatHistory.setConversation(conversationId);
    chatHistory.setLoading(true);
    sendToDesktopRenderers('chat:history', chatHistory.state());
    try {
      const page = await proxy.listMessagePage(conversationId, { limit: 50 });
      if (conversations.currentCursor()?.conversationId !== conversationId)
        return;
      chatHistory.reconcile(page.messages, {
        hasMore: page.nextCursor !== null,
        nextCursor: page.nextCursor,
      });
    } catch {
      // 历史载入失败不阻塞聊天；保留空视图等待下一次重建。
      if (conversations.currentCursor()?.conversationId !== conversationId)
        return;
      chatHistory.setLoading(false);
    }
    sendToDesktopRenderers('chat:history', chatHistory.state());
  };
  /** 向上加载更早一页：以当前视图最旧一条的游标请求上一页并 prepend。 */
  const loadEarlierChat = async (): Promise<void> => {
    const cursor = conversations.currentCursor();
    const state = chatHistory.state();
    if (!cursor || !state.nextCursor) return;
    const conversationId = cursor.conversationId;
    chatHistory.setLoading(true);
    sendToDesktopRenderers('chat:history', chatHistory.state());
    try {
      const page = await proxy.listMessagePage(conversationId, {
        limit: 50,
        cursor: state.nextCursor,
      });
      if (conversations.currentCursor()?.conversationId !== conversationId)
        return;
      chatHistory.prependEarlier(page.messages, {
        hasMore: page.nextCursor !== null,
        nextCursor: page.nextCursor,
      });
    } catch {
      // 加载更早页失败不阻塞聊天。
      if (conversations.currentCursor()?.conversationId !== conversationId)
        return;
      chatHistory.setLoading(false);
    }
    sendToDesktopRenderers('chat:history', chatHistory.state());
  };
  const openExpandedChat = (): void => {
    if (expandedChatWindow && !expandedChatWindow.isDestroyed()) {
      expandedChatWindow.show();
      expandedChatWindow.focus();
      return;
    }
    expandedChatWindow = createExpandedChatWindow();
    const senderId = expandedChatWindow.webContents.id;
    expandedChatWindow.webContents.once('destroyed', () => {
      abortRegistry.cancelOwner(senderId);
      operationLease.releaseOwner(senderId);
    });
    expandedChatWindow.on('closed', () => {
      expandedChatWindow = null;
    });
  };
  ipcMain.on('pet:hide', (event) => {
    if (!isPetSender(event.sender.id)) return;
    petController!.win.hide();
  });
  ipcMain.on('pet:set-chat-expanded', (event, expanded: boolean) => {
    if (!isPetSender(event.sender.id) || typeof expanded !== 'boolean') return;
    petChatExpanded = expanded;
  });
  ipcMain.on('chat:open-window', (event) => {
    if (!isDesktopSender(event.sender.id)) return;
    openExpandedChat();
  });
  ipcMain.handle('chat:get-history', (event) => {
    if (!isDesktopSender(event.sender.id))
      throw new Error('Untrusted renderer');
    return chatHistory.state();
  });
  ipcMain.handle('conversation:get-state', (event) => {
    if (!isDesktopSender(event.sender.id))
      throw new Error('Untrusted renderer');
    return conversations.state();
  });
  ipcMain.handle('conversation:load', async (event) => {
    if (!isDesktopSender(event.sender.id))
      throw new Error('Untrusted renderer');
    const before = conversations.state().currentConversationId;
    const snapshot = await conversations.load();
    if (before !== snapshot.currentConversationId)
      await reloadChatForConversation();
    publishConversationState(snapshot);
    return snapshot;
  });
  ipcMain.handle(
    'conversation:select',
    async (event, conversationId: unknown) => {
      if (!isDesktopSender(event.sender.id))
        throw new Error('Untrusted renderer');
      if (typeof conversationId !== 'string' || conversationId.length > 200)
        throw new Error('Invalid conversation');
      const before = conversations.state().currentConversationId;
      const snapshot = conversations.select(conversationId);
      if (before !== snapshot.currentConversationId)
        await reloadChatForConversation();
      publishConversationState(snapshot);
      return snapshot;
    },
  );
  ipcMain.handle(
    'conversation:create',
    async (event, input: DesktopConversationCreateInput) => {
      if (!isDesktopSender(event.sender.id))
        throw new Error('Untrusted renderer');
      if (
        !input ||
        typeof input.notebookId !== 'string' ||
        input.notebookId.length > 200 ||
        typeof input.title !== 'string' ||
        !input.title.trim() ||
        input.title.length > 300
      )
        throw new Error('Invalid conversation input');
      const snapshot = await conversations.create({
        notebookId: input.notebookId,
        title: input.title.trim(),
      });
      if (!snapshot.error) await reloadChatForConversation();
      publishConversationState(snapshot);
      return snapshot;
    },
  );
  ipcMain.handle('chat:append', (event, input: DesktopChatMessageInput) => {
    if (!isDesktopSender(event.sender.id))
      throw new Error('Untrusted renderer');
    if (
      !input ||
      !['user', 'assistant', 'system'].includes(input.role) ||
      !['text', 'voice'].includes(input.source) ||
      typeof input.content !== 'string' ||
      input.content.length > 20_000 ||
      (input.clientMessageId !== undefined &&
        (typeof input.clientMessageId !== 'string' ||
          input.clientMessageId.length > 200)) ||
      (input.attachment !== undefined &&
        !isDesktopAttachmentRef(input.attachment))
    ) {
      throw new Error('Invalid chat message');
    }
    chatHistory.append(input);
    const snapshot = chatHistory.state();
    sendToDesktopRenderers('chat:history', snapshot);
    return snapshot;
  });
  ipcMain.handle('chat:load-earlier', async (event) => {
    if (!isDesktopSender(event.sender.id))
      throw new Error('Untrusted renderer');
    await loadEarlierChat();
    return chatHistory.state();
  });
  ipcMain.on('pet:set-visual', (event, state: unknown) => {
    if (!isDesktopSender(event.sender.id) || !isPetVisualSignal(state)) return;
    sendToDesktopRenderers('pet:visual', state);
  });
  ipcMain.handle('operation:acquire', (event) => {
    if (!isDesktopSender(event.sender.id))
      throw new Error('Untrusted renderer');
    const token = operationLease.acquire(event.sender.id);
    return token
      ? { ok: true as const, token }
      : { ok: false as const, message: '另一个对话窗口正在处理，请稍候。' };
  });
  ipcMain.on('operation:release', (event, token: unknown) => {
    if (!isDesktopSender(event.sender.id) || typeof token !== 'string') return;
    operationLease.release(event.sender.id, token);
  });
  ipcMain.handle('auth:get-status', (event) => {
    if (!isDesktopSender(event.sender.id))
      throw new Error('Untrusted renderer');
    return (
      authCoordinator?.getStatus() ?? Promise.resolve({ state: 'signed_out' })
    );
  });
  ipcMain.handle('auth:sign-in', (event) => {
    if (!isDesktopSender(event.sender.id))
      throw new Error('Untrusted renderer');
    return (
      authCoordinator?.signIn() ?? Promise.resolve({ state: 'signed_out' })
    );
  });
  ipcMain.handle('auth:sign-out', (event) => {
    if (!isDesktopSender(event.sender.id))
      throw new Error('Untrusted renderer');
    return (
      authCoordinator?.signOut() ?? Promise.resolve({ state: 'signed_out' })
    );
  });
  ipcMain.handle(
    'assistant:turn',
    async (
      event,
      payload: {
        requestId: string;
        text: string;
        source?: 'text' | 'voice';
        clientMessageId?: string;
        leaseToken: string;
        attachment?: DesktopAttachmentRef;
      },
    ) => {
      if (!isDesktopSender(event.sender.id))
        throw new Error('Untrusted renderer');
      if (
        !payload ||
        typeof payload.leaseToken !== 'string' ||
        !operationLease.holds(event.sender.id, payload.leaseToken) ||
        typeof payload.text !== 'string' ||
        payload.text.length > 4_000 ||
        !['text', 'voice'].includes(payload.source ?? 'text') ||
        (payload.clientMessageId !== undefined &&
          (typeof payload.clientMessageId !== 'string' ||
            payload.clientMessageId.length > 200)) ||
        !isDesktopAttachmentRef(payload.attachment)
      )
        throw new Error('Invalid assistant turn');
      const signal = abortRegistry.begin(payload.requestId, event.sender.id);
      const cursor = conversations.currentCursor();
      const routeRevision = conversations.state().revision;
      const clientMessageId = payload.clientMessageId;
      const conversationId = cursor?.conversationId ?? null;
      const publishProjection = (rawEvent: GatewayOperationEvent): void => {
        if (!conversationId) return;
        // 路由已切换：旧 operation 的迟到事件不得投影到新会话视图。
        if (conversations.state().revision !== routeRevision) return;
        const projection = toAssistantProjection(rawEvent, {
          requestId: payload.requestId,
          clientMessageId: clientMessageId ?? null,
          conversationId,
        });
        if (projection) sendToDesktopRenderers('assistant:event', projection);
      };
      const tracker: TurnTracker = {
        operationId: null,
        lastSequence: -1,
        onEvent: publishProjection,
      };
      if (clientMessageId) {
        tracker.onAccepted = (operationId) =>
          operationRegistry.accept(clientMessageId, operationId);
        tracker.onSequence = (sequence) =>
          operationRegistry.recordSequence(clientMessageId, sequence);
        operationRegistry.begin(clientMessageId, {
          conversationId,
          ownerId: event.sender.id,
        });
      }
      try {
        const result = await proxy.turn(
          {
            text: payload.text,
            cursor: cursor ?? undefined,
            clientMessageId: payload.clientMessageId,
            attachment: payload.attachment,
          },
          signal,
          tracker,
        );
        if (clientMessageId) {
          if (!result.ok && result.code === 'interrupted') {
            operationRegistry.markInterrupted(clientMessageId);
          } else {
            operationRegistry.remove(clientMessageId);
          }
        }
        if (routeRevision !== conversations.state().revision) {
          return {
            ok: false as const,
            code: 'aborted' as const,
            message: '会话已切换。',
          };
        }
        if (result.ok) {
          // 用服务端 canonical Message 重建视图，乐观 User Message 按 clientMessageId 去重。
          await reloadChatForConversation();
        }
        return result;
      } finally {
        abortRegistry.finish(payload.requestId, signal);
      }
    },
  );
  ipcMain.handle(
    'voice:transcribe',
    async (
      event,
      payload: {
        requestId: string;
        input: VoiceAudioInput;
        leaseToken: string;
      },
    ) => {
      if (!isDesktopSender(event.sender.id))
        throw new Error('Untrusted renderer');
      if (
        !payload?.input ||
        typeof payload.leaseToken !== 'string' ||
        !operationLease.holds(event.sender.id, payload.leaseToken) ||
        payload.input.mimeType !== 'audio/webm' ||
        !(payload.input.bytes instanceof Uint8Array) ||
        payload.input.bytes.byteLength === 0 ||
        payload.input.bytes.byteLength > 2 * 1024 * 1024
      )
        throw new Error('Invalid voice input');
      const signal = abortRegistry.begin(payload.requestId, event.sender.id);
      try {
        return await voiceProxy.transcribe(payload.input, signal);
      } finally {
        abortRegistry.finish(payload.requestId, signal);
      }
    },
  );
  ipcMain.handle(
    'voice:synthesize',
    async (
      event,
      payload: {
        requestId: string;
        text: string;
        assistantMessageId?: string;
        leaseToken: string;
      },
    ) => {
      if (!isDesktopSender(event.sender.id))
        throw new Error('Untrusted renderer');
      if (
        !payload ||
        typeof payload.leaseToken !== 'string' ||
        !operationLease.holds(event.sender.id, payload.leaseToken) ||
        typeof payload.text !== 'string' ||
        payload.text.length > 3_500 ||
        (payload.assistantMessageId !== undefined &&
          (typeof payload.assistantMessageId !== 'string' ||
            payload.assistantMessageId.length > 200))
      )
        throw new Error('Invalid speech input');
      const signal = abortRegistry.begin(payload.requestId, event.sender.id);
      try {
        return await voiceProxy.synthesize(
          {
            text: payload.text,
            assistantMessageId: payload.assistantMessageId,
          },
          signal,
        );
      } finally {
        abortRegistry.finish(payload.requestId, signal);
      }
    },
  );
  ipcMain.on('operation:cancel', (event, requestId: string) => {
    if (!isDesktopSender(event.sender.id)) return;
    abortRegistry.cancel(requestId, event.sender.id);
  });
  registerOperationIpc({
    ipcMain,
    isDesktopSender,
    operationLease,
    operationRegistry,
    proxy,
    reloadChatForConversation,
    broadcastProjection: (projection) =>
      sendToDesktopRenderers('assistant:event', projection),
    currentConversationId: () =>
      conversations.currentCursor()?.conversationId ?? null,
  });
  // Windows/Linux send custom schemes to the existing single instance command line.
  app.on('second-instance', (_event, commandLine) => {
    const deepLink = findDesktopDeepLink(commandLine);
    if (deepLink) dispatchDeepLink(deepLink);
    focusPet();
  });
  void app.whenReady().then(async () => {
    petController = createPetWindow();
    petController.win.on('show', petMouseTracker.start);
    petController.win.on('hide', petMouseTracker.stop);
    petController.win.on('closed', petMouseTracker.stop);
    const petSenderId = petController.win.webContents.id;
    petController.win.webContents.once('destroyed', () => {
      abortRegistry.cancelOwner(petSenderId);
      operationLease.releaseOwner(petSenderId);
    });
    if (petController.win.isVisible()) petMouseTracker.start();
    const publishAuthStatus = (status: DesktopAuthStatus): void => {
      sendToDesktopRenderers('auth:status', status);
      if (status.state === 'signed_in') {
        void conversations.load().then(async (snapshot) => {
          publishConversationState(snapshot);
          await reloadChatForConversation();
        });
      } else if (status.state === 'signed_out') {
        publishConversationState(conversations.reset());
        void reloadChatForConversation();
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

    session.defaultSession.setPermissionRequestHandler(
      (webContents, permission, callback, details) => {
        const mediaTypes =
          'mediaTypes' in details ? details.mediaTypes : undefined;
        callback(
          isDesktopSender(webContents.id) &&
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
        webContents !== null &&
        isDesktopSender(webContents.id) &&
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

  app.on('before-quit', () => {
    petMouseTracker.stop();
    abortRegistry.cancelAll();
    for (const op of operationRegistry.pending().operations) {
      void proxy.cancel(op.operationId).catch(() => undefined);
    }
  });
  app.on('window-all-closed', () => {
    /* Closing hides to tray; only the tray Quit action terminates the process. */
  });
}
