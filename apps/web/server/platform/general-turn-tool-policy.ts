import 'server-only';

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

export interface ResolveWebGeneralToolPolicyInput {
  /** ToolKernel 中本次实际注册且对当前 Actor 可用的 capability。 */
  availableCapabilities: readonly string[];
  /** 服务端主体授权，不接受浏览器 capability manifest。 */
  actorCapabilities: readonly string[];
  /** 只来自 GatewayResolvedRoute。 */
  membershipRole: NotebookMembershipRole;
  /** 只来自 Conversation 权威行。 */
  profileId: string;
  /** 只供服务端配置收窄 Web 工具，不得传 transport/render manifest。 */
  requestedChannelCapabilities?: readonly string[];
  /** 只来自耐久审批账本，并仍需经过最终交集。 */
  approvedCapabilities?: readonly string[];
  channel: string;
  environment: string;
  /** 当前部署实际启用的 Adapter capability。 */
  environmentCapabilities: readonly string[];
}

/**
 * 将 Web General 的可信路由、环境和 Adapter 事实投影到共享 Tool Policy Resolver。
 * transport/render manifest 不是 Tool grant；未知 Profile、入口或环境一律 fail closed。
 */
export function resolveWebGeneralToolPolicy(
  input: ResolveWebGeneralToolPolicyInput,
): TurnApplicationToolPolicy {
  const trustedShape =
    input.channel === 'web' &&
    deploymentEnvironments.has(input.environment) &&
    input.profileId === 'general';
  const availableCapabilities = trustedShape ? input.availableCapabilities : [];
  const memberMayUseTools = ['owner', 'editor', 'contributor'].includes(
    input.membershipRole,
  );
  const allOrEmpty = (allowed: boolean) =>
    allowed && trustedShape ? availableCapabilities : [];
  const resolved = resolveToolPolicy({
    availableCapabilities,
    grants: {
      actor: trustedShape ? input.actorCapabilities : [],
      notebook: allOrEmpty(memberMayUseTools),
      profile: allOrEmpty(true),
      channel: allOrEmpty(true),
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
