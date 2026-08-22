import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  auditPackagePolicy,
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
