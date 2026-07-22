import type { ToolKernelAdapter } from '@educanvas/agent-runtime';
import type { McpClientPort, McpToolRegistration } from './contracts';
import { McpInvocationError, McpRemoteToolError } from './errors';
import {
  mcpSafeToolOutputSchema,
  sanitizeMcpToolResult,
  type McpSafeToolOutput,
} from './output-sanitizer';
import { createMcpArgumentSchema } from './schema-validation';
import { McpStatusRegistry } from './status-registry';

/** 服务端可信注册被适配到唯一Tool Kernel；远端annotations完全不参与策略。 */
export function createMcpToolAdapters(
  registrations: readonly McpToolRegistration[],
  client: McpClientPort,
  statuses: McpStatusRegistry,
): readonly ToolKernelAdapter<
  Readonly<Record<string, unknown>>,
  McpSafeToolOutput
>[] {
  return registrations.map((registration) => ({
    name: registration.modelToolName,
    description: registration.description,
    source: 'mcp',
    capability: registration.capability,
    risk: registration.risk,
    exposure: 'model',
    effect: registration.effect,
    timeoutMs: registration.timeoutMs,
    inputSchema: createMcpArgumentSchema(registration.inputSchema),
    modelInputSchema: registration.inputSchema,
    outputSchema: mcpSafeToolOutputSchema,
    async invoke(argumentsValue, context) {
      try {
        const result = await client.callTool({
          registration,
          arguments: argumentsValue,
          scope: {
            actorId: context.actorId,
            agentId: context.agentId,
            credentialHandle: context.credentialHandle,
            signal: context.signal,
          },
        });
        return sanitizeMcpToolResult(result);
      } catch (error) {
        if (error instanceof McpRemoteToolError) throw error;
        if (!(error instanceof McpInvocationError)) {
          statuses.set(registration.serverId, 'degraded', 'protocol');
        }
        throw new McpInvocationError(
          error instanceof McpInvocationError ? error.failureCode : 'protocol',
        );
      }
    },
  }));
}
