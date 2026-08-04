import { describe, expect, it } from 'vitest';
import {
  createTuiCanvasList,
  renderTuiCanvasList,
  renderTuiCanvasOpen,
} from './canvas-renderer';

function resource(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    resourceId: 'artifact:1',
    notebookId: 'notebook:1',
    resourceKind: 'artifact',
    title: '实验结果',
    status: 'ready',
    version: { versionId: 'v:1', sequence: 1, checksum: null },
    representation: {
      kind: 'structured',
      mimeType: 'application/json',
      byteSize: null,
    },
    renderer: { rendererId: 'artifact.note', rendererVersion: 1 },
    trustTier: 'tier1',
    allowedActions: ['view'],
    canProduceCandidateLearningEvents: false,
    provenance: {
      origin: 'agent_generated',
      createdBy: 'agent',
      createdAt: '2026-08-04T00:00:00.000Z',
      sourceResourceIds: [],
      operationId: null,
      generator: null,
    },
    runtime: { kind: 'none' },
    ...overrides,
  };
}

describe('TUI Canvas rendering', () => {
  it('lists reviewed metadata and an honest handoff requirement', () => {
    const output = renderTuiCanvasList(
      createTuiCanvasList([resource()], 'notebook:1'),
    );
    expect(output).toContain('实验结果 · 可查看 · 需在 Web 打开');
    expect(output).not.toContain('artifact:1');
  });

  it('does not reveal a cross-Notebook title', () => {
    const output = renderTuiCanvasList(
      createTuiCanvasList([resource()], 'notebook:other'),
    );
    expect(output).toContain('Canvas 资源不可用');
    expect(output).not.toContain('实验结果');
  });

  it('renders inline text and stable unavailable copy', () => {
    expect(
      renderTuiCanvasOpen({
        kind: 'inline_text',
        title: '摘要',
        text: '正文',
      }),
    ).toContain('摘要\n正文');
    expect(
      renderTuiCanvasOpen({
        kind: 'unavailable',
        reason: 'resource_not_found',
      }),
    ).toBe('这个 Canvas 资源当前不可用或没有访问权限。\n');
  });
});
