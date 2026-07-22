import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, it } from 'node:test';

const REVIEW_LIMIT = 250;
const TURN_APPLICATION_REVIEW_LIMIT = 300;
const TOOL_KERNEL_ROOT = 'packages/agent-runtime/src/tool-kernel';
const TOOL_KERNEL_ENTRY = 'packages/agent-runtime/src/tool-kernel.ts';
const TOOL_KERNEL_TEST_PATTERN =
  /^tool-kernel(?:\..+)?\.test(?:-support)?\.ts$/;
const TURN_APPLICATION_ROOT = 'packages/agent-runtime/src/turn-application';
const TURN_APPLICATION_ENTRY = 'packages/agent-runtime/src/turn-application.ts';
const TURN_APPLICATION_TEST_PATTERN =
  /^turn-application(?:\..+)?\.test(?:-support)?\.ts$/;

function lineCount(path) {
  return readFileSync(path, 'utf8').split('\n').length;
}

function assertFilesWithinLimit(paths, limit) {
  const oversized = paths
    .map((path) => ({
      path: relative(process.cwd(), path),
      lines: lineCount(path),
    }))
    .filter(({ lines }) => lines > limit);
  assert.deepEqual(oversized, []);
}

describe('Runtime module size boundary', () => {
  it('keeps Tool Kernel production responsibilities independently readable', () => {
    const modules = readdirSync(TOOL_KERNEL_ROOT, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
      .map((entry) => join(TOOL_KERNEL_ROOT, entry.name));
    assertFilesWithinLimit([TOOL_KERNEL_ENTRY, ...modules], REVIEW_LIMIT);
  });

  it('keeps Tool Kernel tests independently readable', () => {
    const tests = readdirSync('packages/agent-runtime/src', {
      withFileTypes: true,
    })
      .filter(
        (entry) => entry.isFile() && TOOL_KERNEL_TEST_PATTERN.test(entry.name),
      )
      .map((entry) => join('packages/agent-runtime/src', entry.name));
    assertFilesWithinLimit(tests, REVIEW_LIMIT);
  });

  it('keeps Turn Application production responsibilities independently readable', () => {
    const modules = readdirSync(TURN_APPLICATION_ROOT, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
      .map((entry) => join(TURN_APPLICATION_ROOT, entry.name));
    assertFilesWithinLimit(
      [TURN_APPLICATION_ENTRY, ...modules],
      TURN_APPLICATION_REVIEW_LIMIT,
    );
  });

  it('keeps Turn Application tests independently readable', () => {
    const tests = readdirSync('packages/agent-runtime/src', {
      withFileTypes: true,
    })
      .filter(
        (entry) =>
          entry.isFile() && TURN_APPLICATION_TEST_PATTERN.test(entry.name),
      )
      .map((entry) => join('packages/agent-runtime/src', entry.name));
    assertFilesWithinLimit(tests, TURN_APPLICATION_REVIEW_LIMIT);
  });
});
