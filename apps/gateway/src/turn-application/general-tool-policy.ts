import {
  resolveToolPolicy,
  type TurnApplicationToolPolicy,
} from '@educanvas/agent-runtime';
import type { NotebookMembershipRole } from '@educanvas/gateway-core';

const deploymentEnvironments = new Set([
  'local',
  'development',
  'shared-dev',
  'test',
  'staging',
  'production',
]);
const entrypoints = new Set(['web', 'tui', 'channel', 'system']);

export interface ResolveGatewayGeneralToolPolicyInput {
  /** ToolKernel 中本次实际注册且可用的 Adapter capability。 */
  availableCapabilities: readonly string[];
  /** 服务端主体授权：全局 MCP 加当前 actor 私人 Node 的实时能力。 */
  actorCapabilities: readonly string[];
  /** 只来自 GatewayResolvedRoute，不接受入口自报。 */
  membershipRole: NotebookMembershipRole;
  /** 只来自 Conversation 的服务端 Profile 真值。 */
  profileId: string;
  /** 只供服务端入口配置进一步收窄，不能传 transport/render manifest。 */
  requestedChannelCapabilities?: readonly string[];
  /** 只来自耐久审批账本，仍须通过最终五维交集。 */
  approvedCapabilities?: readonly string[];
  channel: string;
  environment: string;
  /** 当前部署实际启用的 Adapter capability。 */
  environmentCapabilities: readonly string[];
}

/**
 * 将 Gateway General 的五类服务端事实投影到共享 Tool Policy Resolver。
 * transport/render capability 会被显式忽略；未知入口、环境和工具能力 fail closed。
 */
export function resolveGatewayGeneralToolPolicy(
  input: ResolveGatewayGeneralToolPolicyInput,
): TurnApplicationToolPolicy {
  const trustedShape =
    entrypoints.has(input.channel) &&
    deploymentEnvironments.has(input.environment) &&
    input.profileId === 'general';
  const availableCapabilities = trustedShape ? input.availableCapabilities : [];
  const memberMayUseTools = ['owner', 'editor', 'contributor'].includes(
    input.membershipRole,
  );
  const entrypointMayUseTools =
    input.channel === 'web' || input.channel === 'tui';
  const allOrEmpty = (allowed: boolean) =>
    allowed && trustedShape ? availableCapabilities : [];

  const resolved = resolveToolPolicy({
    availableCapabilities,
    grants: {
      actor: trustedShape ? input.actorCapabilities : [],
      notebook: allOrEmpty(memberMayUseTools),
      profile: allOrEmpty(true),
      channel: allOrEmpty(entrypointMayUseTools),
      environment: trustedShape ? input.environmentCapabilities : [],
    },
    ...(input.requestedChannelCapabilities === undefined
      ? {}
      : {
          requestedChannelCapabilities: input.requestedChannelCapabilities,
        }),
    approvedCapabilities: input.approvedCapabilities ?? [],
    channel: input.channel,
    environment: input.environment,
  });

  return resolved ?? emptyPolicy(input.channel, input.environment);
}

function emptyPolicy(
  channel: string,
  environment: string,
): TurnApplicationToolPolicy {
  return {
    capabilities: {
      actor: [],
      notebook: [],
      profile: [],
      channel: [],
      environment: [],
    },
    approvedCapabilities: [],
    channel,
    environment,
  };
}
