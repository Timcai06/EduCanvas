import { describe, expect, it } from 'vitest';
import { resolveSourceRendererState } from './source-resource-renderer-state';
import type { CanvasResource } from '@educanvas/canvas-protocol';
import type { AssetPreview } from './asset-preview-contract';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PDF_FIXTURE = fileURLToPath(
  new URL('../../../../tests/fixtures/sample-1page.pdf', import.meta.url),
);
const PNG_FIXTURE = fileURLToPath(
  new URL('../../../../tests/fixtures/sample-1x1.png', import.meta.url),
);

function makeResource(overrides: Partial<CanvasResource> = {}): CanvasResource {
  return {
    schemaVersion: 1,
    resourceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    notebookId: 'bbbb0000-0000-4000-8000-000000000001',
    resourceKind: 'source',
    title: '测试来源',
    status: 'ready',
    version: {
      versionId: 'cccc0000-0000-4000-8000-000000000001',
      sequence: 1,
      checksum: 'a'.repeat(64),
    },
    representation: {
      kind: 'document',
      mimeType: 'application/pdf',
      byteSize: 1024,
    },
    renderer: { rendererId: 'source.pdf', rendererVersion: 1 },
    trustTier: 'tier1',
    allowedActions: ['view'],
    canProduceCandidateLearningEvents: false,
    provenance: {
      origin: 'upload',
      createdBy: 'user',
      createdAt: '2026-07-28T00:00:00.000Z',
      sourceResourceIds: [],
      operationId: null,
      generator: null,
    },
    runtime: { kind: 'none' },
    ...overrides,
  };
}

describe('resolveSourceRendererState', () => {
  it('processing 状态返回 loading', () => {
    const result = resolveSourceRendererState(
      makeResource({ status: 'processing' }),
      null,
      false,
    );
    expect(result.state).toBe('loading');
  });

  it('failed 状态返回 failed', () => {
    const result = resolveSourceRendererState(
      makeResource({ status: 'failed' }),
      null,
      false,
    );
    expect(result.state).toBe('failed');
    expect(result.errorMessage).toContain('处理失败');
  });

  it('unavailable 状态返回 unavailable', () => {
    const result = resolveSourceRendererState(
      makeResource({ status: 'unavailable' }),
      null,
      false,
    );
    expect(result.state).toBe('unavailable');
  });

  it('archived 状态返回 unavailable', () => {
    const result = resolveSourceRendererState(
      makeResource({ status: 'archived' }),
      null,
      false,
    );
    expect(result.state).toBe('unavailable');
  });

  it('ready + 无预览返回 loading', () => {
    const result = resolveSourceRendererState(
      makeResource({ status: 'ready' }),
      null,
      false,
    );
    expect(result.state).toBe('loading');
  });

  it('ready + 有预览返回 ready', () => {
    const preview: AssetPreview = {
      kind: 'pdf',
      fileName: 'fixture.pdf',
      mimeType: 'application/pdf',
      fileUrl: '/api/v1/chat/assets/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/file',
    };
    const result = resolveSourceRendererState(
      makeResource({ status: 'ready' }),
      preview,
      false,
    );
    expect(result.state).toBe('ready');
  });

  it('缺少 view 动作返回 denied', () => {
    const result = resolveSourceRendererState(
      makeResource({ status: 'ready', allowedActions: [] }),
      null,
      false,
    );
    expect(result.state).toBe('denied');
  });

  it('预览读取失败返回 failed', () => {
    const result = resolveSourceRendererState(
      makeResource({ status: 'ready' }),
      null,
      true,
    );
    expect(result.state).toBe('failed');
  });

  it('空文本返回 empty', () => {
    const result = resolveSourceRendererState(
      makeResource({ status: 'ready' }),
      {
        kind: 'text',
        fileName: 'empty.txt',
        mimeType: 'text/plain',
        content: '   ',
      },
      false,
    );
    expect(result.state).toBe('empty');
  });

  it('错误消息不包含堆栈或内部信息', () => {
    const result = resolveSourceRendererState(
      makeResource({ status: 'failed' }),
      null,
      false,
    );
    expect(result.errorMessage).not.toContain('stack');
    expect(result.errorMessage).not.toContain('storageKey');
    expect(result.errorMessage).not.toContain('objectKey');
    expect(result.errorMessage).not.toContain('Error');
  });

  it('PDF fixture 是可定位的一页 PDF 文件', () => {
    const bytes = readFileSync(PDF_FIXTURE);
    expect(bytes.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(bytes.toString('latin1')).toContain('/Type/Page');
  });

  it('图片 fixture 是可定位的 PNG 文件', () => {
    const bytes = readFileSync(PNG_FIXTURE);
    expect(Array.from(bytes.subarray(0, 8))).toEqual([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
  });
});
