import { describe, expect, it } from 'vitest';
import { parseWorkspaceResourcePage } from './workspace-resource-client';

const item = {
  schemaVersion: 1,
  resourceKind: 'source',
  resourceId: 's1',
  notebookId: 'notebook-1',
  title: 'Source',
  updatedAt: '2026-08-12T12:00:00.000Z',
  status: 'ready',
  version: { versionId: 'sv1', sequence: null },
  renderer: { rendererId: 'source.pdf', rendererVersion: 1 },
  allowedActions: ['view'],
  provenance: { sourceResourceIds: [], sourceReferences: [] },
  context: { enabled: true },
  surface: { restState: null },
};

describe('workspace resource response parser', () => {
  it('accepts strict page and cursor', () =>
    expect(
      parseWorkspaceResourcePage({ items: [item], nextCursor: 'c1' })
        .nextCursor,
    ).toBe('c1'));
  it('fails closed on unknown fields and malformed cursor', () => {
    expect(() =>
      parseWorkspaceResourcePage({
        items: [{ ...item, secret: 'x' }],
        nextCursor: null,
      }),
    ).toThrow();
    expect(() =>
      parseWorkspaceResourcePage({ items: [item], nextCursor: 3 }),
    ).toThrow();
  });
});
