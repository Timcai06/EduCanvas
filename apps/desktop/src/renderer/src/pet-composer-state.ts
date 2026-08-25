import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import type { DesktopAttachmentRef } from '../../shared/desktop-attachment';
import type { DesktopChatHistorySnapshot } from '../../shared/chat-history';
import type { DesktopConversationDirectorySnapshot } from '../../shared/conversation-directory';

export function initialChatHistory(): DesktopChatHistorySnapshot {
  return {
    revision: 0,
    conversationId: null,
    messages: [],
    hasMore: false,
    nextCursor: null,
    loading: false,
  };
}

export function initialConversationDirectory(): DesktopConversationDirectorySnapshot {
  return {
    revision: 0,
    loading: false,
    conversations: [],
    currentConversationId: null,
    error: null,
  };
}

export function useDesktopAttachment(input: {
  currentNotebookId: string | null;
  message: string;
  setMessage(message: string): void;
}): {
  pendingAttachment: DesktopAttachmentRef | null;
  attachmentBusy: boolean;
  pickAttachment(): Promise<void>;
  clearAttachment(): void;
} {
  const { currentNotebookId, message, setMessage } = input;
  const [pendingAttachment, setPendingAttachment] =
    useState<DesktopAttachmentRef | null>(null);
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const attachmentBusyRef = useRef(false);
  const currentNotebookRef = useRef(currentNotebookId);

  // Assets are notebook-scoped. Clear a stale pick immediately on navigation;
  // the server-side access check remains the fail-closed boundary.
  useEffect(() => {
    if (currentNotebookRef.current === currentNotebookId) return;
    currentNotebookRef.current = currentNotebookId;
    setPendingAttachment((pending) =>
      pending && pending.notebookId !== currentNotebookId ? null : pending,
    );
  }, [currentNotebookId]);

  const pickAttachment = async (): Promise<void> => {
    if (attachmentBusyRef.current) return;
    attachmentBusyRef.current = true;
    setAttachmentBusy(true);
    const messageBeforePick = message;
    const notebookIdAtPick = currentNotebookId;
    setMessage('正在选择并上传附件…');
    try {
      const result = await window.desktopAttachment.pick();
      if (result.ok) {
        if (
          notebookIdAtPick !== currentNotebookRef.current ||
          result.attachment.notebookId !== currentNotebookRef.current
        ) {
          setMessage('对话已切换，请重新选择附件。');
          return;
        }
        setPendingAttachment(result.attachment);
        setMessage('附件已就绪，可以发送。');
      } else if (result.message === '已取消选择附件。') {
        setMessage(messageBeforePick);
      } else {
        setMessage(result.message);
      }
    } catch {
      setMessage('附件上传没有完成，请稍后重试。');
    } finally {
      attachmentBusyRef.current = false;
      setAttachmentBusy(false);
    }
  };

  return {
    pendingAttachment,
    attachmentBusy,
    pickAttachment,
    clearAttachment: () => setPendingAttachment(null),
  };
}

export function useSpeechPreparation(input: {
  latestMessageId: string | undefined;
  busy: boolean;
}): {
  speechCacheRef: MutableRefObject<{
    key: string;
    bytes: Uint8Array;
  } | null>;
  prepareSpeech(messageId: string, reply: string): void;
  cancelSpeechPreparation(): void;
} {
  const { latestMessageId, busy } = input;
  const speechCacheRef = useRef<{ key: string; bytes: Uint8Array } | null>(
    null,
  );
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelSpeechPreparation = (): void => {
    if (!timerRef.current) return;
    clearTimeout(timerRef.current);
    timerRef.current = null;
  };
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const prepareSpeech = (messageId: string, reply: string): void => {
    const key = `${messageId}\u0000${reply}`;
    if (
      messageId !== latestMessageId ||
      busy ||
      speechCacheRef.current?.key === key
    )
      return;
    cancelSpeechPreparation();
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      window.desktopVoice.prefetch(reply, messageId);
    }, 180);
  };

  return { speechCacheRef, prepareSpeech, cancelSpeechPreparation };
}
