import type {
  AgentMessagePart,
  AgentModelRunLedgerPort,
  AgentToolCallLedgerPort,
  AgentTurnContextLedgerPort,
  ModelAbortSignal,
  TurnApplicationCommand,
  TurnModelGateway,
  ToolEffectLedgerPort,
} from '@educanvas/agent-core';
import {
  ToolKernel,
  TurnApplicationService,
  type TurnApplicationPort,
} from '@educanvas/agent-runtime';
import {
  DrizzleAgentModelRunRepository,
  DrizzleAgentToolCallRepository,
  DrizzleAgentTurnContextRepository,
  DrizzleGatewayNodeRepository,
  DrizzleMcpIntentRepository,
  DrizzlePlatformTurnRepository,
  DrizzleToolApprovalIntentRepository,
  DrizzleToolEffectRepository,
} from '@educanvas/db';
import type { GatewayInboundEnvelope } from '@educanvas/gateway-core';
import {
  projectTurnApplicationEventToGateway,
  type GatewayEventPayload,
  type GatewayTurnRunnerPort,
} from '@educanvas/gateway-runtime';
import {
  createTurnModelGatewayFromEnvironment,
  type ModelGatewayEnvironment,
} from '@educanvas/model-gateway';
import {
  createMcpRuntimeFromEnvironment,
  type McpRuntime,
} from '@educanvas/mcp-runtime';
import {
  createNodeToolAdapters,
  type NodeInvocationPersistencePort,
} from '@educanvas/node-runtime';
import { getGatewayTelemetryRuntime } from './telemetry';
import { GatewayGeneralProfile } from './turn-application/general-profile';
import {
  GatewayBoundCancellation,
  GatewayTurnLifecycle,
  type GatewayTurnRepositoryPort,
} from './turn-application/lifecycle';

const SUPPORTED_GATEWAY_PROFILE_ID = 'general';

function readModelEnvironment(): ModelGatewayEnvironment {
  return {
    EDUCANVAS_DEPLOYMENT_ENV: process.env.EDUCANVAS_DEPLOYMENT_ENV,
    MODEL_GATEWAY_PROVIDER: process.env.MODEL_GATEWAY_PROVIDER,
    MODEL_GATEWAY_RUNTIME: process.env.MODEL_GATEWAY_RUNTIME,
    MODEL_GATEWAY_ALLOW_DEEPSEEK: process.env.MODEL_GATEWAY_ALLOW_DEEPSEEK,
    MODEL_GATEWAY_BASE_URL: process.env.MODEL_GATEWAY_BASE_URL,
    MODEL_GATEWAY_API_KEY: process.env.MODEL_GATEWAY_API_KEY,
    MODEL_GATEWAY_PRIMARY_MODEL: process.env.MODEL_GATEWAY_PRIMARY_MODEL,
    MODEL_GATEWAY_FAST_MODEL: process.env.MODEL_GATEWAY_FAST_MODEL,
    MODEL_GATEWAY_STRUCTURED_MODEL: process.env.MODEL_GATEWAY_STRUCTURED_MODEL,
    MODEL_GATEWAY_TIMEOUT_MS: process.env.MODEL_GATEWAY_TIMEOUT_MS,
    MODEL_GATEWAY_MAX_OUTPUT_TOKENS:
      process.env.MODEL_GATEWAY_MAX_OUTPUT_TOKENS,
  };
}

const unavailableModelGateway: TurnModelGateway = {
  async *streamTurnText(request) {
    yield {
      type: 'failed',
      phase: request.phase,
      error: { code: 'unavailable', retryable: true },
    };
  },
};

interface GatewayApplicationDependencies {
  turns: GatewayTurnRepositoryPort;
  contextLedger: AgentTurnContextLedgerPort;
  modelRunLedger: AgentModelRunLedgerPort;
  toolCallLedger: AgentToolCallLedgerPort;
  toolEffectLedger: ToolEffectLedgerPort;
  nodeInvocations: NodeInvocationPersistencePort;
  mcpRuntime: McpRuntime;
  modelGateway: TurnModelGateway;
}

