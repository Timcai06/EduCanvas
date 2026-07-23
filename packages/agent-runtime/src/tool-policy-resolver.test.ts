import { describe, expect, it } from 'vitest';
import {
  resolveToolPolicy,
  type ToolPolicyResolverInput,
} from './tool-policy-resolver';

const sharedInput = (): ToolPolicyResolverInput => ({
  availableCapabilities: [
    'tool.write',
    'tool.shared',
    'tool.read',
    'tool.shared',
  ],
  grants: {
    actor: ['tool.shared', 'tool.actor', 'tool.read', 'tool.read'],
    notebook: ['tool.write', 'tool.shared', 'tool.notebook'],
    profile: ['tool.shared', 'tool.read', 'tool.profile'],
    channel: ['tool.read', 'tool.shared', 'tool.channel'],
    environment: ['tool.write', 'tool.shared', 'tool.environment'],
  },
  approvedCapabilities: ['tool.write', 'tool.shared', 'tool.actor'],
  channel: 'web',
  environment: 'test',
});

describe('Tool Policy Resolver', () => {
  it('五个授权维度分别与available交集且审批只保留最终五维交集', () => {
    expect(resolveToolPolicy(sharedInput())).toEqual({
      capabilities: {
        actor: ['tool.read', 'tool.shared'],
        notebook: ['tool.shared', 'tool.write'],
        profile: ['tool.read', 'tool.shared'],
        channel: ['tool.read', 'tool.shared'],
        environment: ['tool.shared', 'tool.write'],
      },
      approvedCapabilities: ['tool.shared'],
      channel: 'web',
      environment: 'test',
    });
  });

  it('requested channel只能收窄，恶意请求available外或未授权能力不能增权', () => {
    const input = sharedInput();
    const resolved = resolveToolPolicy({
      ...input,
      requestedChannelCapabilities: [
        'tool.write',
        'tool.remote',
        'tool.shared',
      ],
    });

    expect(resolved?.capabilities).toEqual({
      actor: ['tool.read', 'tool.shared'],
      notebook: ['tool.shared', 'tool.write'],
      profile: ['tool.read', 'tool.shared'],
      channel: ['tool.shared'],
      environment: ['tool.shared', 'tool.write'],
    });
    expect(resolved?.approvedCapabilities).toEqual(['tool.shared']);
  });

  it('输入顺序和重复项不影响稳定输出', () => {
    const first = resolveToolPolicy(sharedInput());
    const reordered = sharedInput();
    reordered.availableCapabilities = [
      'tool.shared',
      'tool.read',
      'tool.write',
    ];
    reordered.grants = {
      actor: ['tool.read', 'tool.shared'],
      notebook: ['tool.shared', 'tool.write', 'tool.write'],
      profile: ['tool.read', 'tool.shared'],
      channel: ['tool.shared', 'tool.read'],
      environment: ['tool.shared', 'tool.write'],
    };
    reordered.approvedCapabilities = [
      'tool.actor',
      'tool.shared',
      'tool.write',
    ];

    expect(resolveToolPolicy(reordered)).toEqual(first);
  });

  it('空维与空available返回合法空授权策略', () => {
    const emptyDimension = sharedInput();
    emptyDimension.grants = { ...emptyDimension.grants, notebook: [] };
    expect(resolveToolPolicy(emptyDimension)).toMatchObject({
      capabilities: { notebook: [] },
      approvedCapabilities: [],
    });

    const emptyAvailable = sharedInput();
    emptyAvailable.availableCapabilities = [];
    expect(resolveToolPolicy(emptyAvailable)).toMatchObject({
      capabilities: {
        actor: [],
        notebook: [],
        profile: [],
        channel: [],
        environment: [],
      },
      approvedCapabilities: [],
    });
  });

  it('空requested channel是显式拒绝全部channel能力', () => {
    expect(
      resolveToolPolicy({
        ...sharedInput(),
        requestedChannelCapabilities: [],
      }),
    ).toMatchObject({
      capabilities: { channel: [] },
      approvedCapabilities: [],
    });
  });

  it.each([
    null,
    {},
    { ...sharedInput(), grants: { actor: [] } },
    {
      ...sharedInput(),
      grants: { ...sharedInput().grants, profile: ['Tool.Admin'] },
    },
    { ...sharedInput(), requestedChannelCapabilities: 'tool.read' },
    { ...sharedInput(), channel: ' web ' },
    { ...sharedInput(), environment: 'test environment' },
    {
      ...sharedInput(),
      availableCapabilities: Array.from(
        { length: 257 },
        (_, index) => `tool.${index}`,
      ),
    },
    { ...sharedInput(), approvedCapabilities: [`tool.${'x'.repeat(60)}`] },
    { ...sharedInput(), credentialHandle: 42 },
    { ...sharedInput(), credentialHandle: 'x'.repeat(257) },
  ])('缺失或非法运行时输入fail closed: %#', (input) => {
    expect(
      resolveToolPolicy(input as unknown as ToolPolicyResolverInput),
    ).toBeNull();
  });

  it('只透传服务端输入的执行元数据且不改变原输入', () => {
    const profileContext = { studentId: 'student:1' };
    const input = {
      ...sharedInput(),
      profileContext,
      credentialHandle: 'credential:1',
    };
    const snapshot = structuredClone(input);

    expect(resolveToolPolicy(input)).toMatchObject({
      profileContext,
      credentialHandle: 'credential:1',
    });
    expect(input).toEqual(snapshot);
  });
});
