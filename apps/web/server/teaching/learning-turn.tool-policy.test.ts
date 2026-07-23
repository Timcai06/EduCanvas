import type { TeachingState } from '@educanvas/teaching-core';
import { describe, expect, it, vi } from 'vitest';
import {
  resolveWebTeachingToolPolicy,
  type ResolveWebTeachingToolPolicyInput,
} from './turn-application/tool-policy';

vi.mock('server-only', () => ({}));

const knowledge = 'education.knowledge.retrieve';
const studentState = 'education.student_state.read';
const availableTools = [knowledge, studentState] as const;

const trustedInput: ResolveWebTeachingToolPolicyInput = {
  availableCapabilities: availableTools,
  actorCapabilities: availableTools,
  membershipRole: 'owner',
  profileId: 'k12.teacher',
  state: 'EXPLAIN',
  channel: 'web',
  environment: 'test',
  environmentCapabilities: availableTools,
  profileContext: {
    studentId: 'student-1',
    sessionId: 'session-1',
    knowledgeNodeId: 'node-1',
    state: 'EXPLAIN',
  },
};

function resolve(overrides: Partial<ResolveWebTeachingToolPolicyInput> = {}) {
  return resolveWebTeachingToolPolicy({ ...trustedInput, ...overrides });
}

function expectEmptyPolicy(
  overrides: Partial<ResolveWebTeachingToolPolicyInput>,
): void {
  const policy = resolve(overrides);

  expect(
    Object.values(policy.capabilities).every((grant) => grant.length === 0),
  ).toBe(true);
  expect(policy.approvedCapabilities).toEqual([]);
}

describe('Web Teaching Tool Policy', () => {
  it.each(['owner', 'editor', 'contributor'] as const)(
    '%s 仅获得实际注册且通过五维授权的教学工具',
    (membershipRole) => {
      const policy = resolve({ membershipRole });

      expect(policy.capabilities).toEqual({
        actor: availableTools,
        notebook: availableTools,
        profile: availableTools,
        channel: availableTools,
        environment: availableTools,
      });
    },
  );

  it('viewer 即使拥有服务端 Adapter 也不能获得 Notebook 授权', () => {
    const policy = resolve({ membershipRole: 'viewer' });

    expect(policy.capabilities.actor).toEqual(availableTools);
    expect(policy.capabilities.notebook).toEqual([]);
    expect(policy.approvedCapabilities).toEqual([]);
  });

  it('未知 Profile、环境与非 Web 入口一律 fail closed', () => {
    expectEmptyPolicy({ profileId: 'general' });
    expectEmptyPolicy({ environment: 'unknown' });
    expectEmptyPolicy({ channel: 'tui' });
  });

  it.each<[TeachingState, readonly string[]]>([
    ['DIAGNOSE', availableTools],
    ['EXPLAIN', availableTools],
    ['DEMONSTRATE', availableTools],
    ['PRACTICE', availableTools],
    ['ASSESS', [studentState]],
  ])('%s 只暴露该教学状态允许的已注册 Adapter', (state, expected) => {
    const policy = resolve({ state });

    expect(policy.capabilities.profile).toEqual(expected);
  });

  it('实际注册 Adapter 是所有授权来源的共同上界', () => {
    const policy = resolve({
      availableCapabilities: [studentState],
      actorCapabilities: [studentState, knowledge, 'education.grade'],
      environmentCapabilities: [studentState, knowledge, 'root.shell'],
      requestedChannelCapabilities: [
        studentState,
        knowledge,
        'education.grade',
      ],
      approvedCapabilities: [studentState, knowledge, 'education.grade'],
    });

    expect(policy.capabilities).toEqual({
      actor: [studentState],
      notebook: [studentState],
      profile: [studentState],
      channel: [studentState],
      environment: [studentState],
    });
    expect(policy.approvedCapabilities).toEqual([studentState]);
  });

  it('恶意 root.shell、伪教育能力与 transport manifest 不能增权', () => {
    const policy = resolve({
      actorCapabilities: [knowledge, studentState, 'root.shell'],
      requestedChannelCapabilities: [
        'input.text',
        'output.markdown',
        'root.shell',
        'education.grade',
        knowledge,
      ],
      approvedCapabilities: [
        'input.text',
        'output.markdown',
        'root.shell',
        'education.grade',
        knowledge,
      ],
    });

    expect(policy.capabilities.channel).toEqual([knowledge]);
    expect(policy.approvedCapabilities).toEqual([knowledge]);
    for (const grant of Object.values(policy.capabilities)) {
      expect(grant).not.toContain('root.shell');
      expect(grant).not.toContain('education.grade');
      expect(grant).not.toContain('input.text');
    }
  });

  it('审批结果必须再次落入 available 与最终五维交集', () => {
    const policy = resolve({
      state: 'ASSESS',
      actorCapabilities: availableTools,
      environmentCapabilities: availableTools,
      requestedChannelCapabilities: availableTools,
      approvedCapabilities: [knowledge, studentState, 'root.shell'],
    });

    expect(policy.capabilities.profile).toEqual([studentState]);
    expect(policy.approvedCapabilities).toEqual([studentState]);
  });

  it('乱序与重复来源仍产生稳定排序输出', () => {
    const reversed = [...availableTools].reverse();
    const policy = resolve({
      availableCapabilities: [...reversed, ...reversed],
      actorCapabilities: [...reversed, ...reversed],
      environmentCapabilities: reversed,
      requestedChannelCapabilities: reversed,
      approvedCapabilities: reversed,
    });

    expect(policy.capabilities.actor).toEqual(availableTools);
    expect(policy.capabilities.channel).toEqual(availableTools);
    expect(policy.approvedCapabilities).toEqual(availableTools);
  });
});
