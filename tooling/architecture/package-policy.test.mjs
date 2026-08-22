import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  auditPackagePolicy,
  manifestDependencyViolations,
  parseModuleSpecifiers,
  sourceImportViolations,
  validatePackageRegistry,
} from './package-policy.mjs';

const validEntry = {
  name: '@educanvas/example',
  path: 'packages/example',
  kind: 'core',
  domain: 'agent',
  owner: 'agent-runtime',
  publicEntrypoints: ['.'],
  allowedDependencyKinds: ['core', 'protocol'],
  forbiddenDependencies: [],
};

describe('workspace package policy registry', () => {
  it('registers every repository workspace exactly once', () => {
    const result = auditPackagePolicy({ today: '2026-08-22' });
    assert.equal(result.workspaces.length, 26);
    assert.equal(result.policy.packages.length, 26);
    assert.deepEqual(result.violations, []);
  });

  it('enforces the kind matrix for manifest dependencies', () => {
    const policy = {
      packages: [
        validEntry,
        {
          ...validEntry,
          name: '@educanvas/db',
          path: 'packages/db',
          kind: 'adapter',
          domain: 'data',
          owner: 'data',
          allowedDependencyKinds: ['core', 'runtime', 'adapter', 'protocol'],
        },
      ],
      allowlist: { dependencies: [], entrypoints: [] },
    };
    const workspaces = [
      {
        name: validEntry.name,
        path: validEntry.path,
        manifest: { dependencies: { '@educanvas/db': 'workspace:*' } },
      },
      { name: '@educanvas/db', path: 'packages/db', manifest: {} },
    ];
    assert.match(
      manifestDependencyViolations(policy, workspaces).join('\n'),
      /core packages cannot depend on adapter packages/,
    );
    workspaces[0].manifest.dependencies = {
      '@educanvas/example': 'workspace:*',
    };
    assert.deepEqual(manifestDependencyViolations(policy, workspaces), []);
  });

  it('discovers imports, re-exports, dynamic imports and require calls through the TypeScript AST', () => {
    assert.deepEqual(
      parseModuleSpecifiers(
        `import '@educanvas/agent-core';\nexport * from '@educanvas/gateway-core';\nvoid import('@educanvas/db/internal');\nrequire('ai');`,
      ).map((entry) => entry.specifier),
      [
        '@educanvas/agent-core',
        '@educanvas/gateway-core',
        '@educanvas/db/internal',
        'ai',
      ],
    );
  });

  it('rejects Provider SDK and unapproved DB internal imports while accepting exact debt scopes', () => {
    const policy = {
      packages: [validEntry],
      allowlist: {
        dependencies: [
          {
            consumer: validEntry.name,
            target: '@educanvas/db',
            specifier: '@educanvas/db/internal',
          },
        ],
        entrypoints: [],
      },
    };
    const workspaces = [
      { name: validEntry.name, path: validEntry.path, manifest: {} },
    ];
    const violations = sourceImportViolations(policy, workspaces, [
      {
        path: 'packages/example/src/index.ts',
        imports: [
          { specifier: '@educanvas/db/internal', line: 1 },
          { specifier: 'openai', line: 2 },
        ],
      },
    ]);
    assert.equal(
      violations.some((item) => item.includes('DB internal import')),
      false,
    );
    assert.equal(
      violations.some((item) => item.includes('Provider SDK import')),
      true,
    );
  });

  it('rejects missing, stale, duplicate and mismatched registrations', () => {
    const policy = {
      schemaVersion: 1,
      packages: [validEntry, { ...validEntry }],
      allowlist: { dependencies: [], entrypoints: [] },
    };
    const workspaces = [
      {
        name: '@educanvas/renamed',
        path: 'packages/example',
        manifest: {},
      },
      { name: '@educanvas/new', path: 'packages/new', manifest: {} },
    ];
    const violations = validatePackageRegistry(policy, workspaces, {
      today: '2026-08-22',
    });
    assert.ok(violations.some((item) => item.includes('duplicate name')));
    assert.ok(
      violations.some((item) => item.includes('does not match policy')),
    );
    assert.ok(violations.some((item) => item.includes('is not registered')));
  });

  it('rejects invalid enum values and expired or incomplete allowlists', () => {
    const policy = {
      schemaVersion: 1,
      packages: [
        {
          ...validEntry,
          kind: 'service',
          domain: 'unknown',
          owner: 'nobody',
        },
      ],
      allowlist: {
        dependencies: [
          {
            consumer: '@educanvas/example',
            target: '@educanvas/db',
            specifier: '@educanvas/db/internal',
            reason: '',
            issue: 'TODO',
            expiry: '2026-01-01',
          },
        ],
        entrypoints: [],
      },
    };
    const violations = validatePackageRegistry(
      policy,
      [{ name: validEntry.name, path: validEntry.path, manifest: {} }],
      { today: '2026-08-22' },
    );
    assert.ok(violations.some((item) => item.includes('invalid kind')));
    assert.ok(violations.some((item) => item.includes('invalid domain')));
    assert.ok(violations.some((item) => item.includes('invalid owner')));
    assert.ok(violations.some((item) => item.includes('missing reason')));
    assert.ok(violations.some((item) => item.includes('issue must')));
    assert.ok(violations.some((item) => item.includes('expired')));
  });
});
