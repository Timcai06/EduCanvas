import type { IpcMain } from 'electron';
import type { AssistantProxy, TurnTracker } from './assistant-proxy';
import type { OperationRegistry } from './operation-registry';
import type { TurnResult } from '../shared/turn-result';

interface OperationLeasePort {
  holds(ownerId: number, token: string): boolean;
}

/**
 * Operation 续传 / 恢复相关 IPC。拆出单独模块以控制 index.ts 体积；
 * 仍由 main 持有唯一 Operation 注册表与租约，renderer 只拿到受限投影。
 */
export function registerOperationIpc(options: {
  ipcMain: IpcMain;
  isDesktopSender: (senderId: number) => boolean;
  operationLease: OperationLeasePort;
  operationRegistry: OperationRegistry;
  proxy: Pick<AssistantProxy, 'resume'>;
  reloadChatForConversation: () => Promise<void>;
}): void {
  const {
    ipcMain,
    isDesktopSender,
    operationLease,
    operationRegistry,
    proxy,
    reloadChatForConversation,
  } = options;

  ipcMain.handle('operation:get-pending', (event) => {
    if (!isDesktopSender(event.sender.id))
      throw new Error('Untrusted renderer');
    return operationRegistry.pending();
  });

  ipcMain.handle(
    'operation:resume',
    async (
      event,
      payload: { clientMessageId: string; leaseToken: string },
    ): Promise<TurnResult> => {
      if (!isDesktopSender(event.sender.id))
        throw new Error('Untrusted renderer');
      if (
        !payload ||
        typeof payload.clientMessageId !== 'string' ||
        payload.clientMessageId.length > 200 ||
        typeof payload.leaseToken !== 'string' ||
        !operationLease.holds(event.sender.id, payload.leaseToken)
      )
        throw new Error('Invalid resume');
      const entry = operationRegistry.get(payload.clientMessageId);
      if (!entry?.operationId) {
        return {
          ok: false,
          code: 'http',
          message: '无可续传的请求，请重新发送。',
        };
      }
      const tracker: TurnTracker = {
        operationId: entry.operationId,
        lastSequence: entry.lastSequence,
        onSequence: (sequence) =>
          operationRegistry.recordSequence(entry.clientMessageId, sequence),
      };
      try {
        const result = await proxy.resume(
          {
            operationId: entry.operationId,
            afterSequence: entry.lastSequence,
          },
          undefined,
          tracker,
        );
        if (!result.ok && result.code === 'interrupted') {
          operationRegistry.markInterrupted(entry.clientMessageId);
        } else {
          operationRegistry.remove(entry.clientMessageId);
        }
        if (result.ok) await reloadChatForConversation();
        return result;
      } catch (error) {
        operationRegistry.remove(entry.clientMessageId);
        throw error;
      }
    },
  );
}
