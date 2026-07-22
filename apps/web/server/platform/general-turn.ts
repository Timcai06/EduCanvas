import 'server-only';

import type {
  ModelAbortSignal,
  TurnApplicationCommand,
  TurnApplicationEvent,
  TurnModelGateway,
} from '@educanvas/agent-core';
import {
  TurnApplicationService,
  type BuiltAssetContext,
} from '@educanvas/agent-runtime';
import {
  DrizzleAgentModelRunRepository,
  DrizzleAgentTurnContextRepository,
} from '@educanvas/db';
import { materializeAssetContextPlan } from '../assets/asset-materialization';
import type { TeachingTurnRequestBody } from '../http/turn-request';
import type { AnonymousIdentity } from '../identity/anonymous-identity';
import { resolveTurnModelRuntime } from '../model/model-runtime';
import { getWebTelemetryRuntime } from '../telemetry/telemetry-runtime';
import {
  WebGeneralCancellation,
  WebGeneralLifecycle,
} from './general-turn-lifecycle';
import { WebGeneralProfile } from './general-turn-profile';
import {
  createGeneralToolKernel,
  WebOperationSources,
} from './general-turn-tools';

const unavailableModelGateway: TurnModelGateway = {
  async *streamTurnText(request) {
    yield {
      type: 'failed',
      phase: request.phase,
      error: { code: 'unavailable', retryable: true },
    };
  },
};

/** Web Gateway入口的统一Turn Application组合根；不再创建私有模型循环。 */
export function beginGatewayGeneralTurnApplication(input: {
  operationId: string;
  traceId: string;
  actorId: string;
  agentId: string;
  identity: AnonymousIdentity;
  conversationId: string;
  spaceId: string;
  request: TeachingTurnRequestBody;
  assetContext: BuiltAssetContext;
  signal: ModelAbortSignal;
  capabilities: readonly string[];
}): { events: AsyncIterable<TurnApplicationEvent> } {
  if (input.actorId !== input.identity.studentId) {
    throw new Error('web_general_actor_scope_mismatch');
  }
  const operationSources = new WebOperationSources({
    identity: input.identity,
    conversationId: input.conversationId,
    spaceId: input.spaceId,
    operationId: input.operationId,
  });
  const tools = createGeneralToolKernel(operationSources);
  const runtime = resolveTurnModelRuntime();
  const service = new TurnApplicationService({
    lifecycle: new WebGeneralLifecycle(input.identity),
    profile: new WebGeneralProfile(
      input.assetContext,
      operationSources,
      tools.staticCapabilities,
      tools.nodeInvocations,
    ),
    contextLedger: new DrizzleAgentTurnContextRepository(),
    modelRunLedger: new DrizzleAgentModelRunRepository(),
    modelGateway: runtime?.gateway ?? unavailableModelGateway,
    toolKernel: tools.kernel,
    cancellation: new WebGeneralCancellation(input.signal),
    trace: getWebTelemetryRuntime().turnTrace,
  });
  const command: TurnApplicationCommand = {
    protocol: 'educanvas.turn.v2',
    operationId: input.operationId,
    traceId: input.traceId,
    actor: { actorId: input.actorId, agentId: input.agentId },
    notebook: {
      notebookId: input.spaceId,
      conversationId: input.conversationId,
    },
    profile: { profileId: 'agent.general' },
    entrypoint: 'web',
    input: {
      clientMessageId: input.request.clientMessageId,
      parts: [...input.request.parts],
    },
    capabilities: [
      ...new Set([...input.capabilities, ...tools.staticCapabilities]),
    ],
  };
  return { events: service.run(command) };
}

export async function prepareGatewayGeneralTurnContext(input: {
  identity: AnonymousIdentity;
  spaceId: string;
  request: TeachingTurnRequestBody;
}): Promise<BuiltAssetContext> {
  return materializeAssetContextPlan({
    identity: input.identity,
    spaceId: input.spaceId,
    parts: input.request.parts,
  });
}
