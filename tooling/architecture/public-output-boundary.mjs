#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));

export function publicOutputViolations(sources) {
  const violations = [];
  for (const source of sources) {
    if (
      source.path.startsWith('apps/web/app/api/') &&
      /error\s*:\s*\{[\s\S]{0,240}\b(?:message|retryable|retryAfterMs)\s*:/.test(
        source.text,
      )
    )
      violations.push(
        `${source.path}: browser error bodies may contain only code and requestId; use jsonError`,
      );
    if (
      source.path.startsWith('apps/web/app/api/') &&
      /new Response\s*\(\s*JSON\.stringify\s*\(\s*\{\s*error\b/.test(
        source.text,
      )
    )
      violations.push(
        `${source.path}: direct browser error sink bypasses jsonError`,
      );
    if (
      source.path.startsWith('apps/gateway/src/') &&
      /(?:send|write|end)\s*\(\s*JSON\.stringify\s*\(\s*\{\s*error\b/.test(
        source.text,
      )
    )
      violations.push(
        `${source.path}: direct Gateway error sink bypasses the public serializer`,
      );
  }
  const common = sources.find(
    (source) => source.path === 'apps/gateway/src/http/common.ts',
  );
  if (!common?.text.includes('publicErrorEnvelope(errorCode)'))
    violations.push(
      'apps/gateway/src/http/common.ts: writeJson must close HTTP errors through publicErrorEnvelope',
    );
  return violations;
}

function productionSources() {
  const paths = execFileSync(
    'git',
    ['ls-files', '-z', 'apps/web', 'apps/gateway'],
    {
      cwd: repoRoot,
      encoding: 'utf8',
    },
  )
    .split('\0')
    .filter(
      (path) =>
        path &&
        /\.(?:ts|tsx)$/.test(path) &&
        !/\.(?:test|spec)\.(?:ts|tsx)$/.test(path),
    );
  return paths.map((path) => ({
    path,
    text: readFileSync(resolve(repoRoot, path), 'utf8'),
  }));
}

function main() {
  const violations = publicOutputViolations(productionSources());
  if (violations.length > 0) {
    console.error(violations.join('\n'));
    process.exitCode = 1;
  } else {
    console.log(
      'Public HTTP, NDJSON, SSE and WebSocket output sinks are governed.',
    );
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main();
