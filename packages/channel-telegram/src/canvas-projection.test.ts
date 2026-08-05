import { describe, expect, it } from 'vitest';
import {
  projectTelegramCanvasResource,
  TELEGRAM_CANVAS_SUMMARY_MAX_CHARS,
} from './canvas-projection';

/**
 * Canvas 投影测试聚焦两个点：
 * 1) 在 Telegram 这类非 Web 通道上不泄漏可执行或敏感字段；
 * 2) 保持状态语义一致且输出长度始终受限。
 */

function resource(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    resourceId: 'artifact:1',
    notebookId: 'notebook:1',
    resourceKind: 'artifact',
    title: '函数实验',
    status: 'ready',
    version: { versionId: 'version:1', sequence: 1, checksum: null },
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
      operationId: 'operation:private',
      generator: {
        provider: 'private-provider',
        model: 'private-model',
        promptSummary: 'private prompt summary',
      },
    },
    runtime: { kind: 'none' },
    ...overrides,
  };
}

describe('projectTelegramCanvasResource', () => {
  it.each([
    ['processing', '正在处理'],
    ['ready', '资源已就绪'],
    ['failed', '处理失败'],
    ['unavailable', '当前不可用'],
    ['archived', '已经归档'],
  ])('projects %s with an honest bounded status', (status, expected) => {
    const output = projectTelegramCanvasResource({
      resource: resource({ status }),
      currentNotebookId: 'notebook:1',
    });
    expect(output).toContain(expected);
    expect(output.length).toBeLessThanOrEqual(
      TELEGRAM_CANVAS_SUMMARY_MAX_CHARS,
    );
  });

  it('refuses to pretend an interactive Runtime ran in Telegram', () => {
    const output = projectTelegramCanvasResource({
      resource: resource({
        representation: {
          kind: 'interactive_app',
          mimeType: 'application/vnd.educanvas.dom-exploration+json',
          byteSize: null,
        },
        renderer: {
          rendererId: 'artifact.dom-exploration',
          rendererVersion: 1,
        },
        trustTier: 'tier2',
        runtime: {
          kind: 'web_sandbox',
          protocolVersion: 1,
          maxDurationMs: 30_000,
          maxOutputBytes: 1_024,
          network: 'none',
        },
      }),
      currentNotebookId: 'notebook:1',
    });
    expect(output).toContain('需要受控 Web Runtime');
    expect(output).toContain('不会执行');
    expect(output).not.toContain('执行成功');
  });

  it('does not project private provenance, prompts or internal identifiers', () => {
    const output = projectTelegramCanvasResource({
      resource: resource(),
      currentNotebookId: 'notebook:1',
    });
    for (const forbidden of [
      'private-provider',
      'private-model',
      'private prompt summary',
      'operation:private',
      'artifact:1',
      'version:1',
    ]) {
      expect(output).not.toContain(forbidden);
    }
  });

  it('hides cross-Notebook and schema-invalid resources identically', () => {
    const crossNotebook = projectTelegramCanvasResource({
      resource: resource(),
      currentNotebookId: 'notebook:other',
    });
    const invalid = projectTelegramCanvasResource({
      resource: resource({ storageKey: 'private/key' }),
      currentNotebookId: 'notebook:1',
    });
    expect(crossNotebook).toBe('Canvas 资源不可用。');
    expect(invalid).toBe(crossNotebook);
    expect(invalid).not.toContain('private/key');
  });
});
