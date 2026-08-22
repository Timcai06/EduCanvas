import { describe, expect, it, vi } from 'vitest';
import { TuiCanvasCommand } from './canvas-command';

const conversation = {
  notebookId: 'notebook:1',
  conversationId: 'conversation:1',
  title: 'Notebook',
  agentProfileId: 'general',
  membershipRole: 'owner' as const,
};

const resource = {
  schemaVersion: 1 as const,
  resourceId: 'artifact:1',
  notebookId: 'notebook:1',
  resourceKind: 'artifact' as const,
  title: '实验结果',
  status: 'ready' as const,
  version: { versionId: 'version:1', sequence: 1, checksum: null },
  representation: {
    kind: 'structured' as const,
    mimeType: 'application/json',
    byteSize: null,
  },
  renderer: { rendererId: 'artifact.note', rendererVersion: 1 },
  trustTier: 'tier1' as const,
  allowedActions: ['view' as const],
  canProduceCandidateLearningEvents: false,
  provenance: {
    origin: 'agent_generated' as const,
    createdBy: 'agent' as const,
    createdAt: '2026-08-04T00:00:00.000Z',
    sourceResourceIds: [],
    operationId: null,
    generator: null,
  },
  runtime: { kind: 'none' as const },
};

describe('TuiCanvasCommand', () => {
  it('lists current-Notebook resources and opens a one-time Web handoff', async () => {
    const out = vi.fn();
    const openWeb = vi.fn();
    const client = {
      listCanvasResources: vi.fn(async () => [resource]),
      createHandoff: vi.fn(async () => ({
        token: 'h'.repeat(43),
        expiresAt: '2026-08-04T00:02:00.000Z',
      })),
    };
    const command = new TuiCanvasCommand(
      client,
      'http://127.0.0.1:3000',
      openWeb,
      out,
      vi.fn(),
    );

    expect(await command.handle('/canvas', conversation)).toBe(true);
    expect(out).toHaveBeenCalledWith(expect.stringContaining('实验结果'));
    expect(await command.handle('/canvas 1', conversation)).toBe(true);
    expect(openWeb).toHaveBeenCalledWith(
      `http://127.0.0.1:3000/open?token=${'h'.repeat(43)}`,
    );
    expect(client.createHandoff).toHaveBeenCalledWith('conversation:1');
  });

  it('resets the cached resource directory after a Notebook switch', async () => {
    const client = {
      listCanvasResources: vi.fn(async () => [resource]),
      createHandoff: vi.fn(),
    };
    const command = new TuiCanvasCommand(
      client,
      'http://127.0.0.1:3000',
      vi.fn(),
      vi.fn(),
      vi.fn(),
    );
    await command.handle('/canvas', conversation);
    command.reset();
    await command.handle('/canvas', conversation);
    expect(client.listCanvasResources).toHaveBeenCalledTimes(2);
  });
});
