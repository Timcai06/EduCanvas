import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
  classifyChangedPaths,
  comparisonRange,
  requiredResultFailures,
} from './quality/ci-impact.mjs';

describe('CI impact classification', () => {
  it('skips costly lanes for documentation and shared editor configuration', () => {
    assert.deepEqual(
      classifyChangedPaths(['docs/README.md', '.vscode/settings.json']),
      {
        checks: false,
        db_integration: false,
        worker_integration: false,
        migration_integration: false,
        windows: false,
        runtime_pressure: false,
        e2e: false,
        agent_eval: false,
        dependency_review: false,
        release_evidence: false,
        desktop: false,
      },
    );
  });

  it('runs governance checks for non-whitelisted VS Code state', () => {
    const result = classifyChangedPaths(['.vscode/launch.json']);
    assert.equal(result.checks, true);
    assert.equal(result.release_evidence, false);
    assert.equal(result.db_integration, false);
    assert.equal(result.worker_integration, false);
    assert.equal(result.migration_integration, false);
    assert.equal(result.e2e, false);
  });

  it('does not treat executable release evidence as documentation-only', () => {
    const result = classifyChangedPaths([
      'docs/06-quality/releases/rc1/manifest.json',
    ]);
    assert.equal(result.checks, true);
    assert.equal(result.release_evidence, true);
    assert.equal(
      classifyChangedPaths(['docs/06-quality/08-供应链与发布证据.md'])
        .release_evidence,
      true,
    );
  });

  it('does not treat Markdown test fixtures as documentation-only', () => {
    const result = classifyChangedPaths(['tests/fixtures/sample.md']);
    assert.equal(result.checks, true);
  });

  it('runs all lanes for dependency, CI workflow, manual, or unknown changes', () => {
    assert.ok(
      Object.values(classifyChangedPaths(['pnpm-lock.yaml'])).every(Boolean),
    );
    assert.ok(
      Object.values(classifyChangedPaths(['.github/workflows/ci.yml'])).every(
        Boolean,
      ),
    );
    assert.ok(
      Object.values(
        classifyChangedPaths(['.github/actions/setup-workspace/action.yml']),
      ).every(Boolean),
    );
    assert.ok(
      Object.values(
        classifyChangedPaths(['docs/a.md'], { eventName: 'workflow_dispatch' }),
      ).every(Boolean),
    );
    assert.ok(Object.values(classifyChangedPaths([])).every(Boolean));
    assert.ok(
      Object.values(classifyChangedPaths(['new-root/file.ts'])).every(Boolean),
    );
  });

  it('routes workspace-local manifests without treating them as global dependency changes', () => {
    assert.deepEqual(classifyChangedPaths(['apps/desktop/package.json']), {
      checks: true,
      db_integration: false,
      worker_integration: false,
      migration_integration: false,
      windows: false,
      runtime_pressure: false,
      e2e: false,
      agent_eval: false,
      dependency_review: true,
      release_evidence: false,
      desktop: true,
    });

    const database = classifyChangedPaths(['packages/db/package.json']);
    assert.equal(database.checks, true);
    assert.equal(database.db_integration, true);
    assert.equal(database.dependency_review, true);
    assert.equal(database.desktop, false);
    assert.equal(database.runtime_pressure, false);
    assert.equal(database.e2e, false);

    const web = classifyChangedPaths(['apps/web/package.json']);
    assert.equal(web.checks, true);
    assert.equal(web.e2e, true);
    assert.equal(web.dependency_review, true);
    assert.equal(web.desktop, false);
    assert.equal(web.migration_integration, false);
  });

  it('routes database changes without paying unrelated Windows or pressure costs', () => {
    assert.deepEqual(classifyChangedPaths(['packages/db/src/repository.ts']), {
      checks: true,
      db_integration: true,
      worker_integration: false,
      migration_integration: false,
      windows: false,
      runtime_pressure: false,
      // D06：纯 DB 内部改动不再自动支付 Chromium E2E（路由原则 1）
      e2e: false,
      agent_eval: false,
      dependency_review: false,
      release_evidence: false,
      desktop: false,
    });
  });

  it('routes Windows and runtime changes independently', () => {
    const result = classifyChangedPaths(['start-educanvas.ps1']);
    assert.equal(result.checks, true);
    assert.equal(result.windows, true);
    assert.equal(result.runtime_pressure, false);
    assert.equal(result.e2e, false);
  });

  it('keeps Web Runtime pressure and security-sensitive composition in the same gate set', () => {
    const result = classifyChangedPaths(['apps/web-runtime/src/server.ts']);
    assert.equal(result.checks, true);
    assert.equal(result.runtime_pressure, true);
    assert.equal(result.e2e, true);
  });

  it('routes desktop app changes to the desktop lane plus checks only', () => {
    const result = classifyChangedPaths([
      'apps/desktop/src/main/index.ts',
      'apps/desktop/electron-builder.yml',
    ]);
    assert.equal(result.desktop, true);
    assert.equal(result.checks, true);
    assert.equal(result.e2e, false);
    assert.equal(result.windows, false);
    assert.equal(result.db_integration, false);
    assert.equal(result.worker_integration, false);
  });

  it('keeps desktop lane off for docs-only changes', () => {
    const result = classifyChangedPaths(['docs/plan/active/Q-质量观测成本.md']);
    assert.equal(result.desktop, false);
    assert.equal(result.checks, false);
  });

  it('treats the PR smoke configuration as an E2E concern without unrelated lanes', () => {
    assert.deepEqual(classifyChangedPaths(['playwright.pr.config.ts']), {
      checks: true,
      db_integration: false,
      worker_integration: false,
      migration_integration: false,
      windows: false,
      runtime_pressure: false,
      e2e: true,
      agent_eval: false,
      dependency_review: false,
      release_evidence: false,
      desktop: false,
    });
  });

  it('routes Agent contract changes to deterministic eval without charging pure UI or Desktop', () => {
    for (const path of [
      'packages/agent-runtime/src/agent-loop.ts',
      'packages/model-gateway/src/openai-compatible.ts',
      'packages/db/src/knowledge-hybrid-retrieval.ts',
      'apps/web/server/platform/general-turn-profile.ts',
      'tooling/evals/agent/v1/cases.ts',
    ]) {
      assert.equal(classifyChangedPaths([path]).agent_eval, true, path);
    }
    assert.equal(
      classifyChangedPaths(['apps/web/features/voice/live-voice-panel.tsx'])
        .agent_eval,
      false,
    );
    assert.equal(
      classifyChangedPaths(['apps/desktop/src/renderer/pet.tsx']).agent_eval,
      false,
    );
    assert.equal(
      classifyChangedPaths(['docs/06-quality/03-测试与评估.md']).agent_eval,
      false,
    );
  });

  it('compares pull requests from the merge base rather than base-branch churn', () => {
    const base = 'a'.repeat(40);
    const head = 'b'.repeat(40);
    assert.equal(comparisonRange(base, head), `${base}...${head}`);
    assert.throws(() => comparisonRange('invalid', head));
  });

  it('accepts intentionally skipped lanes but rejects failed required lanes', () => {
    const baseResults = {
      changes: 'success',
      secret_scan: 'success',
      dependency_review: 'skipped',
      quality_static: 'skipped',
      quality_tests: 'skipped',
      db_integration: 'skipped',
      worker_integration: 'skipped',
      migration_integration: 'skipped',
      windows: 'skipped',
      runtime_pressure: 'skipped',
      e2e: 'skipped',
      agent_eval: 'skipped',
      release_evidence: 'skipped',
      desktop_build: 'skipped',
    };
    assert.deepEqual(
      requiredResultFailures({
        eventName: 'pull_request',
        expected: classifyChangedPaths(['docs/README.md']),
        results: baseResults,
      }),
      [],
    );
    assert.deepEqual(
      requiredResultFailures({
        eventName: 'pull_request',
        expected: classifyChangedPaths(['pnpm-lock.yaml']),
        results: {
          ...baseResults,
          quality_static: 'success',
          quality_tests: 'success',
          db_integration: 'success',
          worker_integration: 'success',
          migration_integration: 'success',
          windows: 'success',
          runtime_pressure: 'success',
          e2e: 'failure',
          agent_eval: 'success',
          release_evidence: 'success',
          desktop_build: 'success',
        },
      }),
      [
        'e2e was required but concluded: failure',
        'dependency_review was required but concluded: skipped',
      ],
    );

    assert.deepEqual(
      requiredResultFailures({
        eventName: 'pull_request',
        expected: classifyChangedPaths([
          'docs/06-quality/releases/rc1/manifest.json',
        ]),
        results: {
          ...baseResults,
          quality_static: 'success',
          quality_tests: 'success',
        },
      }),
      ['release_evidence was required but concluded: skipped'],
    );

    assert.deepEqual(
      requiredResultFailures({
        eventName: 'pull_request',
        expected: classifyChangedPaths(['apps/web/app/page.tsx']),
        results: {
          ...baseResults,
          quality_static: 'success',
          quality_tests: 'success',
          e2e: 'success',
        },
      }),
      [],
    );
  });
});

