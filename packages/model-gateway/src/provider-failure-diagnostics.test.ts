import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NormalizedModelError } from '@educanvas/agent-core';
import { errorForHttpResponse } from './openai-compatible-protocol';
import { logProviderFailure } from './provider-failure-diagnostics';
import type { ProviderFailureDiagnostic } from './provider-failure-diagnostics';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('safe Provider diagnostics', () => {
  it.each([400, 422])(
    'production HTTP %s 保留请求拒绝分类且不读取响应正文',
    (status) => {
      vi.stubEnv('NODE_ENV', 'production');
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const response = new Response('secret-provider-body', { status });
      const bodyReader = vi.spyOn(response, 'text');
      const normalized = errorForHttpResponse(response, Date.now());
      logProviderFailure('openai-compatible', normalized, response.status);
      expect(normalized).toEqual({
        code: 'invalid_response',
        retryable: false,
      });
      expect(bodyReader).not.toHaveBeenCalled();
      expect(JSON.parse(warn.mock.calls[0]![0])).toMatchObject({
        schema: 'educanvas.log.v1',
        level: 'warn',
        service: 'model-gateway',
        event: 'provider_request_rejected',
        status,
        normalizedCode: 'invalid_response',
        retryable: false,
      });
      expect(JSON.stringify(warn.mock.calls)).not.toContain(
        'secret-provider-body',
      );
    },
  );
  it('成功响应解析失败与HTTP请求拒绝有不同诊断', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    logProviderFailure('openai-compatible', {
      code: 'invalid_response',
      retryable: false,
    });
    expect(JSON.parse(warn.mock.calls[0]![0]).event).toBe(
      'provider_invalid_response',
    );
  });
  it('其他HTTP拒绝不会因旧归一化码被误记为响应解析失败', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    logProviderFailure(
      'dashscope',
      { code: 'invalid_response', retryable: false },
      401,
    );
    expect(JSON.parse(warn.mock.calls[0]![0])).toMatchObject({
      event: 'provider_unauthorized',
      failureClass: 'provider_failure',
      status: 401,
    });
  });
  it('未知provider、状态与错误属性不能泄漏原值', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    logProviderFailure(
      'secret-provider-url',
      {
        code: 'secret-error',
        retryable: false,
        body: 'secret-body',
        stack: 'secret-stack',
      } as unknown as NormalizedModelError,
      9999,
    );
    expect(JSON.parse(warn.mock.calls[0]![0])).toMatchObject({
      provider: 'unknown',
      normalizedCode: 'unknown',
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain('secret-');
    expect(JSON.parse(warn.mock.calls[0]![0])).not.toHaveProperty('status');
  });
  it('内部上下文也必须收敛到有限集合，格式合法的秘密不能进日志', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    logProviderFailure(
      'dashscope',
      { code: 'invalid_response', retryable: false },
      undefined,
      {
        capability: 'SECRET_CAPABILITY',
        stage: 'SECRET_STAGE',
        failureClass: 'SECRET_CLASS',
        providerErrorCode: 'SECRET_API_KEY',
        providerErrorType: 'SECRET_ERROR_TYPE',
        status: 99,
      } as unknown as ProviderFailureDiagnostic,
    );
    expect(JSON.parse(warn.mock.calls[0]![0])).toMatchObject({
      provider: 'dashscope',
      failureClass: 'response_invalid',
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain('SECRET_');
    expect(JSON.parse(warn.mock.calls[0]![0])).not.toHaveProperty('status');
  });
});
