import { describe, expect, it } from 'vitest';
import { normalizeStudentMessageContent } from './chat-repository';

describe('对话发送幂等规范', () => {
  it('统一NFC、换行和整段首尾空白，但保留段内结构', () => {
    expect(normalizeStudentMessageContent('  Cafe\u0301\r\n\r第二  行  ')).toBe(
      'Café\n\n第二  行',
    );
  });
});