describe('AI Product Evidence v2 — agent_eval impact graph', () => {
  it('routes MCP runtime changes to agent_eval', () => {
    for (const path of [
      'packages/mcp-runtime/src/tool-adapter.ts',
      'packages/mcp-runtime/src/contracts.ts',
      'packages/mcp-runtime/src/output-sanitizer.ts',
    ]) {
      assert.equal(classifyChangedPaths([path]).agent_eval, true, path);
    }
  });

  it('routes Canvas Protocol and Artifact/Image tool changes to agent_eval', () => {
    for (const path of [
      'packages/canvas-protocol/src/artifact.ts',
      'packages/canvas-protocol/src/artifacts/generated-image.ts',
      'packages/canvas-protocol/src/web-runtime-contract.ts',
      'packages/canvas-protocol/src/web-runtime-policy.ts',
    ]) {
      assert.equal(classifyChangedPaths([path]).agent_eval, true, path);
    }
  });

  it('routes General tool paths to agent_eval', () => {
    for (const path of [
      'packages/agent-runtime/src/local-tool.ts',
      'packages/agent-runtime/src/agent-tool-adapter.ts',
      'packages/agent-runtime/src/tool-kernel/contracts.ts',
    ]) {
      assert.equal(classifyChangedPaths([path]).agent_eval, true, path);
    }
  });

  it('routes Teaching Tool Policy paths to agent_eval', () => {
    for (const path of [
      'packages/teaching-core/src/tools.ts',
      'packages/teaching-runtime/src/teaching-tool.ts',
      'packages/teaching-runtime/src/tool-kernel-adapter.ts',
    ]) {
      assert.equal(classifyChangedPaths([path]).agent_eval, true, path);
    }
  });

  it('does not trigger agent_eval for pure UI, documentation, or Desktop changes', () => {
    for (const path of [
      'apps/web/features/voice/live-voice-panel.tsx',
      'apps/desktop/src/main/index.ts',
      'docs/06-quality/03-测试与评估.md',
      'apps/web/app/(main)/page.tsx',
      'tests/e2e/general-journey.spec.ts',
    ]) {
      assert.equal(classifyChangedPaths([path]).agent_eval, false, path);
    }
  });

  it('agent_eval and e2e can both trigger for browser-facing agent packages', () => {
    for (const path of [
      'packages/canvas-protocol/src/artifact.ts',
      'packages/mcp-runtime/src/tool-adapter.ts',
    ]) {
      const result = classifyChangedPaths([path]);
      assert.equal(
        result.agent_eval,
        true,
        `${path} should trigger agent_eval`,
      );
      assert.equal(result.e2e, true, `${path} should trigger e2e`);
    }
  });
});

