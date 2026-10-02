import type { conversations, conversationMessages } from './schema';

export interface PlatformConversationSnapshot {
  id: string;
  spaceId: string;
  ownerSubjectId: string;
  agentProfileId: string;
  title: string | null;
  status: 'active' | 'archived';
  lastActivityAt: string;
}

export interface PlatformMessageSnapshot {
  id: string;
  conversationId: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  status:
    | 'pending'
    | 'streaming'
    | 'completed'
    | 'failed'
    | 'cancelled'
    | 'interrupted';
  content: string;
  createdAt: string;
  completedAt: string | null;
}

export function toConversation(
  row: typeof conversations.$inferSelect,
): PlatformConversationSnapshot {
  return {
    id: row.id,
    spaceId: row.spaceId,
    ownerSubjectId: row.ownerSubjectId,
    agentProfileId: row.agentProfileId,
    title: row.title,
    status: row.status as PlatformConversationSnapshot['status'],
    lastActivityAt: row.lastActivityAt.toISOString(),
  };
}

export function toMessage(
  row: typeof conversationMessages.$inferSelect,
): PlatformMessageSnapshot {
  return {
    id: row.id,
    conversationId: row.conversationId,
    role: row.role as PlatformMessageSnapshot['role'],
    status: row.status as PlatformMessageSnapshot['status'],
    content: row.content,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}
