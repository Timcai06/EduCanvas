import type { AgentMessagePart } from '@educanvas/agent-core';

export type ChatMessageStatus =
  | 'pending'
  | 'streaming'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted';

/**
 * Server Component hydrates the browser with this provider-neutral projection.
 * It intentionally contains no provider/model identifiers, prompts or internal
 * lease state.
 */
export interface InitialChatMessageDTO {
  id: string;
  turnId: string;
  clientMessageId: string;
  role: 'student' | 'assistant';
  status: ChatMessageStatus;
  content: string;
  parts?: readonly AgentMessagePart[];
  citations?: readonly MessageCitationDTO[];
  failureCode: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface MessageCitationDTO {
  id: string;
  sourceId: string;
  documentId: string;
  chunkId: string;
  label: string;
  pageStart: number | null;
  pageEnd: number | null;
}

interface ChatMessageBase {
  id: string;
  turnId: string;
  clientMessageId: string;
  status: ChatMessageStatus;
  text: string;
  attachments: readonly {
    id: string;
    label: string;
    kind: 'image' | 'document';
  }[];
}

/** A student message is complete as soon as its turn is accepted locally. */
export interface StudentMessage extends ChatMessageBase {
  role: 'student';
  status: 'completed';
}

/**
 * Assistant UI state. Optional rich fields are public product data; they must
 * come from a future versioned citation/artifact event, never browser inference.
 */
export interface AssistantMessage extends ChatMessageBase {
  role: 'assistant';
  failureCode?: string | null;
  failureMessage?: string;
  retryable?: boolean;
  retryText?: string;
  retryParts?: readonly AgentMessagePart[];
  cite?: string;
  citations?: readonly MessageCitationDTO[];
  suggestsCanvas?: boolean;
  outputCard?: boolean;
}

export type ChatMessage = StudentMessage | AssistantMessage;

/** Legacy shape isolated to the explicit test-only teacher script. */
export interface TeacherMessage {
  id: string;
  role: 'teacher';
  text: string;
  cite?: string;
  suggestsCanvas?: boolean;
  outputCard?: boolean;
}
