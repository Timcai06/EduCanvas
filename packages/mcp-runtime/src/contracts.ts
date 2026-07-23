import type { ToolKernelAdapter } from '@educanvas/agent-runtime';
import type { ToolApprovalIntentPort } from '@educanvas/agent-core';

export type McpLifecycleStatus = 'disabled' | 'idle' | 'ready' | 'degraded';

export interface McpServerStatus {
  serverId: string;
  status: McpLifecycleStatus;
  failureCode:
    | 'configuration'
    | 'credential'
    | 'durability'
    | 'transport'
    | 'protocol'
    | null;
  updatedAt: string;
}

export interface McpCredentialScope {
  actorId: string;
  agentId: string;
  serverId: string;
  credentialHandle: string;
  signal: AbortSignal;
}

/** Credential Broker只返回短生命周期请求头；实现不得把值写入日志、模型或账本。 */
export interface McpCredentialBrokerPort {
  resolveAuthorization(
    scope: McpCredentialScope,
  ): Promise<{ authorization: string } | null>;
}

export interface McpToolRegistration {
  serverId: string;
  endpoint: string;
  remoteToolName: string;
  modelToolName: string;
  description: string;
  capability: string;
  risk: 'l0' | 'l1' | 'l2' | 'l3';
  effect: 'read' | 'write';
  authentication: 'none' | 'bearer';
  inputSchema: Readonly<Record<string, unknown>>;
  timeoutMs: number;
}

export interface McpCallScope {
  actorId: string;
  agentId: string;
  credentialHandle: string | null;
  signal: AbortSignal;
}

export interface McpClientPort {
  callTool(input: {
    registration: McpToolRegistration;
    arguments: Readonly<Record<string, unknown>>;
    scope: McpCallScope;
  }): Promise<unknown>;
}

export interface McpRuntime {
  adapters: readonly ToolKernelAdapter[];
  capabilities: readonly string[];
  statuses(): readonly McpServerStatus[];
}

export interface McpRuntimeEnvironment {
  EDUCANVAS_DEPLOYMENT_ENV?: string;
  EDUCANVAS_MCP_TOOLS_JSON?: string;
  EDUCANVAS_MCP_INTENT_ENCRYPTION_KEY?: string;
}

export interface McpIntentMetadata {
  resumeRef: string;
  operationId: string;
  toolCallId: string;
  actorId: string;
  agentId: string;
  serverId: string;
  remoteToolName: string;
  modelToolName: string;
  capability: 'external.mcp.invoke';
  risk: 'l2' | 'l3';
  effect: 'write';
  semanticsHash: string;
  expiresAt: string;
}

export interface McpSealedIntentPayload {
  keyVersion: 'v1';
  nonce: string;
  ciphertext: string;
  authTag: string;
  payloadHash: string;
}

export interface McpDurableIntentSnapshot extends McpIntentMetadata {
  status:
    'prepared' | 'dispatching' | 'completed' | 'failed' | 'outcome_unknown';
  sealedPayload: McpSealedIntentPayload | null;
  preparedAt: string;
  dispatchStartedAt: string | null;
  settledAt: string | null;
}

/** Adapter仓储只接收密文；参数与Credential Handle不得以明文越过此端口。 */
export interface McpDurableIntentStorePort {
  prepare(input: {
    metadata: McpIntentMetadata;
    sealedPayload: McpSealedIntentPayload;
  }): Promise<{ intent: McpDurableIntentSnapshot; replayed: boolean }>;
  getForResume(input: {
    resumeRef: string;
    operationId: string;
    toolCallId: string;
    actorId: string;
    agentId: string;
    capability: string;
  }): Promise<McpDurableIntentSnapshot>;
  markDispatching(input: {
    resumeRef: string;
    operationId: string;
    actorId: string;
  }): Promise<{ intent: McpDurableIntentSnapshot; transitioned: boolean }>;
  settle(input: {
    resumeRef: string;
    operationId: string;
    actorId: string;
    status: 'completed' | 'failed' | 'outcome_unknown';
  }): Promise<{ intent: McpDurableIntentSnapshot; transitioned: boolean }>;
}

export interface McpIntentCipherPort {
  semanticsHash(input: {
    registration: McpToolRegistration;
    arguments: Readonly<Record<string, unknown>>;
  }): string;
  seal(input: {
    metadata: McpIntentMetadata;
    payload: {
      arguments: Readonly<Record<string, unknown>>;
      credentialHandle: string | null;
    };
  }): McpSealedIntentPayload;
  open(input: {
    metadata: McpIntentMetadata;
    sealedPayload: McpSealedIntentPayload;
  }): {
    arguments: Readonly<Record<string, unknown>>;
    credentialHandle: string | null;
  };
}

export interface McpRuntimeOptions {
  credentialBroker?: McpCredentialBrokerPort;
  client?: McpClientPort;
  durableIntents?: McpDurableIntentStorePort;
  approvalIntents?: ToolApprovalIntentPort;
  intentCipher?: McpIntentCipherPort;
  now?: () => Date;
}
