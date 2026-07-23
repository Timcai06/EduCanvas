import { readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const WEB_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const SOURCE_ROOTS = ['app', 'features', 'server'] as const;
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx']);

function collectSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return collectSourceFiles(path);
    if (!SOURCE_EXTENSIONS.has(extname(entry.name))) return [];
    if (entry.name.endsWith('.test.ts') || entry.name.endsWith('.test.tsx')) {
      return [];
    }
    return [path];
  });
}

describe('production AI dependency boundary', () => {
  it('does not import deterministic model or teacher-script test doubles', () => {
    const violations = SOURCE_ROOTS.flatMap((root) =>
      collectSourceFiles(join(WEB_ROOT, root)),
    ).filter((path) => {
      const source = readFileSync(path, 'utf8');
      return (
        source.includes('demo-teacher-script') ||
        source.includes('ScriptedModelGateway')
      );
    });

    expect(violations).toEqual([]);
  });

  it('loads the design-QA client and fixture only after the server gate', () => {
    const pagePath = join(WEB_ROOT, 'app/design-qa/pipeline-flow/page.tsx');
    const clientPath = join(WEB_ROOT, 'features/canvas/pipeline-flow-qa.tsx');
    const pageSource = readFileSync(pagePath, 'utf8');
    const clientSource = readFileSync(clientPath, 'utf8');

    expect(pageSource).not.toMatch(
      /^\s*import .*pipeline-flow-(?:qa|fixture)/m,
    );
    const gateIndex = pageSource.indexOf('if (!isDesignQaEnabled');
    const clientImportIndex = pageSource.indexOf(
      "import('@/features/canvas/pipeline-flow-qa')",
    );
    expect(gateIndex).toBeGreaterThanOrEqual(0);
    expect(clientImportIndex).toBeGreaterThan(gateIndex);
    expect(clientSource).not.toContain('pipeline-flow-fixture');

    const fixtureImporters = SOURCE_ROOTS.flatMap((root) =>
      collectSourceFiles(join(WEB_ROOT, root)),
    ).filter((path) =>
      readFileSync(path, 'utf8').includes('pipeline-flow-fixture'),
    );
    expect(fixtureImporters).toEqual([pagePath]);
  });
});
