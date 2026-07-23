import { describe, expect, it } from 'vitest';
import {
  resolveGatewayGeneralToolPolicy,
  type ResolveGatewayGeneralToolPolicyInput,
} from './general-tool-policy';

const serverTools = [
  'device.status',
  'external.mcp.invoke',
  'filesystem.read_allowlisted',
  'knowledge.lookup',
] as const;

const source: ResolveGatewayGeneralToolPolicyInput = {
  availableCapabilities: serverTools,
  actorCapabilities: serverTools,
  membershipRole: 'owner',
  profileId: 'general',
  channel: 'web',
  environment: 'test',
  environmentCapabilities: serverTools,
};

function resolve(
  overrides: Partial<ResolveGatewayGeneralToolPolicyInput> = {},
) {
  return resolveGatewayGeneralToolPolicy({ ...source, ...overrides });
}

describe('Gateway General Tool Policy', () => {
  it.each(['owner', 'editor', 'contributor'] as const)(
    '%s membership 可使用服务端可用工具',
    (membershipRole) => {
      expect(resolve({ membershipRole }).capabilities.notebook).toEqual(
        serverTools,
      );
    },
  );

  it('viewer membership fail closed', () => {
    expect(resolve({ membershipRole: 'viewer' }).capabilities.notebook).toEqual(
      [],
    );
  });

  it.each([
    ['web', serverTools],
    ['tui', serverTools],
    ['channel', []],
    ['system', []],
  ] as const)('%s 遵守入口 ceiling', (channel, expected) => {
    expect(resolve({ channel }).capabilities.channel).toEqual(expected);
  });

  it('未知入口、环境和 Profile fail closed', () => {
    for (const policy of [
      resolve({ channel: 'unknown' }),
      resolve({ environment: 'unknown' }),
      resolve({ profileId: 'unknown' }),
    ]) {
      expect(
        Object.values(policy.capabilities).every((value) => value.length === 0),
      ).toBe(true);
      expect(policy.approvedCapabilities).toEqual([]);
    }
  });

  it('未注册或未启用 Adapter 不会成为有效授权', () => {
    const unavailable = resolve({
      availableCapabilities: ['device.status', 'external.mcp.invoke'],
      environmentCapabilities: ['device.status', 'filesystem.read_allowlisted'],
    });
    expect(unavailable.capabilities.environment).toEqual(['device.status']);
    expect(unavailable.capabilities.actor).toEqual([
      'device.status',
      'external.mcp.invoke',
    ]);
  });

  it('允许通过五维交集的服务端自定义 MCP capability', () => {
    const policy = resolve({
      requestedChannelCapabilities: ['knowledge.lookup'],
    });
    expect(policy.capabilities.profile).toContain('knowledge.lookup');
    expect(policy.capabilities.channel).toEqual(['knowledge.lookup']);
  });

  it('恶意 requested capability 只能收窄，不能跨 actor grant 增权', () => {
    const policy = resolve({
      actorCapabilities: ['device.status'],
      requestedChannelCapabilities: ['device.status', 'root.shell'],
      approvedCapabilities: ['root.shell', 'device.status'],
    });

    expect(policy.capabilities.actor).toEqual(['device.status']);
    expect(policy.capabilities.channel).toEqual(['device.status']);
    expect(policy.approvedCapabilities).toEqual(['device.status']);
  });

  it('transport/render manifest 未作为 requested 时不限制服务端工具', () => {
    const policy = resolve();
    expect(policy.capabilities.channel).toEqual(serverTools);
  });

  it('即使混入 requested，transport/render capability 也不会成为工具 grant', () => {
    const policy = resolve({
      requestedChannelCapabilities: [
        'input.text',
        'output.markdown',
        'knowledge.lookup',
      ],
    });
    expect(policy.capabilities.channel).toEqual(['knowledge.lookup']);
  });

  it('无论来源输入顺序和重复项如何都输出稳定顺序', () => {
    const reversed = [...serverTools].reverse();
    const policy = resolve({
      availableCapabilities: reversed,
      actorCapabilities: [...reversed, ...reversed],
      environmentCapabilities: reversed,
      requestedChannelCapabilities: reversed,
      approvedCapabilities: reversed,
    });

    expect(policy.capabilities.actor).toEqual(serverTools);
    expect(policy.approvedCapabilities).toEqual(serverTools);
  });
});
