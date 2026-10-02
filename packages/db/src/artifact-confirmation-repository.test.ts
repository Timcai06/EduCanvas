import { describe, expect, it } from 'vitest';
import {
  artifactConfirmationMessageId,
  isRetryableArtifactConfirmationFailure,
} from './artifact-confirmation-repository';

describe('artifact confirmation execution attempts', () => {
  it('keeps a stable key for duplicate submissions within one attempt', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    expect(artifactConfirmationMessageId(id, 2)).toBe(
      artifactConfirmationMessageId(id, 2),
    );
    expect(artifactConfirmationMessageId(id, 2)).not.toBe(
      artifactConfirmationMessageId(id, 3),
    );
  });

  it.each(['failed', 'cancelled', 'interrupted'])(
    'allocates a new attempt after %s only when no artifact job exists',
    (status) => {
      expect(isRetryableArtifactConfirmationFailure(status, false)).toBe(true);
      expect(isRetryableArtifactConfirmationFailure(status, true)).toBe(false);
    },
  );

  it.each(['pending', 'running', 'completed'])(
    'replays the existing idempotency key while operation is %s',
    (status) => {
      expect(isRetryableArtifactConfirmationFailure(status, false)).toBe(false);
    },
  );
});
