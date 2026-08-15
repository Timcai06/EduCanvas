import { describe, expect, it } from 'vitest';
import {
  serializeSafeError,
  safeJsonValue,
  stringifyRecord,
} from './safe-error.js';

describe('serializeSafeError', () => {
  it('从 Error 提取 name/message', () => {
    const payload = serializeSafeError(new Error('模型服务超时'));
    expect(payload.name).toBe('Error');
    expect(payload.message).toBe('模型服务超时');
  });

  it('提取 code 与 retryable 字段', () => {
    const error = Object.assign(new Error('超时'), {
      code: 'MODEL_PROVIDER_TIMEOUT',
      retryable: true,
    });
    const payload = serializeSafeError(error);
    expect(payload.code).toBe('MODEL_PROVIDER_TIMEOUT');
    expect(payload.retryable).toBe(true);
  });

  it('unknown 值返回兜底载荷且不抛', () => {
    expect(serializeSafeError(undefined).message).toBe('undefined');
    expect(serializeSafeError('boom').message).toBe('boom');
    expect(serializeSafeError(null).message).toBe('null');
  });

  it('从不泄漏堆栈', () => {
    const payload = serializeSafeError(new Error('boom'));
    expect(JSON.stringify(payload)).not.toContain('at ');
    expect(JSON.stringify(payload)).not.toContain('stack');
  });

  it('超长 message 被截断', () => {
    const payload = serializeSafeError(new Error('x'.repeat(5_000)));
    expect(payload.message.length).toBeLessThan(2_000);
  });

  it('多行 message 归一化为单行', () => {
    const payload = serializeSafeError(new Error('第一行\n第二行\n\n第三行'));
    expect(payload.message).not.toContain('\n');
  });
});

describe('safeJsonValue', () => {
  it('循环引用不崩溃', () => {
    const circular: Record<string, unknown> = { name: 'loop' };
    circular.self = circular;
    const result = safeJsonValue({ circular });
    expect(JSON.stringify(result)).toContain('[circular]');
  });

  it('限制对象深度', () => {
    const deep = { a: { b: { c: { d: { e: { f: 'x' } } } } } };
    const result = safeJsonValue(deep, { maxDepth: 3 }) as Record<
      string,
      unknown
    >;
    expect(JSON.stringify(result)).toContain('[depth-limited]');
  });

  it('限制数组长度', () => {
    const result = safeJsonValue(
      Array.from({ length: 500 }, (_, i) => i),
      {
        maxArrayItems: 5,
      },
    );
    expect(Array.isArray(result)).toBe(true);
    expect((result as unknown[]).length).toBe(6); // 5 + 省略标记
  });

  it('BigInt 与 Symbol 不崩溃', () => {
    expect(() =>
      safeJsonValue({ big: BigInt(123), sym: Symbol('s'), fn: () => 1 }),
    ).not.toThrow();
  });

  it('Error 对象转为安全载荷', () => {
    const result = safeJsonValue(new Error('nested')) as Record<
      string,
      unknown
    >;
    expect(result.message).toBe('nested');
  });

  it('Date 序列化为 ISO 字符串', () => {
    const result = safeJsonValue({ at: new Date(0) }) as Record<
      string,
      unknown
    >;
    expect(result.at).toBe('1970-01-01T00:00:00.000Z');
  });

  it('异常 getter 不崩溃', () => {
    const evil: Record<string, unknown> = {};
    Object.defineProperty(evil, 'boom', {
      enumerable: true,
      get() {
        throw new Error('getter failed');
      },
    });
    const result = safeJsonValue(evil) as Record<string, unknown>;
    expect(result.boom).toBe('[unreadable]');
  });
});

describe('stringifyRecord', () => {
  it('输出单行合法 JSON', () => {
    const line = stringifyRecord({ a: 1, b: '中' });
    expect(() => JSON.parse(line)).not.toThrow();
    expect(line).not.toContain('\n');
  });

  it('BigInt 记录不崩溃且回退为最小记录', () => {
    const line = stringifyRecord({ big: BigInt(1) });
    expect(JSON.parse(line).schema).toBe('educanvas.log.v1');
  });
});
