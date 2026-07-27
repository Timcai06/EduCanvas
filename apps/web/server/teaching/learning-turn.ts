/**
 * Web 教学 Turn 组合根 — 装配完整的教学 Turn Application 依赖图。
 *
 * ## 依赖装配清单
 *
 * | Port | 实现 | 来源 |
 * |------|------|------|
 * | lifecycle | WebTeachingLifecycle | turn-application/lifecycle（消息/操作持久化） |
 * | profile | WebTeachingProfile | turn-application/profile（Context/Prompt/策略/安全门） |
 * | contextLedger | DrizzleAgentTurnContextRepository | db |
 * | modelRunLedger | DrizzleAgentModelRunRepository | db |
 * | modelGateway | resolveTurnModelRuntime() | model/model-runtime（环境变量配置） |
 * | toolKernel | createTeachingToolKernelAdapters() | teaching-tools（8 个教学工具 + 审批） |
 * | cancellation | WebTeachingCancellation | turn-application/cancellation |
 * | trace | getWebTelemetryRuntime() | telemetry/telemetry-runtime |
 *
 * ## 为什么教学不创建私有模型循环
 *
 * 教学共用 TurnApplicationService 的 Agent Loop（agent-runtime）。
 * 教学 Profile 只负责 Context/Prompt/策略装配，不拥有第二个模型循环。
 * 这保证通用 Agent 和教学 Agent 共享同一套 turn 编排、取消、审批和终态纪律。
 */

import 'server-only';

import type {
  ModelAbortSignal,
  TurnApplicationCommand,
  TurnApplicationEvent,
  TurnModelGateway,
} from '@educanvas/agent-core';
import {
  ToolKernel,
  TurnApplicationService,
  type BuiltAssetContext,
} from '@educanvas/agent-runtime';
import {
  DrizzleAgentModelRunRepository,
  DrizzleAgentToolCallRepository,
  DrizzleAgentTurnContextRepository,
  DrizzleStudyPlanRepository,
  DrizzleToolEffectRepository,
} from '@educanvas/db';
import type { GatewayResolvedRoute } from '@educanvas/gateway-core';
import {
  resolveLearnerAdaptationPolicy,
  type LessonSessionSnapshot,
} from '@educanvas/teaching-core';
import { materializeAssetContextPlan } from '../assets/asset-materialization';
import type { TeachingTurnRequestBody } from '../http/turn-request';
import type { AnonymousIdentity } from '../identity/anonymous-identity';
import { resolveTurnModelRuntime } from '../model/model-runtime';
import { getWebTelemetryRuntime } from '../telemetry/telemetry-runtime';
import {
  createTeachingToolKernelAdapters,
  teachingToolAdapterCapabilities,
} from './teaching-tools';
import { WebTeachingCancellation } from './turn-application/cancellation';
import { WebTeachingLifecycle } from './turn-application/lifecycle';
import { WebTeachingProfile } from './turn-application/profile';

const unavailableModelGateway: TurnModelGateway = {
  async *streamTurnText(request) {
    yield {
      type: 'failed',
      phase: request.phase,
      error: { code: 'unavailable', retryable: true },
    };
  },
};
const studyPlans = new DrizzleStudyPlanRepository();

/** Web 教学入口的唯一显式 Turn Application 组合根；教学 Profile 不创建私有模型循环。 */
export function beginGatewayTeachingTurnApplication(input: {
  operationId: string;
  traceId: string;
  route: GatewayResolvedRoute;
  identity: AnonymousIdentity;
  session: LessonSessionSnapshot;
  request: TeachingTurnRequestBody;
  assetContext: BuiltAssetContext;
  signal: ModelAbortSignal;
  transportCapabilities: readonly string[];
}): { events: AsyncIterable<TurnApplicationEvent> } {
  if (
    input.route.actorUserId !== input.identity.studentId ||
    input.session.studentId !== input.route.actorUserId
  ) {
    throw new Error('web_teaching_actor_scope_mismatch');
  }
  if (input.route.agentProfileId !== 'k12.teacher') {
    throw new Error('web_teaching_profile_unsupported');
  }
  const profile = new WebTeachingProfile(
    input.identity,
    input.session,
    input.assetContext,
    teachingToolAdapterCapabilities(),
    input.route.membershipRole,
    async () => {
      const plan = await studyPlans.getOwnedBySession(
        input.identity.studentId,
        input.session.id,
      );
      return plan ? resolveLearnerAdaptationPolicy(plan.profile) : null;
    },
  );
  const adapters = createTeachingToolKernelAdapters((candidateIds) =>
    profile.collectKnowledgeEvidence(candidateIds),
  );
  const runtime = resolveTurnModelRuntime();
  const service = new TurnApplicationService({
    lifecycle: new WebTeachingLifecycle(input.identity, input.session.id),
    profile,
    contextLedger: new DrizzleAgentTurnContextRepository(),
    modelRunLedger: new DrizzleAgentModelRunRepository(),
    modelGateway: runtime?.gateway ?? unavailableModelGateway,
    toolKernel: new ToolKernel(
      adapters,
      new DrizzleAgentToolCallRepository(),
      new DrizzleToolEffectRepository(),
    ),
    cancellation: new WebTeachingCancellation(input.signal),
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

/** 在 Gateway Operation 前完成资产归属与模态验证；错误仍由 Web 路由清晰呈现。 */
export async function prepareGatewayTeachingTurnContext(input: {
  identity: AnonymousIdentity;
  notebookId: string;
  request: TeachingTurnRequestBody;
}): Promise<BuiltAssetContext> {
  return materializeAssetContextPlan({
    identity: input.identity,
    spaceId: input.notebookId,
    parts: input.request.parts,
  });
}
