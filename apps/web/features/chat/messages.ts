import type { AgentMessagePart } from '@educanvas/agent-core';

export type ChatMessageStatus =
  | 'pending'
  | 'streaming'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted';

/** 对话末尾的 Artifact 只保存可重新打开所需的服务端事实，不复制 Canvas 内容。 */
export interface MessageArtifactDTO {
  id: string;
  kind: string;
  title: string;
  status: 'proposed' | 'active' | 'archived' | 'failed';
  latestVersion: number;
}

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
  artifacts?: readonly MessageArtifactDTO[];
  citations?: readonly MessageCitationDTO[];
  failureCode: string | null;
  createdAt: string;
  completedAt: string | null;
}

interface MessageCitationBase {
  id: string;
  /** 正文 [n] 标记号,来自服务端持久化的 ordinal;历史消息恒有,SSE 旧流可缺省 */
  marker?: number;
  label: string;
  pageStart: number | null;
  pageEnd: number | null;
}

export interface KnowledgeMessageCitationDTO extends MessageCitationBase {
  /** 旧 schemaVersion=1 事件缺省 kind 时按 knowledge 解析。 */
  kind?: 'knowledge';
  sourceId: string;
  documentId: string;
  chunkId: string;
}

export interface WebMessageCitationDTO extends MessageCitationBase {
  kind: 'web';
  assetId: string;
  assetVersionId: string;
  /** 仅允许服务端验证过的公开 http(s) 原文定位。 */
  url: string;
}

export type MessageCitationDTO =
  KnowledgeMessageCitationDTO | WebMessageCitationDTO;

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
/**
 * 一次工具调用在界面上的痕迹。
 *
 * `label` 只来自服务端映射表，模型碰不到它，所以这里不可能显示内部标识或
 * 被模型影响的文字。参数与返回值一律不进入这个结构——判分类工具的返回值直接
 * 包含答案（docs/01-product/02-学生界面规范.md）。
 */
export interface MessageToolStep {
  id: string;
  label: string;
  status: 'running' | 'completed' | 'failed';
}

export interface AssistantMessage extends ChatMessageBase {
  role: 'assistant';
  /** 按到达顺序保留本轮全部工具调用；完成后不清空，用于回看这轮做了什么。 */
  toolSteps?: readonly MessageToolStep[];
  failureCode?: string | null;
  failureMessage?: string;
  retryable?: boolean;
  retryText?: string;
  retryParts?: readonly AgentMessagePart[];
  cite?: string;
  citations?: readonly MessageCitationDTO[];
  artifacts?: readonly MessageArtifactDTO[];
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
