import type {
  AssistantMessage,
  ChatMessage,
  InitialChatMessageDTO,
  StudentMessage,
} from './messages';
import type { TeachingTurnState } from './turn-state';

export function hydrateChatMessages(
  initialMessages: readonly InitialChatMessageDTO[],
): readonly ChatMessage[] {
  const studentInputByTurn = new Map(
    initialMessages
      .filter((message) => message.role === 'student')
      .map((message) => [
        message.turnId,
        { content: message.content, parts: message.parts ?? [] },
      ]),
  );

  return initialMessages.map((message): ChatMessage => {
    if (message.role === 'student') {
      const attachments = (message.parts ?? []).flatMap((part) =>
        part.type === 'asset_ref' && part.usage === 'attachment'
          ? [
              {
                id: `${part.reference.assetId}:${part.reference.versionId}`,
                label: part.reference.kind === 'image' ? '图片附件' : 'PDF资料',
                kind: part.reference.kind === 'image' ? 'image' : 'document',
              } as const,
            ]
          : [],
      );
      return {
        id: message.id,
        turnId: message.turnId,
        clientMessageId: message.clientMessageId,
        role: 'student',
        status: 'completed',
        text: message.content,
        attachments,
      };
    }
    return {
      id: message.id,
      turnId: message.turnId,
      clientMessageId: message.clientMessageId,
      role: 'assistant',
      status: message.status,
      text: message.content,
      attachments: [],
      citations: message.citations ?? [],
      artifacts: message.artifacts ?? [],
      failureCode: message.failureCode,
      retryText: studentInputByTurn.get(message.turnId)?.content,
      retryParts: studentInputByTurn.get(message.turnId)?.parts,
      retryable:
        message.status === 'failed' || message.status === 'interrupted',
    };
  });
}

export function createTeachingTurnState(
  initialMessages: readonly InitialChatMessageDTO[],
  assistantLabel = 'AI 老师',
  resumeStreaming = false,
): TeachingTurnState {
  const messages = hydrateChatMessages(initialMessages);
  const streamingAssistant = [...messages]
    .reverse()
    .find(
      (message): message is AssistantMessage =>
        message.role === 'assistant' && message.status === 'streaming',
    );
  const matchingStudent = streamingAssistant
    ? messages.find(
        (message): message is StudentMessage =>
          message.role === 'student' &&
          message.turnId === streamingAssistant.turnId,
      )
    : undefined;

  return {
    messages,
    active:
      resumeStreaming && streamingAssistant
        ? {
            clientMessageId: streamingAssistant.clientMessageId,
            text: matchingStudent?.text ?? streamingAssistant.retryText ?? '',
            localStudentId:
              matchingStudent?.id ??
              `persisted-student:${streamingAssistant.turnId}`,
            localAssistantId: streamingAssistant.id,
            turnId: streamingAssistant.turnId,
            assistantMessageId: streamingAssistant.id,
            status: 'streaming',
            assistantLabel,
          }
        : null,
    activeToolLabel: null,
    announcement: null,
    announcementSequence: 0,
  };
}
