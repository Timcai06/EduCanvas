import type { OutputPreference } from '@educanvas/agent-core';
import type { GatewayOperationEventExtension } from '@educanvas/gateway-core';

export interface AgentTurnClientOptions {
  endpoint: string;
  assistantLabel: string;
  cancelEndpoint?: (turnId: string) => string;
  eventsEndpoint?: (turnId: string) => string;
  eventExtensions?: readonly GatewayOperationEventExtension[];
}

export interface AgentTurnSendOptions {
  /** Non-authoritative display intent. The server independently grants tools. */
  outputPreference?: OutputPreference;
  mode?: 'chat' | 'deep_research';
  artifactConfirmationId?: string;
}
