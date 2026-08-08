import { describe, expect, it } from 'vitest';
import { buildTurnRequest } from '../src/renderer/src/turn-request';

describe('buildTurnRequest', () => {
  it('生成 clientMessageId 并 trim 文本', () => {
    const req = buildTurnRequest('  新建物理笔记本  ');
    expect(req).not.toBeNull();
    expect(req!.text).toBe('新建物理笔记本');
    expect(req!.clientMessageId).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it('空白指令返回 null', () => {
    expect(buildTurnRequest('   ')).toBeNull();
  });

  it('超过 2048 字节返回 null（与后端 MAX_TEXT_BYTES 一致）', () => {
    expect(buildTurnRequest('x'.repeat(2049))).toBeNull();
  });
});