describe('D06 lane split routing', () => {
  it('Worker-only changes route to Worker integration, not DB full or E2E', () => {
    const result = classifyChangedPaths([
      'apps/worker/src/tasks/transcribe-audio.ts',
    ]);
    assert.equal(result.worker_integration, true);
    assert.equal(result.db_integration, false);
    assert.equal(result.migration_integration, false);
    assert.equal(result.e2e, false);
  });

  it('asset-processing changes route to Worker integration only', () => {
    const result = classifyChangedPaths([
      'packages/asset-processing/src/parser.ts',
    ]);
    assert.equal(result.worker_integration, true);
    assert.equal(result.db_integration, false);
    assert.equal(result.migration_integration, false);
    assert.equal(result.e2e, false);
  });

  it('Migration-only changes route to migration + DB + release evidence, not E2E', () => {
    const result = classifyChangedPaths([
      'packages/db/drizzle/0054_new_migration.sql',
      'packages/db/drizzle/meta/0054_snapshot.json',
    ]);
    assert.equal(result.migration_integration, true);
    assert.equal(result.db_integration, true);
    assert.equal(result.release_evidence, true);
    assert.equal(result.worker_integration, false);
    assert.equal(result.e2e, false);
    assert.equal(result.checks, true);
  });

  it('Browser-facing package changes keep the Chromium PR smoke', () => {
    const result = classifyChangedPaths([
      'apps/web/features/canvas/viewer.tsx',
    ]);
    assert.equal(result.e2e, true);
    assert.equal(result.runtime_pressure, true);
    assert.equal(result.db_integration, false);
  });

  it('Schema definition changes also route to migration drift evidence', () => {
    const result = classifyChangedPaths(['packages/db/src/schema/asset.ts']);
    assert.equal(result.db_integration, true);
    assert.equal(result.migration_integration, true);
    assert.equal(result.worker_integration, false);
    assert.equal(result.e2e, false);
  });

  it('routes the migration integration runner to its own lane', () => {
    const result = classifyChangedPaths([
      'tooling/quality/migration-integration.mjs',
    ]);
    assert.equal(result.migration_integration, true);
    assert.equal(result.e2e, false);
  });

  it('does not re-enable E2E when a DB-only change includes neutral documentation', () => {
    const result = classifyChangedPaths([
      'packages/db/src/asset-repository.ts',
      'docs/04-data/example.md',
    ]);
    assert.equal(result.db_integration, true);
    assert.equal(result.e2e, false);
  });

  it('wires all split-lane expectations into the checks environment bridge', () => {
    const workflow = readFileSync(
      new URL('../.github/workflows/ci.yml', import.meta.url),
      'utf8',
    );
    for (const lane of [
      'DB_INTEGRATION_EXPECTED',
      'WORKER_INTEGRATION_EXPECTED',
      'MIGRATION_INTEGRATION_EXPECTED',
    ]) {
      assert.match(workflow, new RegExp(`^\\s+${lane}:`, 'm'));
    }
    assert.doesNotMatch(workflow, /^\s+INTEGRATION_EXPECTED:/m);
    assert.match(workflow, /^\s+AGENT_EVAL_EXPECTED:/m);
    assert.match(workflow, /^\s+AGENT_EVAL_RESULT:/m);

    const migrationJob = workflow.slice(
      workflow.indexOf('\n  migration-integration:'),
      workflow.indexOf('\n  windows:'),
    );
    assert.match(migrationJob, /BASE_SHA:.*github\.sha/);
    assert.doesNotMatch(migrationJob, /BASE_SHA:.*\|\| ''/);
  });

  it('fails when a required split lane fails and accepts skipped optional lanes', () => {
    const failures = requiredResultFailures({
      eventName: 'pull_request',
      expected: classifyChangedPaths([
        'packages/db/drizzle/0054_new_migration.sql',
      ]),
      results: {
        changes: 'success',
        secret_scan: 'success',
        quality_static: 'success',
        quality_tests: 'success',
        db_integration: 'success',
        worker_integration: 'skipped',
        migration_integration: 'failure',
        windows: 'skipped',
        runtime_pressure: 'skipped',
        e2e: 'skipped',
        agent_eval: 'skipped',
        dependency_review: 'skipped',
        release_evidence: 'success',
        desktop_build: 'skipped',
      },
    });
    assert.deepEqual(failures, [
      'migration_integration was required but concluded: failure',
    ]);
  });
});

