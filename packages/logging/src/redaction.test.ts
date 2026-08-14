import { describe, expect, it } from 'vitest';
import { redact, redactString } from './redaction.js';

describe('redactString', () => {
  it('脱敏 URL 内嵌凭据', () => {
    expect(redactString('postgresql://user:secret@127.0.0.1:5432/db')).toBe(
      'postgresql://[REDACTED]@127.0.0.1:5432/db',
    );
  });

  it('脱敏 KEY=value 形态敏感键值', () => {
    expect(redactString('DATABASE_URL=postgres://u:p@h/db ok')).toContain(
      'DATABASE_URL=[REDACTED]',
    );
    expect(redactString('api_key=abc123')).toBe('api_key=[REDACTED]');
    expect(redactString('Authorization=Bearer xyz')).toBe(
      'Authorization=[REDACTED]',
    );
  });

  it('不误伤普通键值', () => {
    expect(redactString('port=3200&route=client.turns')).toContain('port=3200');
    expect(redactString('count=42')).toBe('count=42');
  });
});

describe('redact', () => {
  it('递归脱敏敏感键', () => {
    const result = redact({
      name: 'demo',
      credentials: { password: 'p@ss', user: 'tim' },
      nested: { DATABASE_URL: 'postgres://u:p@h/db' },
    }) as Record<string, unknown>;
    // credentials 整体命中 credential 敏感模式，直接整体替换。
    expect(result.credentials).toBe('[REDACTED]');
    expect((result.nested as Record<string, unknown>).DATABASE_URL).toBe(
      '[REDACTED]',
    );
    expect(result.name).toBe('demo');
  });

  it('字符串内嵌 URL 凭据被清洗', () => {
    const result = redact({ url: 'postgres://user:pass@host/db' }) as Record<
      string,
      unknown
    >;
    expect(result.url).toContain('[REDACTED]@');
    expect(result.url).not.toContain('pass@');
  });

  it('循环引用不崩溃', () => {
    const loop: Record<string, unknown> = { x: 1 };
    loop.self = loop;
    const result = redact(loop) as Record<string, unknown>;
    expect(result.self).toBe('[circular]');
  });

  it('长度与深度限制生效', () => {
    const result = redact({ long: 'y'.repeat(5_000) }) as Record<
      string,
      unknown
    >;
    expect(String(result.long)).toContain('[truncated]');
  });

  it('Prompt 与正文键被整体替换', () => {
    const result = redact({
      prompt: '写一篇作文',
      message: '正文内容',
    }) as Record<string, unknown>;
    expect(result.prompt).toBe('[REDACTED]');
    expect(result.message).toBe('正文内容');
  });
});