function productionDependencies(): GatewayApplicationDependencies {
  return {
    turns: new DrizzlePlatformTurnRepository(),
    contextLedger: new DrizzleAgentTurnContextRepository(),
    modelRunLedger: new DrizzleAgentModelRunRepository(),
    toolCallLedger: new DrizzleAgentToolCallRepository(),
    toolEffectLedger: new DrizzleToolEffectRepository(),
    nodeInvocations: new DrizzleGatewayNodeRepository(),
    mcpRuntime: createMcpRuntimeFromEnvironment(undefined, {
      durableIntents: new DrizzleMcpIntentRepository(),
      approvalIntents: new DrizzleToolApprovalIntentRepository(),
    }),
    modelGateway:
      createTurnModelGatewayFromEnvironment(readModelEnvironment()) ??
      unavailableModelGateway,
  };
}

type ApplicationFactory = (input: {
  signal: ModelAbortSignal;
}) => TurnApplicationPort;

/** Gateway只负责把可信路由投影成统一命令，再把统一事件投影回Gateway事件。 */
export class GatewayAgentTurnRunner implements GatewayTurnRunnerPort {
  private readonly createApplication: ApplicationFactory;

  constructor(
    dependenciesOrFactory:
      | GatewayApplicationDependencies
      | ApplicationFactory = productionDependencies(),
  ) {
    this.createApplication =
      typeof dependenciesOrFactory === 'function'
        ? dependenciesOrFactory
        : ({ signal }) => {
            const nodeAdapters = createNodeToolAdapters(
              dependenciesOrFactory.nodeInvocations,
            );
            const toolAdapters = [
              ...dependenciesOrFactory.mcpRuntime.adapters,
              ...nodeAdapters,
            ];
            return new TurnApplicationService({
              lifecycle: new GatewayTurnLifecycle(dependenciesOrFactory.turns),
              profile: new GatewayGeneralProfile(
                dependenciesOrFactory.turns,
                dependenciesOrFactory.nodeInvocations,
                dependenciesOrFactory.mcpRuntime.capabilities,
              ),
              contextLedger: dependenciesOrFactory.contextLedger,
              modelRunLedger: dependenciesOrFactory.modelRunLedger,
              modelGateway: dependenciesOrFactory.modelGateway,
              toolKernel: new ToolKernel(
                toolAdapters,
                dependenciesOrFactory.toolCallLedger,
                dependenciesOrFactory.toolEffectLedger,
              ),
              cancellation: new GatewayBoundCancellation(
                signal,
                dependenciesOrFactory.turns,
              ),
              trace: getGatewayTelemetryRuntime().turnTrace,
            });
          };
  }

  async *run(
    input: Parameters<GatewayTurnRunnerPort['run']>[0],
  ): AsyncIterable<GatewayEventPayload> {
    if (input.route.agentProfileId !== SUPPORTED_GATEWAY_PROFILE_ID) {
      yield {
        type: 'operation.failed',
        code: 'CAPABILITY_UNAVAILABLE',
        retryable: false,
      };
      return;
    }
    if (
      input.envelope.parts.some(
        (part) => part.type !== 'text' && part.type !== 'asset_ref',
      ) ||
      input.envelope.parts.some((part) => part.type === 'asset_ref')
    ) {
      yield {
        type: 'operation.failed',
        code: 'CAPABILITY_UNAVAILABLE',
        retryable: false,
      };
      return;
    }
    const command: TurnApplicationCommand = {
      protocol: 'educanvas.turn.v2',
      operationId: input.operationId,
      traceId: input.traceId,
      actor: {
        actorId: input.route.actorUserId,
        agentId: input.route.agentId,
      },
      notebook: {
        notebookId: input.route.notebookId,
        conversationId: input.route.conversationId,
      },
      profile: { profileId: input.route.agentProfileId },
      entrypoint: toEntrypoint(input.envelope),
      input: {
        clientMessageId: input.envelope.idempotencyKey,
        parts: input.envelope.parts.filter(
          (part): part is AgentMessagePart => part.type === 'text',
        ),
      },
      capabilities: input.envelope.capabilities.capabilities.map(
        (capability) => capability.name,
      ),
    };
    const application = this.createApplication({ signal: input.signal });
    for await (const event of application.run(command)) {
      yield projectTurnApplicationEventToGateway(event, {
        actorUserId: input.route.actorUserId,
        occurredAt: new Date().toISOString(),
      });
    }
  }
}

function toEntrypoint(
  envelope: GatewayInboundEnvelope,
): TurnApplicationCommand['entrypoint'] {
  if (envelope.connection.transport === 'web') return 'web';
  if (envelope.connection.transport === 'tui') return 'tui';
  if (envelope.connection.transport === 'telegram') return 'channel';
  return 'system';
}
