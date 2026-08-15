import type {
  DesktopPendingOperation,
  DesktopPendingOperationsSnapshot,
} from '../shared/pending-operation';

type PendingStatus = 'running' | 'interrupted';

interface PendingOperation {
  clientMessageId: string;
  operationId: string | null;
  lastSequence: number;
  conversationId: string | null;
  ownerId: number | null;
  status: PendingStatus;
}

/**
 * main 进程内存态 Operation 注册表：保存一次 Turn 的稳定身份（clientMessageId）、
 * 服务端 operationId、已消费的最后 sequence、所属 Conversation 与发起窗口 owner，
 * 供断线后 resume 同一 Operation。应用重启不续传（由 canonical 历史重建覆盖）。
 */
export function createOperationRegistry() {
  const entries = new Map<string, PendingOperation>();

  return {
    begin(
      clientMessageId: string,
      context: { conversationId: string | null; ownerId: number | null },
    ): void {
      entries.set(clientMessageId, {
        clientMessageId,
        operationId: null,
        lastSequence: -1,
        conversationId: context.conversationId,
        ownerId: context.ownerId,
        status: 'running',
      });
    },

    accept(clientMessageId: string, operationId: string): void {
      const entry = entries.get(clientMessageId);
      if (entry) entry.operationId = operationId;
    },

    recordSequence(clientMessageId: string, sequence: number): void {
      const entry = entries.get(clientMessageId);
      if (entry && sequence > entry.lastSequence) entry.lastSequence = sequence;
    },

    markInterrupted(clientMessageId: string): void {
      const entry = entries.get(clientMessageId);
      if (entry) entry.status = 'interrupted';
    },

    /** 终态（completed/failed/cancelled）后移除，避免常驻。 */
    remove(clientMessageId: string): void {
      entries.delete(clientMessageId);
    },

    get(clientMessageId: string): PendingOperation | undefined {
      return entries.get(clientMessageId);
    },

    /** 返回可续传（已有 operationId 且未终态）的投影，供 renderer 重连恢复。 */
    pending(): DesktopPendingOperationsSnapshot {
      const operations: DesktopPendingOperation[] = [];
      for (const entry of entries.values()) {
        if (!entry.operationId) continue;
        operations.push({
          clientMessageId: entry.clientMessageId,
          operationId: entry.operationId,
          status: entry.status,
          conversationId: entry.conversationId,
        });
      }
      return { operations };
    },
  };
}

export type OperationRegistry = ReturnType<typeof createOperationRegistry>;
