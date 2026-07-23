import { toolPolicyDimensions, type ToolPolicyDimension } from './tool-kernel';
import type { TurnApplicationToolPolicy } from './turn-application';

const MAX_CAPABILITIES_PER_LIST = 256;
const MAX_CREDENTIAL_HANDLE_CHARACTERS = 256;
const CAPABILITY_PATTERN = /^[a-z][a-z0-9_.-]{0,63}$/;
const POLICY_LABEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;

export interface ToolPolicyResolverInput {
  /** 当前组合根实际注册且可用的能力；它是所有授权维度的共同上界。 */
  availableCapabilities: readonly string[];
  /** 五维授权必须来自完成身份、所有权与环境校验的可信服务端来源。 */
  grants: Readonly<Record<ToolPolicyDimension, readonly string[]>>;
  /** 不可信入口只能收窄channel维，不能向其他维度或available集合增权。 */
  requestedChannelCapabilities?: readonly string[];
  /** 已完成审批的能力仍须通过available与最终五维交集。 */
  approvedCapabilities?: readonly string[];
  channel: string;
  environment: string;
  profileContext?: Readonly<Record<string, unknown>>;
  credentialHandle?: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCapabilityList(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.length <= MAX_CAPABILITIES_PER_LIST &&
    value.every(
      (capability) =>
        typeof capability === 'string' && CAPABILITY_PATTERN.test(capability),
    )
  );
}

function isPolicyLabel(value: unknown): value is string {
  return typeof value === 'string' && POLICY_LABEL_PATTERN.test(value);
}

function canonicalIntersection(
  values: readonly string[],
  allowed: ReadonlySet<string>,
): readonly string[] {
  return Object.freeze(
    [...new Set(values.filter((value) => allowed.has(value)))].sort(),
  );
}

function validateInput(value: unknown): value is ToolPolicyResolverInput {
  if (!isRecord(value)) return false;
  const grants = value.grants;
  if (!isRecord(grants)) return false;
  if (
    !isCapabilityList(value.availableCapabilities) ||
    !isPolicyLabel(value.channel) ||
    !isPolicyLabel(value.environment) ||
    (value.requestedChannelCapabilities !== undefined &&
      !isCapabilityList(value.requestedChannelCapabilities)) ||
    (value.approvedCapabilities !== undefined &&
      !isCapabilityList(value.approvedCapabilities)) ||
    (value.profileContext !== undefined && !isRecord(value.profileContext)) ||
    (value.credentialHandle !== undefined &&
      value.credentialHandle !== null &&
      (typeof value.credentialHandle !== 'string' ||
        value.credentialHandle.length === 0 ||
        value.credentialHandle.length > MAX_CREDENTIAL_HANDLE_CHARACTERS))
  ) {
    return false;
  }
  return toolPolicyDimensions.every((dimension) =>
    isCapabilityList(grants[dimension]),
  );
}

/**
 * 纯函数地解析Turn Application工具策略。
 *
 * 信任边界：`availableCapabilities`与`grants`必须由服务端组合根提供；入口请求
 * 只能通过`requestedChannelCapabilities`收窄channel维。返回策略的每一维都不会
 * 超过available，审批集合也不会超过最终五维交集。缺维或非法运行时形状返回
 * `null`；合法空维/空交集保留为空策略，使Kernel自然不暴露任何工具。
 *
 * 单个能力列表最多256项，能力名沿用Tool Adapter的64字符格式，避免不可信入口
 * 用无界列表放大排序与集合计算成本。
 */
export function resolveToolPolicy(
  input: ToolPolicyResolverInput,
): TurnApplicationToolPolicy | null {
  const candidate: unknown = input;
  if (!validateInput(candidate)) return null;

  const available = new Set(candidate.availableCapabilities);
  const requestedChannel =
    candidate.requestedChannelCapabilities === undefined
      ? null
      : new Set(candidate.requestedChannelCapabilities);
  const capabilities = Object.fromEntries(
    toolPolicyDimensions.map((dimension) => {
      const dimensionAvailable = canonicalIntersection(
        candidate.grants[dimension],
        available,
      );
      return [
        dimension,
        dimension === 'channel' && requestedChannel
          ? canonicalIntersection(dimensionAvailable, requestedChannel)
          : dimensionAvailable,
      ];
    }),
  ) as Record<ToolPolicyDimension, readonly string[]>;

  const effective = toolPolicyDimensions.reduce<Set<string>>(
    (intersection, dimension) =>
      new Set(
        capabilities[dimension].filter((capability) =>
          intersection.has(capability),
        ),
      ),
    new Set(available),
  );
  const approvedCapabilities = canonicalIntersection(
    candidate.approvedCapabilities ?? [],
    effective,
  );

  return Object.freeze({
    capabilities: Object.freeze(capabilities),
    approvedCapabilities,
    channel: candidate.channel,
    environment: candidate.environment,
    ...(candidate.profileContext === undefined
      ? {}
      : { profileContext: candidate.profileContext }),
    ...(candidate.credentialHandle === undefined
      ? {}
      : { credentialHandle: candidate.credentialHandle }),
  });
}
