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

export function findCurrentNotebookId(
  directory: DesktopConversationDirectorySnapshot,
): string | null {
  return (
    directory.conversations.find(
      (item) => item.conversationId === directory.currentConversationId,
    )?.notebookId ?? null
  );
}

interface ConversationDraft {
  text: string;
  attachment: DesktopAttachmentRef | null;
}

export function createConversationDraftStore() {
  const drafts = new Map<string, ConversationDraft>();
  return {
    save(conversationId: string, draft: ConversationDraft): void {
      drafts.set(conversationId, draft);
    },
    load(
      conversationId: string | null,
      notebookId: string | null,
    ): ConversationDraft {
      const draft = conversationId ? drafts.get(conversationId) : undefined;
      return {
        text: draft?.text ?? '',
        attachment:
          draft?.attachment?.notebookId === notebookId
            ? draft.attachment
            : null,
      };
    },
  };
}

export function useConversationComposer(input: {
  currentConversationId: string | null;
  currentNotebookId: string | null;
  message: string;
  setMessage(message: string): void;
}): {
  text: string;
  setText(value: string): void;
  pendingAttachment: DesktopAttachmentRef | null;
  attachmentBusy: boolean;
  pickAttachment(): Promise<void>;
  clearAttachment(): void;
} {
  const { currentConversationId, currentNotebookId, message, setMessage } =
    input;
  const [text, setTextState] = useState('');
  const [pendingAttachment, setPendingAttachment] =
    useState<DesktopAttachmentRef | null>(null);
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const attachmentBusyRef = useRef(false);
  const draftStoreRef = useRef(createConversationDraftStore());
  const activeConversationRef = useRef(currentConversationId);
  const currentNotebookRef = useRef(currentNotebookId);
  const textRef = useRef(text);
  const attachmentRef = useRef(pendingAttachment);

  const setText = (value: string): void => {
    textRef.current = value;
    setTextState(value);
  };
  const setAttachment = (attachment: DesktopAttachmentRef | null): void => {
    attachmentRef.current = attachment;
    setPendingAttachment(attachment);
  };

  useEffect(() => {
    const previousConversationId = activeConversationRef.current;
    currentNotebookRef.current = currentNotebookId;
    if (previousConversationId === currentConversationId) return;
    if (previousConversationId) {
      draftStoreRef.current.save(previousConversationId, {
        text: textRef.current,
        attachment: attachmentRef.current,
      });
    }
    activeConversationRef.current = currentConversationId;
    const draft = draftStoreRef.current.load(
      currentConversationId,
      currentNotebookId,
    );
    setText(draft.text);
    setAttachment(draft.attachment);
  }, [currentConversationId, currentNotebookId]);

  const pickAttachment = async (): Promise<void> => {
    if (attachmentBusyRef.current) return;
    attachmentBusyRef.current = true;
    setAttachmentBusy(true);
    const messageBeforePick = message;
    const conversationIdAtPick = activeConversationRef.current;
    const notebookIdAtPick = currentNotebookId;
    setMessage('正在选择并上传附件…');
    try {
      const result = await window.desktopAttachment.pick();
      if (result.ok) {
        if (result.attachment.notebookId !== notebookIdAtPick) {
          setMessage('附件与原对话不匹配，请重新选择。');
          return;
        }
        if (conversationIdAtPick !== activeConversationRef.current) {
          if (conversationIdAtPick) {
            const draft = draftStoreRef.current.load(
              conversationIdAtPick,
              notebookIdAtPick,
            );
            draftStoreRef.current.save(conversationIdAtPick, {
              ...draft,
              attachment: result.attachment,
            });
          }
          setMessage('附件已保存到原对话草稿。');
          return;
        }
        if (
          notebookIdAtPick !== currentNotebookRef.current ||
          result.attachment.notebookId !== currentNotebookRef.current
        ) {
          setMessage('对话已切换，请重新选择附件。');
          return;
        }
        setAttachment(result.attachment);
        setMessage('附件已就绪，可以发送。');
      } else if (result.message === '已取消选择附件。') {
        if (conversationIdAtPick === activeConversationRef.current)
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
    text,
    setText,
    pendingAttachment,
    attachmentBusy,
    pickAttachment,
    clearAttachment: () => setAttachment(null),
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
