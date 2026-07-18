import type {
  AssistantMessage,
  ChatMessage,
  ChatMessageStatus,
  InitialChatMessageDTO,
  StudentMessage,
} from './messages';
import type { AgentAssetPart, AgentMessagePart } from '@educanvas/agent-core';
import type { TeachingTurnEvent } from './turn-events';

export interface ActiveTeachingTurn {
  clientMessageId: string;
  text: string;
  localStudentId: string;
  localAssistantId: string;
  turnId: string | null;
  assistantMessageId: string | null;
  status: 'pending' | 'streaming';
  assistantLabel: string;
}

export interface TurnAnnouncement {
  id: number;
  text: string;
}

export interface TeachingTurnState {
  messages: readonly ChatMessage[];
  active: ActiveTeachingTurn | null;
  activeToolLabel: string | null;
  announcement: TurnAnnouncement | null;
  announcementSequence: number;
}

export type TeachingTurnAction =
  | {
      type: 'send.started';
      clientMessageId: string;
      text: string;
      parts?: readonly AgentMessagePart[];
      attachments?: readonly {
        id: string;
        label: string;
        kind: 'image' | 'document';
      }[];
      assistantLabel?: string;
    }
  | { type: 'stream.event'; event: TeachingTurnEvent }
  | {
      type: 'stream.failed';
      status: Extract<ChatMessageStatus, 'failed' | 'interrupted'>;
      code: string;
      message: string;
      retryable: boolean;
    }
  | { type: 'stop.confirmed' };

function announce(
  state: TeachingTurnState,
  text: string,
): Pick<TeachingTurnState, 'announcement' | 'announcementSequence'> {
  const nextSequence = state.announcementSequence + 1;
  return {
    announcement: { id: nextSequence, text },
    announcementSequence: nextSequence,
  };
}

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
        part.type === 'asset_ref'
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
): TeachingTurnState {
  return {
    messages: hydrateChatMessages(initialMessages),
    active: null,
    activeToolLabel: null,
    announcement: null,
    announcementSequence: 0,
  };
}

/** 从失败消息恢复服务端可验证的附件引用，不重建浏览器临时上传对象。 */
export function getRetryAssetParts(
  message: AssistantMessage,
): readonly AgentAssetPart[] {
  return (message.retryParts ?? []).filter(
    (part): part is AgentAssetPart => part.type === 'asset_ref',
  );
}

function updateAssistant(
  messages: readonly ChatMessage[],
  id: string,
  update: (message: AssistantMessage) => AssistantMessage,
): readonly ChatMessage[] {
  return messages.map((message) =>
    message.role === 'assistant' && message.id === id
      ? update(message)
      : message,
  );
}

function eventMatchesActive(
  event: TeachingTurnEvent,
  active: ActiveTeachingTurn,
): boolean {
  if (event.type === 'turn.accepted') {
    return active.turnId === null || active.turnId === event.turnId;
  }
  return active.turnId === event.turnId;
}

