import { describe, expect, it, vi } from 'vitest';
import {
  projectOwnedSourceResource,
  SourceResourceProjectionError,
  type SourceResourceProjectionInput,
} from './source-resource-adapter';

vi.mock('server-only', () => ({}));

const checksum = 'a'.repeat(64);
const readySource: SourceResourceProjectionInput = {
  assetId: '10000000-0000-4000-8000-000000000001',
  notebookId: '20000000-0000-4000-8000-000000000002',
  title: '教材.pdf',
  mimeType: 'application/pdf',
  status: 'ready',
  origin: 'upload',
  createdAt: '2026-07-25T00:00:00.000Z',
  accessRole: 'owner',
  version: {
    versionId: '30000000-0000-4000-8000-000000000003',
    byteSize: 4096,
    checksum,
  },
};

describe('Source CanvasResource adapter', () => {
  it('maps a ready PDF without inventing a numeric sequence', () => {
    const resource = projectOwnedSourceResource(readySource);

    expect(resource).toMatchObject({
      resourceKind: 'source',
      status: 'ready',
      version: { sequence: null, checksum },
      representation: {
        kind: 'document',
        mimeType: 'application/pdf',
      },
      renderer: { rendererId: 'source.pdf', rendererVersion: 1 },
      trustTier: 'tier1',
      runtime: { kind: 'none' },
      allowedActions: ['view', 'download', 'rename', 'delete'],
    });
  });

  it.each([
    ['image/png', 'image', 'source.image'],
    ['image/jpeg', 'image', 'source.image'],
    ['image/webp', 'image', 'source.image'],
    ['text/markdown', 'text', 'source.markdown'],
    ['text/plain', 'text', 'source.text'],
    [
      'application/vnd.openxmlformats-officedocument.wordprocessingml',
      'document',
      'source.docx',
    ],
    ['audio/mpeg', 'audio', 'source.audio'],
    ['audio/wav', 'audio', 'source.audio'],
    ['audio/ogg', 'audio', 'source.audio'],
    ['audio/flac', 'audio', 'source.audio'],
    ['audio/webm', 'audio', 'source.audio'],
    ['audio/mp4', 'audio', 'source.audio'],
    ['audio/x-m4a', 'audio', 'source.audio'],
    ['video/mp4', 'video', 'source.video'],
    ['video/quicktime', 'video', 'source.video'],
  ] as const)('maps supported MIME %s', (mimeType, kind, rendererId) => {
    const resource = projectOwnedSourceResource({
      ...readySource,
      mimeType,
    });

    expect(resource.representation.kind).toBe(kind);
    expect(resource.renderer.rendererId).toBe(rendererId);
  });

  it('allows a processing source without a content version', () => {
    const resource = projectOwnedSourceResource({
      ...readySource,
      status: 'processing',
      version: null,
    });

    expect(resource.status).toBe('processing');
    expect(resource.version).toBeNull();
    expect(resource.allowedActions).toEqual([]);
  });

  it('rejects a ready source without a real immutable version', () => {
    expect(() =>
      projectOwnedSourceResource({ ...readySource, version: null }),
    ).toThrow(
      expect.objectContaining<Partial<SourceResourceProjectionError>>({
        code: 'resource_invalid',
      }),
    );
  });

  it('fails closed for an unsupported MIME', () => {
    expect(() =>
      projectOwnedSourceResource({
        ...readySource,
        mimeType: 'application/x-unknown',
      }),
    ).toThrow(
      expect.objectContaining<Partial<SourceResourceProjectionError>>({
        code: 'renderer_not_found',
      }),
    );
  });

  it('derives actions from server policy and ignores caller-shaped extras', () => {
    const resource = projectOwnedSourceResource({
      ...readySource,
      mimeType: 'text/plain',
      allowedActions: ['run'],
      rendererId: 'attacker.renderer',
      trustTier: 'tier3',
    } as SourceResourceProjectionInput);

    expect(resource.allowedActions).toEqual(['view', 'rename', 'delete']);
    expect(resource.renderer.rendererId).toBe('source.text');
    expect(resource.trustTier).toBe('tier1');
  });

  it('does not grant delete to a read-only collaborator', () => {
    const resource = projectOwnedSourceResource({
      ...readySource,
      accessRole: 'viewer',
    });

    expect(resource.allowedActions).toEqual(['view', 'download']);
  });
});
