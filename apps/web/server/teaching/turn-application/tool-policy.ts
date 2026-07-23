import 'server-only';

import {
  resolveToolPolicy,
  type TurnApplicationToolPolicy,
} from '@educanvas/agent-runtime';
import type { NotebookMembershipRole } from '@educanvas/gateway-core';
import type { TeachingState } from '@educanvas/teaching-core';
import { teachingToolCapabilitiesForState } from '../teaching-tools';

const deploymentEnvironments = new Set([
  'local',
  'development',
  'shared-dev',
  'test',
  'staging',
  'production',
]);

export interface ResolveWebTeachingToolPolicyInput {
  /** ToolKernel 中实际注册的 Teaching Adapter capability。 */
  availableCapabilities: readonly string[];
  /** 服务端主体授权，不接受浏览器或 transport manifest。 */
  actorCapabilities: readonly string[];
  /** 只来自 GatewayResolvedRoute。 */
  membershipRole: NotebookMembershipRole;
  /** 只来自 Conversation 权威行。 */
  profileId: string;
  /** 只来自可信 Lesson Session 状态机。 */
  state: TeachingState;
  /** 只供服务端配置进一步收窄，不得传 transport/render manifest。 */
  requestedChannelCapabilities?: readonly string[];
  /** 只来自耐久审批账本，并仍需通过最终交集。 */
  approvedCapabilities?: readonly string[];
  channel: string;
  environment: string;
  /** 当前部署实际启用的 Teaching Adapter capability。 */
  environmentCapabilities: readonly string[];
  /** 只含已由会话与所有权边界校验的教学上下文标识。 */
  profileContext: Readonly<Record<string, unknown>>;
}

/**
 * 将 Web Teaching 的路由、教学状态与 Adapter 事实投影到共享 Tool Policy Resolver。
 * 教学状态白名单只收窄 Profile 维；未知 Profile、入口或环境一律 fail closed。
 */
export function resolveWebTeachingToolPolicy(
  input: ResolveWebTeachingToolPolicyInput,
): TurnApplicationToolPolicy {
  const trustedShape =
    input.channel === 'web' &&
    deploymentEnvironments.has(input.environment) &&
    input.profileId === 'k12.teacher';
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
      profile: trustedShape
        ? teachingToolCapabilitiesForState(input.state)
        : [],
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
    profileContext: input.profileContext,
  });

  return (
    resolved ??
    emptyPolicy(input.channel, input.environment, input.profileContext)
  );
}

function emptyPolicy(
  channel: string,
  environment: string,
  profileContext: Readonly<Record<string, unknown>>,
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
    profileContext,
  };
}
