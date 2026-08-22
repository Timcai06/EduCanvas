import { describe, expect, it } from 'vitest';
import {
  normalizeResearchCandidateUrl,
  normalizeResearchQuery,
  RESEARCH_CHECKPOINT_PHASES,
  RESEARCH_CHECKPOINT_PROTOCOL_VERSION,
} from './research-checkpoint-repository';

describe('Deep Research checkpoint contract', () => {
  it('freezes the protocol and non-terminal phase vocabulary', () => {
    expect(RESEARCH_CHECKPOINT_PROTOCOL_VERSION).toBe(
      'educanvas.research-checkpoint.v1',
    );
    expect(RESEARCH_CHECKPOINT_PHASES).toEqual([
      'planning',
      'searching',
      'reading',
      'synthesizing',
    ]);
  });

  it('normalizes completed queries without retaining surrounding or repeated whitespace', () => {
    expect(normalizeResearchQuery('  Cafe\u0301\t  research\n')).toBe(
      'café research',
    );
  });

  it('canonicalizes safe URLs and removes fragments', () => {
    expect(
      normalizeResearchCandidateUrl(' HTTPS://Example.com/path#section '),
    ).toBe('https://example.com/path');
  });

  it.each([
    'https://user:secret@example.com/article',
    'http://127.0.0.1:8000/private',
    'http://localhost/private',
    'ftp://example.com/file',
  ])('rejects unsafe candidate URL %s', (url) => {
    expect(() => normalizeResearchCandidateUrl(url)).toThrow('candidate URL');
  });
});
