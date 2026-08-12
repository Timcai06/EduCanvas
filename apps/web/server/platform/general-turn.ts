import 'server-only';

import type {
  ModelAbortSignal,
  TurnApplicationCommand,
  TurnApplicationEvent,
} from '@educanvas/agent-core';
import type { GatewayResolvedRoute } from '@educanvas/gateway-core';
import {
  materializeAssetContextPlan,
  type MaterializedAssetPlan,
} from '../assets/asset-materialization';
import type { TeachingTurnRequestBody } from '../http/turn-request';
import type { AnonymousIdentity } from '../identity/anonymous-identity';
import type { ResolvedTurnModelRuntime } from '../model/model-runtime';
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
import {
  createWebTurnApplication,
  createWebTurnLedgers,
  unavailableModelGateway,
} from '../turn-composition';

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
  modelRuntime: ResolvedTurnModelRuntime | null;
}): { events: AsyncIterable<TurnApplicationEvent> } {
  if (input.route.actorUserId !== input.identity.studentId) {
    throw new Error('web_general_actor_scope_mismatch');
  }
  if (input.route.agentProfileId !== 'general') {
    throw new Error('web_general_profile_unsupported');
  }
  const ledgers = createWebTurnLedgers();
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
  const runtime = input.modelRuntime;
  /**
   * 只有本轮真的带了原生图片才切到视觉 Provider：视觉模型通常在纯文本推理、
   * 长上下文和工具调用上弱于主模型，无条件替换会让绝大多数不含图片的教学 Turn
   * 一起降级（ADR-0017）。未配置视觉 Provider 时 nativeImages 恒为空，物化层
   * 已在更早的位置明确拒绝过图片。
   */
  const modelGateway =
    input.assetContext.nativeImages.length > 0 && runtime?.visionGateway
      ? runtime.visionGateway
      : (runtime?.gateway ?? unavailableModelGateway);
  const service = createWebTurnApplication({
    lifecycle: new WebGeneralLifecycle(input.identity),
    profile: new WebGeneralProfile(
      input.assetContext,
      operationSources,
      operationArtifacts,
      operationImages,
      input.request.outputPreference ?? 'auto',
      tools.staticCapabilities,
      tools.nodeInvocations,
      input.route.membershipRole,
    ),
    contextLedger: ledgers.contextLedger,
    modelRunLedger: ledgers.modelRunLedger,
    usageBudgetLedger: ledgers.usageBudgetLedger,
    modelGateway,
    toolKernel: tools.kernel,
    cancellation: new WebGeneralCancellation(input.signal),
    trace: ledgers.trace,
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
  modelRuntime: ResolvedTurnModelRuntime | null;
}): Promise<MaterializedAssetPlan> {
  return materializeAssetContextPlan({
    identity: input.identity,
    spaceId: input.spaceId,
    parts: input.request.parts,
    /* 能力与实际要调用的网关同源：未配置视觉的部署会在这里就明确拒绝图片，
       而不是把整轮对话赌在供应商对未知片段的容错上。 */
    nativeAssetKinds: input.modelRuntime?.nativeAssetKinds ?? [],
  });
}
