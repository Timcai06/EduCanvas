import { describe, expect, it } from 'vitest';
import { mapAiSdkFinish } from './ai-sdk-protocol';

describe('AI SDK output limit', () => {
  it('does not retry the same capped request', () => {
    expect(mapAiSdkFinish('length')).toEqual({
      finishReason: 'length',
      failure: { code: 'output_limit', retryable: false },
    });
  });
});
