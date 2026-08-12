import { describe, expect, it } from 'vitest';
import {
  normalizeOutputPreference,
  outputPreferenceSchema,
} from './output-preference';

describe('output preference contract', () => {
  it.each([
    'auto',
    'markdown_document',
    'interactive_artifact',
    'web_app',
  ] as const)('accepts canonical preference %s', (value) => {
    expect(outputPreferenceSchema.parse(value)).toBe(value);
    expect(normalizeOutputPreference(value)).toBe(value);
  });

  it('normalizes the legacy canvas alias without keeping it in the domain', () => {
    expect(normalizeOutputPreference('canvas')).toBe('interactive_artifact');
    expect(outputPreferenceSchema.safeParse('canvas').success).toBe(false);
  });

  it('distinguishes absent and invalid preferences', () => {
    expect(normalizeOutputPreference(undefined)).toBeUndefined();
    expect(normalizeOutputPreference('root.shell')).toBeNull();
    expect(normalizeOutputPreference({ value: 'auto' })).toBeNull();
  });

  it('rejects canonical values outside schema and unknown legacy aliases', () => {
    expect(normalizeOutputPreference('AUTO')).toBeNull();
    expect(normalizeOutputPreference('canvas_v2')).toBeNull();
  });
});
