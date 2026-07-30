import { describe, expect, it } from 'vitest';
import { normalizeStudentMessageContent } from './chat-repository';

describe('对话发送幂等规范', () => {
  it.each([
    {
      name: '统一NFC、CRLF和整段首尾空白',
      input: '  Cafe\u0301\r\n\r第二  行  ',
      expected: 'Café\n\n第二  行',
    },
    {
      name: '把单独CR统一为LF',
      input: '第一段\r第二段',
      expected: '第一段\n第二段',
    },
    {
      name: '保留段内连续空格和空行',
      input: '第一  行\n\n\n第二行',
      expected: '第一  行\n\n\n第二行',
    },
    {
      name: '空白消息归一化为空字符串',
      input: ' \r\n\t ',
      expected: '',
    },
    {
      name: '已规范文本保持不变',
      input: '函数 📐\n第二段',
      expected: '函数 📐\n第二段',
    },
  ])('$name', ({ input, expected }) => {
    expect(normalizeStudentMessageContent(input)).toBe(expected);
  });
});
