import type { BuiltAssetContext } from '@educanvas/agent-runtime';
import { TurnApplicationService } from '@educanvas/agent-runtime';
import {
  DrizzleAgentModelRunRepository,
  DrizzleAgentToolCallRepository,
  DrizzleAgentTurnContextRepository,
  DrizzleToolEffectRepository,
} from '@educanvas/db';
import type { GatewayResolvedRoute } from '@educanvas/gateway-core';
import type { LessonSessionSnapshot } from '@educanvas/teaching-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TeachingTurnRequestBody } from '../http/turn-request';
import type { AnonymousIdentity } from '../identity/anonymous-identity';
import { resolveTurnModelRuntime } from '../model/model-runtime';
import { getWebTelemetryRuntime } from '../telemetry/telemetry-runtime';
import {
  createTeachingToolKernelAdapters,
  teachingToolAdapterCapabilities,
} from './teaching-tools';
import { beginGatewayTeachingTurnApplication } from './learning-turn';
import { WebTeachingCancellation } from './turn-application/cancellation';
import { WebTeachingLifecycle } from './turn-application/lifecycle';
import { WebTeachingProfile } from './turn-application/profile';

vi.mock('server-only', () => ({}));
vi.mock('@educanvas/agent-runtime', () => ({
  TurnApplicationService: vi.fn(),
}));
vi.mock('@educanvas/db', () => ({
  DrizzleAgentModelRunRepository: vi.fn(),
  DrizzleAgentToolCallRepository: vi.fn(),
  DrizzleAgentTurnContextRepository: vi.fn(),
  DrizzleToolEffectRepository: vi.fn(),
}));
vi.mock('../assets/asset-materialization', () => ({
  materializeAssetContextPlan: vi.fn(),
}));
vi.mock('../model/model-runtime', () => ({
  resolveTurnModelRuntime: vi.fn(),
}));
vi.mock('../telemetry/telemetry-runtime', () => ({
  getWebTelemetryRuntime: vi.fn(),
}));
vi.mock('./teaching-tools', () => ({
  createTeachingToolKernelAdapters: vi.fn(),
  teachingToolAdapterCapabilities: vi.fn(),
}));
vi.mock('./turn-application/cancellation', () => ({
  WebTeachingCancellation: vi.fn(),
}));
vi.mock('./turn-application/lifecycle', () => ({
  WebTeachingLifecycle: vi.fn(),
}));
vi.mock('./turn-application/profile', () => ({
  WebTeachingProfile: vi.fn(),
}));

const identity: AnonymousIdentity = {
  token: 'test-token',
  studentId: 'student-1',
};
const route: GatewayResolvedRoute = {
  actorUserId: identity.studentId,
  agentId: 'agent-1',
  notebookId: 'notebook-1',
  conversationId: 'conversation-1',
  agentProfileId: 'k12.teacher',
  membershipRole: 'owner',
};
const session: LessonSessionSnapshot = {
  id: 'session-1',
  studentId: identity.studentId,
  knowledgeNodeId: 'knowledge-node-1',
  state: 'EXPLAIN',
  interruptedState: null,
  version: 1,
};
const request: TeachingTurnRequestBody = {
  clientMessageId: 'client-message-1',
  text: '请解释这个知识点',
  parts: [{ type: 'text', text: '请解释这个知识点' }],
};
const assetContext: BuiltAssetContext = {
  text: '',
  textSegments: [],
  nativeReferences: [],
};

function begin(input?: {
  route?: GatewayResolvedRoute;
  session?: LessonSessionSnapshot;
}): void {
  beginGatewayTeachingTurnApplication({
    operationId: 'operation-1',
    traceId: 'trace-1',
    route: input?.route ?? route,
    identity,
    session: input?.session ?? session,
    request,
    assetContext,
    signal: new AbortController().signal,
    transportCapabilities: [],
  });
}

function expectNoRuntimeComposition(): void {
  expect(teachingToolAdapterCapabilities).not.toHaveBeenCalled();
  expect(createTeachingToolKernelAdapters).not.toHaveBeenCalled();
  expect(resolveTurnModelRuntime).not.toHaveBeenCalled();
  expect(DrizzleAgentTurnContextRepository).not.toHaveBeenCalled();
  expect(DrizzleAgentModelRunRepository).not.toHaveBeenCalled();
  expect(DrizzleAgentToolCallRepository).not.toHaveBeenCalled();
  expect(DrizzleToolEffectRepository).not.toHaveBeenCalled();
  expect(WebTeachingLifecycle).not.toHaveBeenCalled();
  expect(WebTeachingProfile).not.toHaveBeenCalled();
  expect(WebTeachingCancellation).not.toHaveBeenCalled();
  expect(getWebTelemetryRuntime).not.toHaveBeenCalled();
  expect(TurnApplicationService).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Web Teaching 可信 Gateway 路由边界', () => {
  it('Actor 与当前身份不一致时同步拒绝且下游零调用', () => {
    expect(() =>
      begin({ route: { ...route, actorUserId: 'student-2' } }),
    ).toThrowError('web_teaching_actor_scope_mismatch');

    expectNoRuntimeComposition();
  });

  it('Session 归属与可信 Actor 不一致时同步拒绝且下游零调用', () => {
    expect(() =>
      begin({ session: { ...session, studentId: 'student-2' } }),
    ).toThrowError('web_teaching_actor_scope_mismatch');

    expectNoRuntimeComposition();
  });

  it('Agent Profile 不是 k12.teacher 时同步拒绝且下游零调用', () => {
    expect(() =>
      begin({ route: { ...route, agentProfileId: 'general' } }),
    ).toThrowError('web_teaching_profile_unsupported');

    expectNoRuntimeComposition();
  });
});
