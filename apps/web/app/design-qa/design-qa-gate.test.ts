import { describe, expect, it } from 'vitest';
import { isDesignQaEnabled } from './design-qa-gate';

describe('design QA route gate', () => {
  it('is default-off and accepts only the explicit true flag', () => {
    expect(isDesignQaEnabled(undefined)).toBe(false);
    expect(isDesignQaEnabled('false')).toBe(false);
    expect(isDesignQaEnabled('1')).toBe(false);
    expect(isDesignQaEnabled('true')).toBe(true);
  });
});
