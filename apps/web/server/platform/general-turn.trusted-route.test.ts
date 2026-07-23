import type { BuiltAssetContext } from '@educanvas/agent-runtime';
import { TurnApplicationService } from '@educanvas/agent-runtime';
import {
  DrizzleAgentModelRunRepository,
  DrizzleAgentTurnContextRepository,
} from '@educanvas/db';
import type { GatewayResolvedRoute } from '@educanvas/gateway-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TeachingTurnRequestBody } from '../http/turn-request';
import type { AnonymousIdentity } from '../identity/anonymous-identity';
import { resolveTurnModelRuntime } from '../model/model-runtime';
import { getWebTelemetryRuntime } from '../telemetry/telemetry-runtime';
import {
  WebGeneralCancellation,
  WebGeneralLifecycle,
} from './general-turn-lifecycle';
import { WebGeneralProfile } from './general-turn-profile';
import { beginGatewayGeneralTurnApplication } from './general-turn';
import {
  createGeneralToolKernel,
  WebOperationSources,
} from './general-turn-tools';

vi.mock('server-only', () => ({}));
vi.mock('@educanvas/agent-runtime', () => ({
  TurnApplicationService: vi.fn(),
}));
vi.mock('@educanvas/db', () => ({
  DrizzleAgentModelRunRepository: vi.fn(),
  DrizzleAgentTurnContextRepository: vi.fn(),
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
vi.mock('./general-turn-lifecycle', () => ({
  WebGeneralCancellation: vi.fn(),
  WebGeneralLifecycle: vi.fn(),
}));
vi.mock('./general-turn-profile', () => ({
  WebGeneralProfile: vi.fn(),
}));
vi.mock('./general-turn-tools', () => ({
  createGeneralToolKernel: vi.fn(),
  WebOperationSources: vi.fn(),
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
  agentProfileId: 'general',
  membershipRole: 'owner',
};
const request: TeachingTurnRequestBody = {
  clientMessageId: 'client-message-1',
  text: '请总结这份资料',
  parts: [{ type: 'text', text: '请总结这份资料' }],
};
const assetContext: BuiltAssetContext = {
  text: '',
  textSegments: [],
  nativeReferences: [],
};

function begin(routeOverride: GatewayResolvedRoute): void {
  beginGatewayGeneralTurnApplication({
    operationId: 'operation-1',
    traceId: 'trace-1',
    route: routeOverride,
    identity,
    request,
    assetContext,
    signal: new AbortController().signal,
    transportCapabilities: [],
  });
}

function expectNoRuntimeComposition(): void {
  expect(WebOperationSources).not.toHaveBeenCalled();
  expect(createGeneralToolKernel).not.toHaveBeenCalled();
  expect(resolveTurnModelRuntime).not.toHaveBeenCalled();
  expect(DrizzleAgentTurnContextRepository).not.toHaveBeenCalled();
  expect(DrizzleAgentModelRunRepository).not.toHaveBeenCalled();
  expect(WebGeneralLifecycle).not.toHaveBeenCalled();
  expect(WebGeneralProfile).not.toHaveBeenCalled();
  expect(WebGeneralCancellation).not.toHaveBeenCalled();
  expect(getWebTelemetryRuntime).not.toHaveBeenCalled();
  expect(TurnApplicationService).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Web General可信Gateway路由边界', () => {
  it('在Actor与当前身份不一致时同步拒绝且不进入运行时组合', () => {
    expect(() => begin({ ...route, actorUserId: 'student-2' })).toThrowError(
      'web_general_actor_scope_mismatch',
    );

    expectNoRuntimeComposition();
  });

  it('在Agent Profile不是general时同步拒绝且不进入运行时组合', () => {
    expect(() =>
      begin({ ...route, agentProfileId: 'k12.teacher' }),
    ).toThrowError('web_general_profile_unsupported');

    expectNoRuntimeComposition();
  });
});
