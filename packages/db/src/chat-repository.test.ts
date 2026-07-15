import { describe, expect, it } from 'vitest';
import {
  hashStudentMessageContent,
  normalizeStudentMessageContent,
} from './chat-repository';

describe('对话发送幂等规范', () => {
  it('统一NFC、换行和整段首尾空白，但保留段内结构', () => {
    expect(normalizeStudentMessageContent('  Cafe\u0301\r\n\r第二  行  ')).toBe(
      'Café\n\n第二  行',
    );
  });

  it('等价正文生成相同SHA-256，段内差异不被吞掉', () => {
    expect(hashStudentMessageContent(' Café\r\n问题 ')).toBe(
      hashStudentMessageContent('Cafe\u0301\n问题'),
    );
    expect(hashStudentMessageContent('a  b')).not.toBe(
      hashStudentMessageContent('a b'),
    );
    expect(hashStudentMessageContent('test')).toMatch(/^[0-9a-f]{64}$/);
  });
});
