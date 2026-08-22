import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { discoverToolingTests } from './run-tooling-tests.mjs';

test('discovers governed tooling tests without pulling in manual labs', () => {
  const files = discoverToolingTests().map((file) =>
    file.split(path.sep).join('/'),
  );

  assert.ok(files.length > 0);
  assert.ok(files.every((file) => file.endsWith('.test.mjs')));
  assert.ok(files.some((file) => file.includes('/local/')));
  assert.ok(files.some((file) => file.includes('/quality/')));
  assert.ok(files.every((file) => !file.includes('/voice-lab/')));
  assert.ok(files.every((file) => !file.includes('/evals/')));
});