describe('CI workflow scheduling contract', () => {
  const ci = readFileSync(
    new URL('../.github/workflows/ci.yml', import.meta.url),
    'utf8',
  );
  const ui = readFileSync(
    new URL('../.github/workflows/ui.yml', import.meta.url),
    'utf8',
  );

  function jobBlock(source, name) {
    const marker = `\n  ${name}:`;
    const start = source.indexOf(marker);
    assert.notEqual(start, -1, `missing job ${name}`);
    const bodyStart = start + marker.length;
    const next = source.slice(bodyStart).search(/\n  [a-z][a-z0-9-]+:\n/);
    return next === -1
      ? source.slice(start)
      : source.slice(start, bodyStart + next);
  }

  it('cancels superseded PR commits without cancelling independent main SHAs', () => {
    const concurrency = ci.slice(
      ci.indexOf('\nconcurrency:'),
      ci.indexOf('\n# Q06：action'),
    );
    assert.match(
      concurrency,
      /github\.event\.pull_request\.number \|\| github\.sha/,
    );
    assert.match(
      concurrency,
      /cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}/,
    );
    assert.doesNotMatch(concurrency, /github\.ref/);

    const uiConcurrency = ui.slice(
      ui.indexOf('\nconcurrency:'),
      ui.indexOf('\njobs:'),
    );
    assert.match(uiConcurrency, /github\.run_id/);
    assert.match(uiConcurrency, /cancel-in-progress: false/);
  });

  it('runs static and test quality lanes in parallel and keeps checks stable', () => {
    assert.doesNotMatch(ci, /^  quality:\s*$/m);
    const staticQuality = jobBlock(ci, 'quality-static');
    const testQuality = jobBlock(ci, 'quality-tests');
    assert.match(
      staticQuality,
      /Repository file governance[\s\S]*Migration records gate[\s\S]*Lint[\s\S]*Typecheck/,
    );
    assert.doesNotMatch(staticQuality, /Unit tests|Coverage gates/);
    assert.match(testQuality, /Unit tests[\s\S]*Coverage gates/);
    assert.doesNotMatch(testQuality, /\n      - name: Typecheck/);

    for (const consumer of [
      'runtime-pressure',
      'e2e',
      'release-evidence',
      'checks',
    ]) {
      const block = jobBlock(ci, consumer);
      assert.match(block, /quality-static/);
      assert.match(block, /quality-tests/);
    }
    assert.match(jobBlock(ci, 'checks'), /QUALITY_STATIC_RESULT/);
    assert.match(jobBlock(ci, 'checks'), /QUALITY_TESTS_RESULT/);
  });

  it('bounds every executable job with an explicit timeout', () => {
    for (const name of [
      'changes',
      'dependency-review',
      'secret-scan',
      'quality-static',
      'quality-tests',
      'db-integration',
      'worker-integration',
      'migration-integration',
      'windows',
      'desktop-build',
      'runtime-pressure',
      'e2e',
      'agent-eval',
      'release-evidence',
      'checks',
    ]) {
      assert.match(jobBlock(ci, name), /\n    timeout-minutes: \d+/);
    }
    assert.match(jobBlock(ui, 'ui'), /\n    timeout-minutes: 15/);
  });

  it('distinguishes a missing report after success from an upstream test failure', () => {
    assert.match(jobBlock(ci, 'e2e'), /PLAYWRIGHT_RESULTS_REQUIRED/);
    assert.match(
      jobBlock(ci, 'e2e'),
      /steps\.browser_e2e_smoke\.outcome == 'success'/,
    );
    assert.match(jobBlock(ui, 'ui'), /steps\.ui_review\.outcome == 'success'/);
  });

  it('collects independent nightly evidence and publishes one SHA-bound CI artifact', () => {
    for (const name of ['runtime-pressure', 'e2e']) {
      const block = jobBlock(ci, name);
      assert.match(block, /github\.event_name == 'schedule'/);
      assert.match(block, /github\.event_name == 'workflow_dispatch'/);
      assert.match(block, /always\(\)/);
    }
    const agentEval = jobBlock(ci, 'agent-eval');
    assert.match(agentEval, /always\(\)/);
    assert.doesNotMatch(agentEval, /quality-static|quality-tests/);
    assert.match(agentEval, /educanvas_agent_eval/);
    assert.match(agentEval, /pnpm test:eval/);
    assert.doesNotMatch(agentEval, /secrets\./);

    const releaseEvidence = jobBlock(ci, 'release-evidence');
    assert.match(releaseEvidence, /Validate release evidence draft/);
    assert.match(releaseEvidence, /--mode draft/);
    assert.match(releaseEvidence, /Validate release readiness/);
    assert.match(releaseEvidence, /--mode release --sha/);

    const checks = jobBlock(ci, 'checks');
    assert.match(checks, /ci-evidence\.mjs/);
    assert.match(checks, /ci-evidence-\$\{\{/);
    const generator = readFileSync(
      new URL('./quality/ci-evidence.mjs', import.meta.url),
      'utf8',
    );
    assert.match(generator, /requiredFailures/);
  });
});
