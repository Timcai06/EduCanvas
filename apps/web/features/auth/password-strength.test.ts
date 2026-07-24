import { describe, expect, it } from 'vitest';
import { assessPasswordRisk } from './password-strength';

describe('password risk assessment', () => {
  it('rejects passwords shorter than 6 characters', () => {
    expect(assessPasswordRisk('a1!')).toMatchObject({
      acceptable: false,
      level: 'high',
    });
  });

  it('classifies accepted passwords into three risk levels', () => {
    expect(assessPasswordRisk('abcdef')).toMatchObject({
      acceptable: true,
      level: 'high',
    });
    expect(assessPasswordRisk('abc12345')).toMatchObject({
      acceptable: true,
      level: 'medium',
    });
    expect(assessPasswordRisk('Abcdef123456!')).toMatchObject({
      acceptable: true,
      level: 'low',
    });
  });
});
