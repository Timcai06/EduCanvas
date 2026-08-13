import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  fileURLToPath(new URL('./studio-workspace.tsx', import.meta.url)),
  'utf8',
);

describe('Studio unified resource library shell', () => {
  it('reuses summary browsing, the common open callback and authorized Source mutations', () => {
    expect(source).toContain('<StudioResourceLibrary');
    expect(source).toContain('onOpen={onOpen}');
    expect(source).toContain('<StudioSourceActions');
    expect(source).toContain("summary.resourceKind !== 'source'");
    expect(source).not.toContain('OptionWheel');
    expect(source).not.toContain('fetch(');
  });
});