export function teachingTurnReducer(
  state: TeachingTurnState,
  action: TeachingTurnAction,
): TeachingTurnState {
  if (action.type === 'send.started') {
    if (state.active) return state;
    const assistantLabel = action.assistantLabel ?? 'AI 老师';
    const localStudentId = `local-student:${action.clientMessageId}`;
    const localAssistantId = `local-assistant:${action.clientMessageId}`;
    const student: StudentMessage = {
      id: localStudentId,
      turnId: `local-turn:${action.clientMessageId}`,
      clientMessageId: action.clientMessageId,
      role: 'student',
      status: 'completed',
      text: action.text,
      attachments: action.attachments ?? [],
    };
    const assistant: AssistantMessage = {
      id: localAssistantId,
      turnId: `local-turn:${action.clientMessageId}`,
      clientMessageId: action.clientMessageId,
      role: 'assistant',
      status: 'pending',
      text: '',
      attachments: [],
      citations: [],
      retryText: action.text,
      retryParts: action.parts ?? [],
    };
    return {
      ...state,
      messages: [...state.messages, student, assistant],
      active: {
        clientMessageId: action.clientMessageId,
        text: action.text,
        localStudentId,
        localAssistantId,
        turnId: null,
        assistantMessageId: null,
        status: 'pending',
        assistantLabel,
      },
      activeToolLabel: null,
      ...announce(state, `${assistantLabel}开始回答`),
    };
  }

  const active = state.active;
  if (!active) return state;

  if (action.type === 'stop.confirmed') {
    return {
      ...state,
      messages: updateAssistant(
        state.messages,
        active.assistantMessageId ?? active.localAssistantId,
        (message) => ({ ...message, status: 'cancelled' }),
      ),
      active: null,
      activeToolLabel: null,
      announcement: null,
    };
  }

  if (action.type === 'stream.failed') {
    return {
      ...state,
      messages: updateAssistant(
        state.messages,
        active.assistantMessageId ?? active.localAssistantId,
        (message) => ({
          ...message,
          status: action.status,
          failureCode: action.code,
          failureMessage: action.message,
          retryable: action.retryable,
        }),
      ),
      active: null,
      activeToolLabel: null,
      ...announce(state, `${active.assistantLabel}回答失败`),
    };
  }

  const event = action.event;
  if (!eventMatchesActive(event, active)) return state;

  if (event.type === 'turn.accepted') {
    return {
      ...state,
      messages: state.messages.map((message) => {
        if (message.id === active.localStudentId) {
          return {
            ...message,
            id: event.studentMessageId,
            turnId: event.turnId,
          };
        }
        if (message.id === active.localAssistantId) {
          return {
            ...message,
            id: event.assistantMessageId,
            turnId: event.turnId,
          };
        }
        return message;
      }),
      active: {
        ...active,
        turnId: event.turnId,
        assistantMessageId: event.assistantMessageId,
      },
    };
  }

  if (
    event.type === 'tool.started' ||
    event.type === 'tool.completed' ||
    event.type === 'tool.failed'
  ) {
    return {
      ...state,
      activeToolLabel:
        event.type === 'tool.started'
          ? (event.label ?? '正在使用学习工具')
          : null,
    };
  }

  if (!('messageId' in event)) return state;
  const assistantId = active.assistantMessageId ?? active.localAssistantId;
  if (event.type === 'message.citation') {
    if (event.messageId !== assistantId) return state;
    return {
      ...state,
      messages: updateAssistant(state.messages, assistantId, (message) => ({
        ...message,
        citations: [
          ...(message.citations ?? []).filter(
            (citation) => citation.id !== event.citationId,
          ),
          {
            id: event.citationId,
            ...(event.marker === undefined ? {} : { marker: event.marker }),
            sourceId: event.sourceId,
            documentId: event.documentId,
            chunkId: event.chunkId,
            label: event.label,
            pageStart: event.pageStart,
            pageEnd: event.pageEnd,
          },
        ],
      })),
    };
  }
  if (event.type === 'message.delta') {
    if (event.messageId !== assistantId) return state;
    return {
      ...state,
      messages: updateAssistant(state.messages, assistantId, (message) => ({
        ...message,
        status: 'streaming',
        text: message.text + event.delta,
      })),
      active: { ...active, status: 'streaming' },
      activeToolLabel: null,
    };
  }

  if (event.messageId !== assistantId) return state;
  if (event.type === 'turn.completed') {
    return {
      ...state,
      messages: updateAssistant(state.messages, assistantId, (message) => ({
        ...message,
        status: 'completed',
      })),
      active: null,
      activeToolLabel: null,
      ...announce(state, `${active.assistantLabel}回答完成`),
    };
  }
  if (event.type === 'turn.cancelled') {
    return {
      ...state,
      messages: updateAssistant(state.messages, assistantId, (message) => ({
        ...message,
        status: 'cancelled',
      })),
      active: null,
      activeToolLabel: null,
      announcement: null,
    };
  }

  const status = event.code === 'interrupted' ? 'interrupted' : 'failed';
  return {
    ...state,
    messages: updateAssistant(state.messages, assistantId, (message) => ({
      ...message,
      status,
      failureCode: event.code,
      failureMessage: event.message,
      retryable: event.retryable,
    })),
    active: null,
    activeToolLabel: null,
    ...announce(
      state,
      event.code.startsWith('k12_')
        ? event.message
        : `${active.assistantLabel}回答失败`,
    ),
  };
}
