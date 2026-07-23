import { describe, expect, it, vi } from 'vitest';
import {
  resolveWebGeneralToolPolicy,
  type ResolveWebGeneralToolPolicyInput,
} from './general-turn-tool-policy';

vi.mock('server-only', () => ({}));

const availableTools = [
  'device.status',
  'external.mcp.invoke',
  'filesystem.read_allowlisted',
  'web.fetch',
  'web.search',
] as const;

const trustedInput: ResolveWebGeneralToolPolicyInput = {
  availableCapabilities: availableTools,
  actorCapabilities: availableTools,
  membershipRole: 'owner',
  profileId: 'general',
  channel: 'web',
  environment: 'test',
  environmentCapabilities: availableTools,
};

function resolve(overrides: Partial<ResolveWebGeneralToolPolicyInput> = {}) {
  return resolveWebGeneralToolPolicy({ ...trustedInput, ...overrides });
}

describe('Web General Tool Policy', () => {
  it.each(['owner', 'editor', 'contributor'] as const)(
    '%s 仅获得实际可用且通过五维授权的工具',
    (membershipRole) => {
      const policy = resolve({ membershipRole });

      expect(policy.capabilities.notebook).toEqual(availableTools);
      expect(policy.capabilities.channel).toEqual(availableTools);
    },
  );

  it('viewer membership fail closed', () => {
    const policy = resolve({ membershipRole: 'viewer' });

    expect(policy.capabilities.notebook).toEqual([]);
    expect(policy.approvedCapabilities).toEqual([]);
  });

  it('未知 Profile、环境或非 Web 入口 fail closed', () => {
    for (const policy of [
      resolve({ profileId: 'agent.general' }),
      resolve({ environment: 'unknown' }),
      resolve({ channel: 'tui' }),
    ]) {
      expect(
        Object.values(policy.capabilities).every((value) => value.length === 0),
      ).toBe(true);
      expect(policy.approvedCapabilities).toEqual([]);
    }
  });

  it('实际注册 Adapter 是所有授权来源的共同上界', () => {
    const policy = resolve({
      availableCapabilities: ['web.fetch'],
      actorCapabilities: ['web.fetch', 'root.shell'],
      environmentCapabilities: ['web.fetch', 'web.search'],
      requestedChannelCapabilities: ['web.fetch', 'root.shell'],
      approvedCapabilities: ['web.fetch', 'root.shell'],
    });

    expect(policy.capabilities).toEqual({
      actor: ['web.fetch'],
      notebook: ['web.fetch'],
      profile: ['web.fetch'],
      channel: ['web.fetch'],
      environment: ['web.fetch'],
    });
    expect(policy.approvedCapabilities).toEqual(['web.fetch']);
  });

  it('恶意 root.shell 与 transport manifest 只能收窄，不能增权', () => {
    const policy = resolve({
      actorCapabilities: ['web.fetch'],
      requestedChannelCapabilities: [
        'input.text',
        'output.markdown',
        'root.shell',
        'web.fetch',
      ],
      approvedCapabilities: [
        'input.text',
        'output.markdown',
        'root.shell',
        'web.fetch',
      ],
    });

    expect(policy.capabilities.actor).toEqual(['web.fetch']);
    expect(policy.capabilities.channel).toEqual(['web.fetch']);
    expect(policy.approvedCapabilities).toEqual(['web.fetch']);
  });

  it('approvedCapabilities 必须再次落入最终五维交集', () => {
    const policy = resolve({
      actorCapabilities: ['device.status', 'web.fetch'],
      environmentCapabilities: ['device.status', 'web.search'],
      requestedChannelCapabilities: ['device.status', 'web.fetch'],
      approvedCapabilities: ['device.status', 'web.fetch', 'web.search'],
    });

    expect(policy.approvedCapabilities).toEqual(['device.status']);
  });

  it('来源乱序和重复项不会改变稳定输出', () => {
    const reversed = [...availableTools].reverse();
    const policy = resolve({
      availableCapabilities: reversed,
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
