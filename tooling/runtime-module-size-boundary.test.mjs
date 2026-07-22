import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, it } from 'node:test';

const REVIEW_LIMIT = 250;
const TURN_APPLICATION_REVIEW_LIMIT = 300;
const MODEL_GATEWAY_REVIEW_LIMIT = 400;
const TELEMETRY_REVIEW_LIMIT = 300;
const CONTINUATION_REVIEW_LIMIT = 300;
const WEB_VISUAL_REVIEW_LIMIT = 350;
const WEB_SETTINGS_REVIEW_LIMIT = 300;
const WEB_WORKSPACE_REVIEW_LIMIT = 600;
const WEB_STYLES_REVIEW_LIMIT = 400;
const TOOL_KERNEL_ROOT = 'packages/agent-runtime/src/tool-kernel';
const TOOL_KERNEL_ENTRY = 'packages/agent-runtime/src/tool-kernel.ts';
const TOOL_KERNEL_TEST_PATTERN =
  /^tool-kernel(?:\..+)?\.test(?:-support)?\.ts$/;
const TURN_APPLICATION_ROOT = 'packages/agent-runtime/src/turn-application';
const TURN_APPLICATION_ENTRY = 'packages/agent-runtime/src/turn-application.ts';
const TURN_APPLICATION_TEST_PATTERN =
  /^turn-application(?:\..+)?\.test(?:-support)?\.ts$/;
const MODEL_GATEWAY_ROOT = 'packages/model-gateway/src';
const TELEMETRY_ROOT = 'packages/telemetry/src';
const CONTINUATION_REPOSITORY_ROOT = 'packages/db/src/operation-continuation';
const CONTINUATION_REPOSITORY_ENTRY =
  'packages/db/src/operation-continuation-repository.ts';
const CONTINUATION_DB_SUPPORT =
  'packages/db/src/operation-continuation-repository.integration.support.ts';
const CONTINUATION_WORKER_SUPPORT =
  'apps/worker/src/approval-continuation.integration-support.ts';
const WEB_SHARED_ROOT = 'apps/web/features/workspace/shared';
const WEB_SETTINGS_ROOT = 'apps/web/features/settings';
const WEB_GENERAL_WORKSPACE =
  'apps/web/features/workspace/general/general-chat-workspace.tsx';

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

function typescriptFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return typescriptFiles(path);
    return entry.isFile() && /\.tsx?$/.test(entry.name) ? [path] : [];
  });
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

  it('keeps Model Gateway adapters and tests independently readable', () => {
    assertFilesWithinLimit(
      typescriptFiles(MODEL_GATEWAY_ROOT),
      MODEL_GATEWAY_REVIEW_LIMIT,
    );
  });

  it('keeps Telemetry adapters and tests independently readable', () => {
    assertFilesWithinLimit(
      typescriptFiles(TELEMETRY_ROOT),
      TELEMETRY_REVIEW_LIMIT,
    );
  });

  it('keeps continuation repository responsibilities independently readable', () => {
    assertFilesWithinLimit(
      [
        CONTINUATION_REPOSITORY_ENTRY,
        ...typescriptFiles(CONTINUATION_REPOSITORY_ROOT),
      ],
      CONTINUATION_REVIEW_LIMIT,
    );
  });

  it('keeps continuation integration fixtures independently readable', () => {
    const dbTests = readdirSync('packages/db/src', { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isFile() &&
          (/^operation-continuation-.+\.integration\.test\.ts$/.test(
            entry.name,
          ) ||
            entry.name ===
              'tool-approval-intent-repository.integration.test.ts'),
      )
      .map((entry) => join('packages/db/src', entry.name));
    const workerTests = readdirSync('apps/worker/src', {
      withFileTypes: true,
    })
      .filter(
        (entry) =>
          entry.isFile() &&
          /^approval-continuation-.+\.integration\.test\.ts$/.test(entry.name),
      )
      .map((entry) => join('apps/worker/src', entry.name));
    assertFilesWithinLimit(
      [
        CONTINUATION_DB_SUPPORT,
        ...dbTests,
        CONTINUATION_WORKER_SUPPORT,
        ...workerTests,
      ],
      CONTINUATION_REVIEW_LIMIT,
    );
  });

  it('keeps Web visual runtimes and settings views independently readable', () => {
    const visualModules = typescriptFiles(WEB_SHARED_ROOT).filter((path) =>
      /\/(?:pixel-blast(?:-.+)?|agent-busy-overlay|hero-ink-field|use-(?:css-var-color|reduced-motion))\.tsx?$/.test(
        path,
      ),
    );
    const settingsModules = typescriptFiles(WEB_SETTINGS_ROOT).filter((path) =>
      /\/connection-settings(?:-.+)?\.tsx?$/.test(path),
    );
    assertFilesWithinLimit(visualModules, WEB_VISUAL_REVIEW_LIMIT);
    assertFilesWithinLimit(settingsModules, WEB_SETTINGS_REVIEW_LIMIT);
    assertFilesWithinLimit([WEB_GENERAL_WORKSPACE], WEB_WORKSPACE_REVIEW_LIMIT);
    assertFilesWithinLimit(
      ['apps/web/app/globals.css', 'apps/web/app/effects.css'],
      WEB_STYLES_REVIEW_LIMIT,
    );
  });
});
