import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Telegram adapter boundary', () => {
  // 边界测试：Telegram 适配器只允许纯协议层依赖，防止外部 SDK 侵入 domain 客户端/网关逻辑。
  it('depends on Gateway contracts, not DB, Runtime or Telegram SDKs', () => {
    const source = readFileSync(
      new URL('./adapter.ts', import.meta.url),
      'utf8',
    );
    expect(source).not.toContain('@educanvas/db');
    expect(source).not.toContain('@educanvas/agent-runtime');
    expect(source).not.toContain('node-telegram-bot-api');
    expect(source).not.toContain('telegraf');
  });
});
