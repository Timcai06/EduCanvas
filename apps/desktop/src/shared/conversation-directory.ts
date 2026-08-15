import type {
  GatewayConversationCreateRequest,
  GatewayConversationDirectoryEntry,
} from '@educanvas/gateway-core';

export interface DesktopConversationDirectorySnapshot {
  readonly revision: number;
  readonly loading: boolean;
  readonly conversations: readonly GatewayConversationDirectoryEntry[];
  readonly currentConversationId: string | null;
  readonly error: string | null;
}

export type DesktopConversationCreateInput = GatewayConversationCreateRequest;
