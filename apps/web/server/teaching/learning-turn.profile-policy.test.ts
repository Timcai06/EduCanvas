import type { TurnApplicationCommand } from '@educanvas/agent-core';
import type {
  BuiltAssetContext,
  TurnApplicationLifecycleSnapshot,
} from '@educanvas/agent-runtime';
import type { LessonSessionSnapshot } from '@educanvas/teaching-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnonymousIdentity } from '../identity/anonymous-identity';
import { webTeachingPersistence } from './turn-application/persistence';
import { WebTeachingProfile } from './turn-application/profile';

vi.mock('server-only', () => ({}));

const knowledge = 'education.knowledge.retrieve';
const studentState = 'education.student_state.read';
const availableTools = [knowledge, studentState] as const;
const identity: AnonymousIdentity = {
  token: 'test-token',
  studentId: 'student-1',
};
const assetContext: BuiltAssetContext = {
  text: '',
  textSegments: [],
  nativeReferences: [],
};
const command: TurnApplicationCommand = {
  protocol: 'educanvas.turn.v2',
  operationId: 'turn-1',
  traceId: 'trace-1',
  actor: { actorId: identity.studentId, agentId: 'agent-1' },
  notebook: { notebookId: 'notebook-1', conversationId: 'conversation-1' },
  profile: { profileId: 'k12.teacher' },
  entrypoint: 'web',
  input: {
    clientMessageId: 'client-message-1',
    parts: [{ type: 'text', text: '请解释这个知识点' }],
  },
  capabilities: [
    'input.text',
    'output.markdown',
    'root.shell',
    'education.grade',
  ],
};
const turn: TurnApplicationLifecycleSnapshot = {
  operationId: command.operationId,
  traceId: command.traceId,
  userMessageId: 'user-message-1',
  assistantMessageId: 'assistant-message-1',
  replayed: false,
};

function createSession(
  state: LessonSessionSnapshot['state'],
): LessonSessionSnapshot {
  return {
    id: 'session-1',
    studentId: identity.studentId,
    knowledgeNodeId: 'knowledge-node-1',
    state,
    interruptedState: null,
    version: 1,
  };
}

async function prepare(input: {
  state: LessonSessionSnapshot['state'];
  command?: TurnApplicationCommand;
  membershipRole?: 'owner' | 'editor' | 'contributor' | 'viewer';
}) {
  const profile = new WebTeachingProfile(
    identity,
    createSession(input.state),
    assetContext,
    availableTools,
    input.membershipRole ?? 'owner',
  );
  return profile.prepare({ command: input.command ?? command, turn });
}

beforeEach(() => {
  vi.spyOn(webTeachingPersistence.chat, 'listRecentHistory').mockResolvedValue(
    [],
  );
  process.env.EDUCANVAS_DEPLOYMENT_ENV = 'test';
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.EDUCANVAS_DEPLOYMENT_ENV;
});

describe('WebTeachingProfile 可信策略投影', () => {
  it('EXPLAIN 暴露检索与学生状态两个实际教学 Adapter', async () => {
    const plan = await prepare({ state: 'EXPLAIN' });

    expect(plan.toolPolicy?.capabilities).toEqual({
      actor: availableTools,
      notebook: availableTools,
      profile: availableTools,
      channel: availableTools,
      environment: availableTools,
    });
    expect(plan.toolPolicy?.profileContext).toEqual({
      studentId: identity.studentId,
      sessionId: 'session-1',
      knowledgeNodeId: 'knowledge-node-1',
      state: 'EXPLAIN',
    });
  });

  it('ASSESS 由可信教学状态收窄为只读学生状态', async () => {
    const plan = await prepare({ state: 'ASSESS' });

    expect(plan.toolPolicy?.capabilities.profile).toEqual([studentState]);
    expect(plan.toolPolicy?.capabilities.actor).toEqual(availableTools);
  });

  it('command transport/render capabilities 不影响教学 Tool grant', async () => {
    const withManifest = await prepare({ state: 'EXPLAIN' });
    const withoutManifest = await prepare({
      state: 'EXPLAIN',
      command: { ...command, capabilities: [] },
    });

    expect(withManifest.toolPolicy).toEqual(withoutManifest.toolPolicy);
    for (const grant of Object.values(
      withManifest.toolPolicy?.capabilities ?? {},
    )) {
      expect(grant).not.toContain('root.shell');
      expect(grant).not.toContain('education.grade');
      expect(grant).not.toContain('input.text');
    }
  });

  it('viewer 保留 Actor 事实但 Notebook 维 fail closed', async () => {
    const plan = await prepare({ state: 'EXPLAIN', membershipRole: 'viewer' });

    expect(plan.toolPolicy?.capabilities.actor).toEqual(availableTools);
    expect(plan.toolPolicy?.capabilities.notebook).toEqual([]);
  });
});
