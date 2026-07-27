import 'server-only';

import type {
  ModelAbortSignal,
  TurnApplicationCommand,
  TurnApplicationEvent,
  TurnModelGateway,
} from '@educanvas/agent-core';
import { TurnApplicationService } from '@educanvas/agent-runtime';
import {
  DrizzleAgentModelRunRepository,
  DrizzleAgentTurnContextRepository,
} from '@educanvas/db';
import type { GatewayResolvedRoute } from '@educanvas/gateway-core';
import {
  materializeAssetContextPlan,
  type MaterializedAssetPlan,
} from '../assets/asset-materialization';
import type { TeachingTurnRequestBody } from '../http/turn-request';
import type { AnonymousIdentity } from '../identity/anonymous-identity';
import { resolveTurnModelRuntime } from '../model/model-runtime';
import { getWebTelemetryRuntime } from '../telemetry/telemetry-runtime';
import {
  WebGeneralCancellation,
  WebGeneralLifecycle,
} from './general-turn-lifecycle';
import { WebOperationArtifacts } from './general-artifact-tool';
import { WebOperationImageArtifacts } from './general-image-tool';
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
  route: GatewayResolvedRoute;
  identity: AnonymousIdentity;
  request: TeachingTurnRequestBody;
  assetContext: MaterializedAssetPlan;
  signal: ModelAbortSignal;
  transportCapabilities: readonly string[];
}): { events: AsyncIterable<TurnApplicationEvent> } {
  if (input.route.actorUserId !== input.identity.studentId) {
    throw new Error('web_general_actor_scope_mismatch');
  }
  if (input.route.agentProfileId !== 'general') {
    throw new Error('web_general_profile_unsupported');
  }
  const operationSources = new WebOperationSources({
    identity: input.identity,
    conversationId: input.route.conversationId,
    spaceId: input.route.notebookId,
    operationId: input.operationId,
  });
  const operationArtifacts = new WebOperationArtifacts({
    identity: input.identity,
    conversationId: input.route.conversationId,
    spaceId: input.route.notebookId,
    operationId: input.operationId,
  });
  const operationImages = new WebOperationImageArtifacts({
    identity: input.identity,
    conversationId: input.route.conversationId,
    spaceId: input.route.notebookId,
    operationId: input.operationId,
  });
  const tools = createGeneralToolKernel(
    operationSources,
    operationArtifacts,
    operationImages,
  );
  const runtime = resolveTurnModelRuntime();
  const service = new TurnApplicationService({
    lifecycle: new WebGeneralLifecycle(input.identity),
    profile: new WebGeneralProfile(
      input.assetContext,
      operationSources,
      operationArtifacts,
      operationImages,
      input.request.outputPreference === 'canvas',
      tools.staticCapabilities,
      tools.nodeInvocations,
      input.route.membershipRole,
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
    actor: {
      actorId: input.route.actorUserId,
      agentId: input.route.agentId,
    },
    notebook: {
      notebookId: input.route.notebookId,
      conversationId: input.route.conversationId,
    },
    profile: { profileId: input.route.agentProfileId },
    entrypoint: 'web',
    input: {
      clientMessageId: input.request.clientMessageId,
      parts: [...input.request.parts],
    },
    capabilities: [...new Set(input.transportCapabilities)],
  };
  return { events: service.run(command) };
}

export async function prepareGatewayGeneralTurnContext(input: {
  identity: AnonymousIdentity;
  spaceId: string;
  request: TeachingTurnRequestBody;
}): Promise<MaterializedAssetPlan> {
  return materializeAssetContextPlan({
    identity: input.identity,
    spaceId: input.spaceId,
    parts: input.request.parts,
    /* 能力与实际要调用的网关同源：未配置视觉的部署会在这里就明确拒绝图片，
       而不是把整轮对话赌在供应商对未知片段的容错上。 */
    nativeAssetKinds: resolveTurnModelRuntime()?.nativeAssetKinds ?? [],
  });
}
