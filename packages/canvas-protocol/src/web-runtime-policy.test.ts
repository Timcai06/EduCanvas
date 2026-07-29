import { describe, expect, it } from 'vitest';
import {
  validateWebRuntimePolicy,
  webRuntimePolicy,
} from './web-runtime-policy';

function policyRequest() {
  return {
    dependencies: webRuntimePolicy.dependencyAllowlist.map((dependency) => ({
      ...dependency,
    })),
    limits: { ...webRuntimePolicy.limits },
    network: webRuntimePolicy.network,
    iframeSandbox: webRuntimePolicy.iframeSandbox,
    csp: webRuntimePolicy.csp,
  };
}

describe('validateWebRuntimePolicy', () => {
  it('R01: 只接受不含同源权限的 allow-scripts iframe', () => {
    expect(
      validateWebRuntimePolicy({
        ...policyRequest(),
        iframeSandbox: 'allow-scripts allow-same-origin',
      }),
    ).toEqual({ ok: false, reason: 'runtime_policy_sandbox_not_allowed' });
  });

  it('R03-R04: 固定 CSP 和 network=none，不接受联网或远程脚本通道', () => {
    expect(
      validateWebRuntimePolicy({ ...policyRequest(), network: 'allowlist' }),
    ).toEqual({ ok: false, reason: 'runtime_policy_network_not_allowed' });
    expect(
      validateWebRuntimePolicy({
        ...policyRequest(),
        csp: "default-src 'none'; connect-src https:",
      }),
    ).toEqual({ ok: false, reason: 'runtime_policy_csp_not_allowed' });
  });

  it('R10: 把消息速率和队列深度作为固定资源门禁', () => {
    expect(
      validateWebRuntimePolicy({
        ...policyRequest(),
        limits: { ...webRuntimePolicy.limits, maxMessagesPerSecond: 31 },
      }),
    ).toEqual({
      ok: false,
      reason: 'runtime_policy_resource_limit_exceeded',
    });
    expect(
      validateWebRuntimePolicy({
        ...policyRequest(),
        limits: { ...webRuntimePolicy.limits, maxQueueDepth: 9 },
      }),
    ).toEqual({
      ok: false,
      reason: 'runtime_policy_resource_limit_exceeded',
    });
  });

  it('R13-R14: 拒绝输入、消息、输出和时长超限', () => {
    for (const key of [
      'maxInputBytes',
      'maxMessageBytes',
      'maxOutputBytes',
      'maxDurationMs',
    ] as const) {
      expect(
        validateWebRuntimePolicy({
          ...policyRequest(),
          limits: {
            ...webRuntimePolicy.limits,
            [key]: webRuntimePolicy.limits[key] + 1,
          },
        }),
      ).toEqual({
        ok: false,
        reason: 'runtime_policy_resource_limit_exceeded',
      });
    }
  });

  it('R21-R22: 仅接受无重复的精确已锁定 name+version', () => {
    expect(
      validateWebRuntimePolicy({
        ...policyRequest(),
        dependencies: [
          { name: 'react', version: '19.2.7' },
          { name: 'react', version: '19.2.7' },
        ],
      }),
    ).toEqual({ ok: false, reason: 'runtime_policy_dependency_duplicate' });
    for (const version of [
      '^19.2.7',
      '~19.2.7',
      'latest',
      'https://evil.example/react.js',
    ]) {
      const result = validateWebRuntimePolicy({
        ...policyRequest(),
        dependencies: [{ name: 'react', version }],
      });
      expect(result).toEqual({
        ok: false,
        reason: 'runtime_policy_dependency_version_not_allowed',
      });
      expect(JSON.stringify(result)).not.toContain(version);
    }
    const typoResult = validateWebRuntimePolicy({
      ...policyRequest(),
      dependencies: [{ name: 'react-domm', version: '19.2.7' }],
    });
    expect(typoResult).toEqual({
      ok: false,
      reason: 'runtime_policy_dependency_not_allowed',
    });
    expect(JSON.stringify(typoResult)).not.toContain('react-domm');
  });

  it('拒绝超长依赖字段且不回显', () => {
    const result = validateWebRuntimePolicy({
      ...policyRequest(),
      dependencies: [{ name: 'react'.repeat(33), version: '19.2.7' }],
    });
    expect(result).toEqual({
      ok: false,
      reason: 'runtime_policy_schema_invalid',
    });
    expect(JSON.stringify(result)).not.toContain('reactreact');
  });

  it('严格拒绝额外字段、无效资源值且不回显输入', () => {
    const result = validateWebRuntimePolicy({
      ...policyRequest(),
      secret: 'do-not-return-this',
    });
    expect(result).toEqual({
      ok: false,
      reason: 'runtime_policy_schema_invalid',
    });
    expect(JSON.stringify(result)).not.toContain('do-not-return-this');
    for (const value of [0, -1, Infinity, 1.5]) {
      expect(
        validateWebRuntimePolicy({
          ...policyRequest(),
          limits: { ...webRuntimePolicy.limits, maxQueueDepth: value },
        }),
      ).toEqual({
        ok: false,
        reason: 'runtime_policy_resource_limit_invalid',
      });
    }
  });

  it('向调用方返回的策略边界不可变', () => {
    expect(Object.isFrozen(webRuntimePolicy)).toBe(true);
    expect(Object.isFrozen(webRuntimePolicy.dependencyAllowlist)).toBe(true);
    expect(Object.isFrozen(webRuntimePolicy.dependencyAllowlist[0])).toBe(true);
    expect(Object.isFrozen(webRuntimePolicy.limits)).toBe(true);

    const result = validateWebRuntimePolicy(policyRequest());
    expect(result).toEqual({ ok: true, policy: webRuntimePolicy });
    if (result.ok) {
      expect(Object.isFrozen(result.policy)).toBe(true);
    }
  });
});
