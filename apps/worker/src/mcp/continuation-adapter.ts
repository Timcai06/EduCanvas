import { createHash } from 'node:crypto';
import {
  DrizzleAgentToolCallRepository,
  DrizzleMcpIntentRepository,
  DrizzlePlatformTurnRepository,
  DrizzleToolEffectRepository,
} from '@educanvas/db';
import {
  AesGcmMcpIntentCipher,
  DenyMcpCredentialBroker,
  LifecycleMcpClient,
  McpStatusRegistry,
  sanitizeMcpToolResult,
  type McpClientPort,
  type McpIntentMetadata,
  type McpToolRegistration,
} from '@educanvas/mcp-runtime';
import type { OperationContinuationResumeAdapter } from '../tasks/continue-operation';
import {
  completeRecoveredMcpDispatch,
  reconcileMcpDispatch,
  type McpContinuationRepositories,
} from './dispatch-reconciliation';

function findRegistration(
  registrations: readonly McpToolRegistration[],
  intent: Awaited<ReturnType<DrizzleMcpIntentRepository['getForResume']>>,
): McpToolRegistration | null {
  return (
    registrations.find(
      (item) =>
        item.serverId === intent.serverId &&
        item.remoteToolName === intent.remoteToolName &&
        item.modelToolName === intent.modelToolName &&
        item.capability === intent.capability &&
        item.risk === intent.risk &&
        item.effect === 'write',
    ) ?? null
  );
}

function receiptHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function intentMetadata(
  intent: Awaited<ReturnType<DrizzleMcpIntentRepository['getForResume']>>,
): McpIntentMetadata {
  return {
    resumeRef: intent.resumeRef,
    operationId: intent.operationId,
    toolCallId: intent.toolCallId,
    actorId: intent.actorId,
    agentId: intent.agentId,
    serverId: intent.serverId,
    remoteToolName: intent.remoteToolName,
    modelToolName: intent.modelToolName,
    capability: intent.capability,
    risk: intent.risk,
    effect: intent.effect,
    semanticsHash: intent.semanticsHash,
    expiresAt: intent.expiresAt,
  };
}

/** MCP v1没有标准幂等查询；dispatching重领一律收敛为outcome_unknown而不重放外呼。 */
export function createMcpContinuationAdapter(input: {
  registrations: readonly McpToolRegistration[];
  encryptionKey: string;
  client?: McpClientPort;
  repositories?: McpContinuationRepositories;
  now?: () => Date;
}): OperationContinuationResumeAdapter {
  const registrations = input.registrations.filter(
    (item) =>
      (item.risk === 'l2' || item.risk === 'l3') &&
      item.effect === 'write' &&
      item.authentication === 'none',
  );
  const capabilities = [
    ...new Set(registrations.map((item) => item.capability)),
  ];
  const intents =
    input.repositories?.intents ?? new DrizzleMcpIntentRepository();
  const calls =
    input.repositories?.calls ?? new DrizzleAgentToolCallRepository();
  const effects =
    input.repositories?.effects ?? new DrizzleToolEffectRepository();
  const turns =
    input.repositories?.turns ?? new DrizzlePlatformTurnRepository();
  const repositories: McpContinuationRepositories = {
    intents,
    calls,
    effects,
    turns,
  };
  const cipher = AesGcmMcpIntentCipher.fromBase64(input.encryptionKey);
  const client =
    input.client ??
    new LifecycleMcpClient(
      new DenyMcpCredentialBroker(),
      new McpStatusRegistry(),
    );
  const now = input.now ?? (() => new Date());

  return {
    source: 'mcp',
    capabilities,
    async resume(resume) {
      const common = {
        operationId: resume.scope.operationId,
        actorId: resume.scope.actorId,
      };
      const intent = await intents.getForResume({
        resumeRef: resume.continuation.work.resumeRef,
        operationId: resume.scope.operationId,
        toolCallId: resume.continuation.work.toolCallId,
        actorId: resume.scope.actorId,
        agentId: resume.scope.agentId,
        capability: resume.scope.capability,
      });
      if (intent.status === 'completed') {
        return completeRecoveredMcpDispatch({
          resume,
          repositories,
          modelToolName: intent.modelToolName,
        });
      }
      if (intent.status === 'dispatching') {
        return reconcileMcpDispatch({
          resume,
          repositories,
          modelToolName: intent.modelToolName,
        });
      }
      if (intent.status !== 'prepared' || !intent.sealedPayload) {
        return {
          status: 'failed',
          continuationFailureCode: 'mcp_intent_unavailable',
          operationFailureCode: 'RUNTIME_FAILED',
          retryable: false,
        };
      }
      const payload = cipher.open({
        metadata: intentMetadata(intent),
        sealedPayload: intent.sealedPayload,
      });
      const registration = findRegistration(registrations, intent);
      const valid =
        registration &&
        new Date(intent.expiresAt) > now() &&
        cipher.semanticsHash({
          registration: registration as McpToolRegistration & {
            risk: 'l2' | 'l3';
            effect: 'write';
          },
          arguments: payload.arguments,
        }) === intent.semanticsHash;
      await calls.markRunning({
        ...common,
        toolCallId: resume.continuation.work.toolCallId,
      });
      const effect = await effects.intend({
        ...common,
        toolCallId: resume.continuation.work.toolCallId,
        effectKey: intent.resumeRef,
        semanticsHash: intent.semanticsHash,
      });
      if (!valid || !registration) {
        await effects.settle({
          ...common,
          effectId: effect.effect.id,
          status: 'failed',
          code: 'mcp_intent_validation_failed',
        });
        await calls.settle({
          ...common,
          toolCallId: resume.continuation.work.toolCallId,
          status: 'failed',
          code: 'mcp_intent_validation_failed',
          retryable: false,
          durationMs: 0,
        });
        await intents.settle({
          resumeRef: intent.resumeRef,
          ...common,
          status: 'failed',
        });
        return {
          status: 'failed',
          continuationFailureCode: 'mcp_intent_validation_failed',
          operationFailureCode: 'FORBIDDEN',
          retryable: false,
        };
      }
      await intents.markDispatching({ resumeRef: intent.resumeRef, ...common });
      try {
        const output = sanitizeMcpToolResult(
          await client.callTool({
            registration,
            arguments: payload.arguments,
            scope: {
              actorId: resume.scope.actorId,
              agentId: resume.scope.agentId,
              credentialHandle: payload.credentialHandle,
              signal: resume.signal,
            },
          }),
        );
        await effects.settle({
          ...common,
          effectId: effect.effect.id,
          status: 'committed',
          receiptHash: receiptHash(output),
        });
        await calls.settle({
          ...common,
          toolCallId: resume.continuation.work.toolCallId,
          status: 'succeeded',
          durationMs: 0,
          result: output,
        });
        await intents.settle({
          resumeRef: intent.resumeRef,
          ...common,
          status: 'completed',
        });
        const settled = await turns.settleTurn({
          conversationId: resume.scope.conversationId,
          trustedSubjectId: resume.scope.actorId,
          turnId: resume.scope.operationId,
          status: 'completed',
          content: `已完成已批准的外部工具操作：${intent.modelToolName}。`,
          operationTerminalWriter: 'gateway',
        });
        return { status: 'completed', messageId: settled.assistantMessage.id };
      } catch {
        return reconcileMcpDispatch({
          resume,
          repositories,
          modelToolName: intent.modelToolName,
        });
      }
    },
  };
}
