import { describe, expect, it } from 'vitest';
import {
  canvasOpenedMessage,
  gradedMessage,
  initialTeacherMessages,
  replyToStudent,
} from './demo-teacher-script';

describe('demo-teacher-script', () => {
  it('开场白包含问候与打开演示的建议', () => {
    const messages = initialTeacherMessages();
    expect(messages.length).toBeGreaterThanOrEqual(2);
    expect(messages.at(-1)?.suggestsCanvas).toBe(true);
  });

  it('学生要求演示且Canvas未打开时给出建议卡', () => {
    const replies = replyToStudent('我想看看演示', {
      canvasOpen: false,
      replyCount: 0,
    });
    expect(replies.some((message) => message.suggestsCanvas)).toBe(true);
  });

  it('Canvas已打开时要求演示不再重复建议', () => {
    const replies = replyToStudent('再试试演示', {
      canvasOpen: true,
      replyCount: 0,
    });
    expect(replies.every((message) => !message.suggestsCanvas)).toBe(true);
  });

  it('默认回复按轮次确定性轮换', () => {
    const first = replyToStudent('嗯', { canvasOpen: false, replyCount: 0 });
    const again = replyToStudent('嗯', { canvasOpen: false, replyCount: 3 });
    expect(first[0]?.text).toBe(again[0]?.text);
    const second = replyToStudent('嗯', { canvasOpen: false, replyCount: 1 });
    expect(second[0]?.text).not.toBe(first[0]?.text);
  });

  it('判分反馈只复述服务端数字，不自行判断对错', () => {
    expect(gradedMessage(2, 2).text).toContain('全部分类正确');
    expect(gradedMessage(1, 2).text).toContain('1/2');
  });

  it('演示打开承接语附带产物卡片', () => {
    expect(canvasOpenedMessage().outputCard).toBe(true);
  });
});
