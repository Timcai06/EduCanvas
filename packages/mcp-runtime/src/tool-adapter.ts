import type { ToolKernelAdapter } from '@educanvas/agent-runtime';
import type { McpClientPort, McpToolRegistration } from './contracts';
import {
  prepareMcpApproval,
  type McpApprovalPreparationDependencies,
} from './approval-preparation';
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
  approval?: McpApprovalPreparationDependencies,
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
    ...((registration.risk === 'l2' || registration.risk === 'l3') && approval
      ? {
          prepareApproval: async (
            argumentsValue: Readonly<Record<string, unknown>>,
            context: Parameters<
              NonNullable<ToolKernelAdapter['prepareApproval']>
            >[1],
          ) =>
            prepareMcpApproval({
              registration: registration as McpToolRegistration & {
                capability: 'external.mcp.invoke';
                risk: 'l2' | 'l3';
                effect: 'write';
              },
              arguments: argumentsValue,
              context,
              dependencies: approval,
            }),
        }
      : {}),
    async invoke(argumentsValue, context) {
      if (registration.risk === 'l2' || registration.risk === 'l3') {
        throw new McpInvocationError('durability');
      }
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
