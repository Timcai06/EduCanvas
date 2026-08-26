import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createCanvasSubmissionInput } from './canvas-submission';

describe('createCanvasSubmissionInput', () => {
  beforeEach(() => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(
      '11111111-1111-4111-8111-111111111111',
    );
  });

  it('只把代码文本加入不可信提交，不加入客户端判分结果', () => {
    expect(
      createCanvasSubmissionInput({
        type: 'code_completion_submitted',
        artifactId: 'code-1',
        payload: { source: 'print(1)' },
      }),
    ).toMatchObject({
      schemaVersion: '1',
      eventId: '11111111-1111-4111-8111-111111111111',
      artifactId: 'code-1',
      type: 'code_completion_submitted',
      payload: { source: 'print(1)' },
    });
  });
});
