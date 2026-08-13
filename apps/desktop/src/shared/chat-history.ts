export type DesktopChatRole = 'user' | 'assistant' | 'system';
export type DesktopChatSource = 'text' | 'voice';

export interface DesktopChatMessage {
  id: string;
  role: DesktopChatRole;
  content: string;
  source: DesktopChatSource;
  createdAt: string;
}

export interface DesktopChatMessageInput {
  role: DesktopChatRole;
  content: string;
  source: DesktopChatSource;
}

export interface DesktopChatHistorySnapshot {
  revision: number;
  messages: readonly DesktopChatMessage[];
}
