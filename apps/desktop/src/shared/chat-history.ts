export type DesktopChatRole = 'user' | 'assistant' | 'system';
export type DesktopChatSource = 'text' | 'voice';
export type DesktopChatMessageStatus =
  | 'pending'
  | 'streaming'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted';

/**
 * 可删除、可从服务端 canonical Message 重建的 View Cache 投影。
 * - `id`：服务端 canonical messageId（已知时）；乐观消息在服务端事实到达前使用本地 id。
 * - `clientMessageId`：一次 Turn 的稳定请求身份，用于乐观 User Message 与服务端事实去重。
 */
export interface DesktopChatMessage {
  id: string;
  clientMessageId: string | null;
  role: DesktopChatRole;
  content: string;
  source: DesktopChatSource;
  status: DesktopChatMessageStatus;
  createdAt: string;
}

export interface DesktopChatMessageInput {
  role: DesktopChatRole;
  content: string;
  source: DesktopChatSource;
  clientMessageId?: string;
  status?: DesktopChatMessageStatus;
}

export interface DesktopChatHistorySnapshot {
  revision: number;
  conversationId: string | null;
  messages: readonly DesktopChatMessage[];
  hasMore: boolean;
  /** 服务端分页游标；指向当前窗口最旧一条更早的页，用于「向上加载更早页」。 */
  nextCursor: string | null;
  loading: boolean;
}

/** 服务端 canonical Message 的历史投影（与 gateway 契约对齐）。 */
export interface DesktopCanonicalMessage {
  messageId: string;
  clientMessageId: string;
  role: 'user' | 'assistant';
  status: DesktopChatMessageStatus;
  content: string;
  createdAt: string;
}
