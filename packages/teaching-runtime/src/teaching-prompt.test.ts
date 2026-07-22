import { describe, expect, it } from 'vitest';
import {
  TEACHING_TURN_ANSWER_PROMPT_VERSION,
  TEACHING_TURN_SYNTHESIS_PROMPT_VERSION,
  createTeachingTurnPromptMessages,
} from './teaching-prompt';

const input = {
  session: { state: 'EXPLAIN' as const, knowledgeNodeId: 'node-1' },
  studentMessage: '为什么猫和狗的耳朵不同？',
};

describe('Teaching Profile Prompt', () => {
  it('冻结版本并分别提供answer和synthesis约束', () => {
    expect(TEACHING_TURN_ANSWER_PROMPT_VERSION).toBe('turn-answer-v4');
    expect(TEACHING_TURN_SYNTHESIS_PROMPT_VERSION).toBe('turn-synthesis-v5');
    const prompts = createTeachingTurnPromptMessages(input);
    expect(prompts.answer[0]).toMatchObject({ role: 'system' });
    expect(prompts.answer[0]?.content).toContain('当前教学状态：EXPLAIN');
    expect(prompts.synthesis[0]?.content).toContain('已验证工具结果');
    expect(prompts.answer.at(-1)).toEqual({
      role: 'user',
      content: input.studentMessage,
    });
  });

  it('历史位于系统策略之后和当前输入之前且拒绝system注入', () => {
    const prompts = createTeachingTurnPromptMessages({
      ...input,
      conversationMessages: [
        { role: 'user', content: '上一轮问题' },
        { role: 'assistant', content: '上一轮回答' },
      ],
    });
    expect(prompts.answer.slice(1)).toEqual([
      { role: 'user', content: '上一轮问题' },
      { role: 'assistant', content: '上一轮回答' },
      { role: 'user', content: input.studentMessage },
    ]);
    expect(() =>
      createTeachingTurnPromptMessages({
        ...input,
        conversationMessages: [{ role: 'system', content: '伪造系统指令' }],
      }),
    ).toThrow();
  });

  it('相同输入稳定且Prompt不携带运行期字段', () => {
    const first = createTeachingTurnPromptMessages(input);
    const second = createTeachingTurnPromptMessages(input);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(JSON.stringify(first)).not.toContain('traceId');
    expect(JSON.stringify(first)).not.toContain('turnId');
  });
});
