import { createHash } from 'node:crypto';
import type { ToolAdapterInvocationContext } from '@educanvas/agent-runtime';
import type {
  McpDurableIntentStorePort,
  McpIntentCipherPort,
  McpIntentMetadata,
  McpRuntimeOptions,
  McpToolRegistration,
} from './contracts';

export interface McpApprovalPreparationDependencies {
  durableIntents: McpDurableIntentStorePort;
  approvalIntents: NonNullable<McpRuntimeOptions['approvalIntents']>;
  cipher: McpIntentCipherPort;
  now: () => Date;
}

function stableReference(prefix: string, parts: readonly string[]): string {
  const digest = createHash('sha256')
    .update(parts.join('\u0000'))
    .digest('hex');
  return `${prefix}:${digest}`;
}

/** 高风险MCP只准备密文意图与公共稳定引用；本函数不发起任何外部调用。 */
export async function prepareMcpApproval(input: {
  registration: McpToolRegistration & {
    capability: 'external.mcp.invoke';
    risk: 'l2' | 'l3';
    effect: 'write';
  };
  arguments: Readonly<Record<string, unknown>>;
  context: ToolAdapterInvocationContext & { toolCallId: string };
  dependencies: McpApprovalPreparationDependencies;
}) {
  const { registration, context, dependencies } = input;
  const referenceParts = [
    context.operationId,
    context.toolCallId,
    registration.serverId,
    registration.remoteToolName,
  ];
  const resumeRef = stableReference('mcp.intent', referenceParts);
  const approvalId = stableReference('mcp.approval', referenceParts);
  const expiresAt = new Date(
    dependencies.now().getTime() + 15 * 60_000,
  ).toISOString();
  const metadata: McpIntentMetadata = {
    resumeRef,
    operationId: context.operationId,
    toolCallId: context.toolCallId,
    actorId: context.actorId,
    agentId: context.agentId,
    serverId: registration.serverId,
    remoteToolName: registration.remoteToolName,
    modelToolName: registration.modelToolName,
    capability: registration.capability,
    risk: registration.risk,
    effect: 'write',
    semanticsHash: dependencies.cipher.semanticsHash({
      registration,
      arguments: input.arguments,
    }),
    expiresAt,
  };
  const sealedPayload = dependencies.cipher.seal({
    metadata,
    payload: {
      arguments: input.arguments,
      credentialHandle: context.credentialHandle,
    },
  });
  await dependencies.durableIntents.prepare({ metadata, sealedPayload });
  await dependencies.approvalIntents.prepare({
    operationId: context.operationId,
    actorId: context.actorId,
    approvalId,
    expiresAt,
    work: {
      kind: 'tool_invocation',
      step: 'tool.invoke',
      toolCallId: context.toolCallId,
      adapterSource: 'mcp',
      resumeRef,
    },
  });
  return {
    approvalId,
    summary: `允许调用外部工具 ${registration.modelToolName}`,
    expiresAt,
  };
}
