import type { ToolKernelAdapter } from '@educanvas/agent-runtime';

export type McpLifecycleStatus = 'disabled' | 'idle' | 'ready' | 'degraded';

export interface McpServerStatus {
  serverId: string;
  status: McpLifecycleStatus;
  failureCode: 'configuration' | 'credential' | 'transport' | 'protocol' | null;
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
  risk: 'l0' | 'l1';
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
}

export interface McpRuntimeOptions {
  credentialBroker?: McpCredentialBrokerPort;
  client?: McpClientPort;
  now?: () => Date;
}
