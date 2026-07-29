import { z } from 'zod';

const MEBIBYTE = 1024 * 1024;

type DeepReadonly<T> = T extends readonly (infer Item)[]
  ? readonly DeepReadonly<Item>[]
  : T extends object
    ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
    : T;

/**
 * 持久 Web Runtime 的受控依赖与资源门禁。
 *
 * 该模块刻意不经包入口导出：在 U12 接入前，它只能由明确选择此私有策略的
 * 组合层使用，不能被误当成所有 CanvasResource 的通用运行时能力。
 */
export const webRuntimePolicy = deepFreeze({
  dependencyAllowlist: [
    { name: 'react', version: '19.2.7' },
    { name: 'react-dom', version: '19.2.7' },
    { name: 'gsap', version: '3.15.0' },
    { name: 'three', version: '0.185.1' },
  ],
  limits: {
    maxInputBytes: 512 * 1024,
    maxMessageBytes: 64 * 1024,
    maxOutputBytes: MEBIBYTE,
    maxDurationMs: 30_000,
    maxConcurrentInstances: 2,
    maxQueueDepth: 8,
    maxMessagesPerSecond: 30,
  },
  network: 'none',
  iframeSandbox: 'allow-scripts',
  csp: [
    "default-src 'none'",
    "connect-src 'none'",
    "frame-src 'none'",
    "child-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    "object-src 'none'",
    "worker-src 'none'",
    "manifest-src 'none'",
    "script-src 'unsafe-inline' blob:",
    "style-src 'unsafe-inline'",
    'img-src data: blob:',
    'font-src data:',
    'media-src data: blob:',
  ].join('; '),
});

export type WebRuntimePolicy = typeof webRuntimePolicy;

export const webRuntimePolicyErrorCodes = [
  'runtime_policy_schema_invalid',
  'runtime_policy_dependency_duplicate',
  'runtime_policy_dependency_not_allowed',
  'runtime_policy_dependency_version_not_allowed',
  'runtime_policy_network_not_allowed',
  'runtime_policy_sandbox_not_allowed',
  'runtime_policy_csp_not_allowed',
  'runtime_policy_resource_limit_invalid',
  'runtime_policy_resource_limit_exceeded',
] as const;

export type WebRuntimePolicyErrorCode =
  (typeof webRuntimePolicyErrorCodes)[number];

export type WebRuntimePolicyValidation =
  | { ok: true; policy: WebRuntimePolicy }
  | { ok: false; reason: WebRuntimePolicyErrorCode };

const dependencySchema = z
  .object({
    name: z.string().min(1).max(128),
    version: z.string().min(1).max(64),
  })
  .strict();

const finiteOrInfiniteNumberSchema = z.number().or(z.literal(Infinity));

const policyRequestSchema = z
  .object({
    dependencies: z.array(dependencySchema).max(4),
    limits: z
      .object({
        maxInputBytes: finiteOrInfiniteNumberSchema,
        maxMessageBytes: finiteOrInfiniteNumberSchema,
        maxOutputBytes: finiteOrInfiniteNumberSchema,
        maxDurationMs: finiteOrInfiniteNumberSchema,
        maxConcurrentInstances: finiteOrInfiniteNumberSchema,
        maxQueueDepth: finiteOrInfiniteNumberSchema,
        maxMessagesPerSecond: finiteOrInfiniteNumberSchema,
      })
      .strict(),
    network: z.string(),
    iframeSandbox: z.string(),
    csp: z.string(),
  })
  .strict();

const exactVersion = /^\d+\.\d+\.\d+$/;

/**
 * 验证运行请求声明，不回显不可信输入，避免依赖名、URL 或调用方对象进入安全错误。
 */
export function validateWebRuntimePolicy(
  input: unknown,
): WebRuntimePolicyValidation {
  const parsed = policyRequestSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, reason: 'runtime_policy_schema_invalid' };
  }

  const request = parsed.data;
  const names = new Set<string>();
  for (const dependency of request.dependencies) {
    if (names.has(dependency.name)) {
      return { ok: false, reason: 'runtime_policy_dependency_duplicate' };
    }
    names.add(dependency.name);

    const allowed = webRuntimePolicy.dependencyAllowlist.find(
      ({ name }) => name === dependency.name,
    );
    if (!allowed) {
      return { ok: false, reason: 'runtime_policy_dependency_not_allowed' };
    }
    if (
      !exactVersion.test(dependency.version) ||
      dependency.version !== allowed.version
    ) {
      return {
        ok: false,
        reason: 'runtime_policy_dependency_version_not_allowed',
      };
    }
  }

  if (request.network !== webRuntimePolicy.network) {
    return { ok: false, reason: 'runtime_policy_network_not_allowed' };
  }
  if (request.iframeSandbox !== webRuntimePolicy.iframeSandbox) {
    return { ok: false, reason: 'runtime_policy_sandbox_not_allowed' };
  }
  if (request.csp !== webRuntimePolicy.csp) {
    return { ok: false, reason: 'runtime_policy_csp_not_allowed' };
  }

  for (const key of Object.keys(request.limits) as Array<
    keyof typeof webRuntimePolicy.limits
  >) {
    const value = request.limits[key];
    if (!Number.isSafeInteger(value) || value <= 0) {
      return { ok: false, reason: 'runtime_policy_resource_limit_invalid' };
    }
    if (value > webRuntimePolicy.limits[key]) {
      return { ok: false, reason: 'runtime_policy_resource_limit_exceeded' };
    }
  }

  return { ok: true, policy: webRuntimePolicy };
}

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) {
      deepFreeze(nested);
    }
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}
