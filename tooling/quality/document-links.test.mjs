import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  brokenMarkdownLinks,
  localMarkdownTargets,
} from './document-links.mjs';

test('extracts only repository-local Markdown targets', () => {
  assert.deepEqual(
    localMarkdownTargets(
      '[local](../guide.md#start) [web](https://example.com) [anchor](#top)',
    ),
    ['../guide.md'],
  );
});

test('reports missing relative links without rejecting existing files', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'educanvas-doc-links-'));
  mkdirSync(path.join(root, 'docs'), { recursive: true });
  writeFileSync(path.join(root, 'README.md'), '[docs](docs/README.md)');
  writeFileSync(path.join(root, 'docs/README.md'), '[missing](missing.md)');

  assert.deepEqual(brokenMarkdownLinks(['README.md'], root), []);
  assert.deepEqual(brokenMarkdownLinks(['docs/README.md'], root), [
    'docs/README.md: missing missing.md',
  ]);
});
