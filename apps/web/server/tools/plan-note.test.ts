import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { createPlanNoteTool, planNoteModelInputSchema } from './plan-note';

describe('planNote', () => {
  it('模型侧仍声明一句短 note', () => {
    expect(planNoteModelInputSchema).toMatchObject({
      required: ['note'],
      additionalProperties: false,
      properties: { note: { type: 'string', maxLength: 200 } },
    });
  });

  it('本地容忍无副作用进度参数漂移，不让 Turn 因展示工具失败', async () => {
    const tool = createPlanNoteTool();
    for (const input of [
      { note: 'x'.repeat(2_000) },
      { progress: '先搜索再总结' },
      {},
    ]) {
      const parsed = tool.inputSchema.parse(input);
      await expect(
        tool.handler(parsed, {
          traceId: 'trace:1',
          turnId: 'turn:1',
          subjectId: 'user:1',
          conversationId: 'conversation:1',
          signal: new AbortController().signal,
        }),
      ).resolves.toEqual({ acknowledged: true });
    }
  });
});
