import 'server-only';

import {
  canvasResourceSchema,
  type CanvasRepresentationKind,
  type CanvasResource,
  type CanvasResourceAction,
  type CanvasResourceErrorCode,
} from '@educanvas/canvas-protocol';
import type { AssetOrigin, AssetStatus } from '@educanvas/agent-core';

const SOURCE_RENDERERS = {
  'application/pdf': {
    representation: 'document',
    rendererId: 'source.pdf',
    downloadable: true,
  },
  'image/png': {
    representation: 'image',
    rendererId: 'source.image',
    downloadable: true,
  },
  'image/jpeg': {
    representation: 'image',
    rendererId: 'source.image',
    downloadable: true,
  },
  'image/webp': {
    representation: 'image',
    rendererId: 'source.image',
    downloadable: true,
  },
  'text/markdown': {
    representation: 'text',
    rendererId: 'source.markdown',
    downloadable: false,
  },
  'text/plain': {
    representation: 'text',
    rendererId: 'source.text',
    downloadable: false,
  },
  'application/vnd.openxmlformats-officedocument.wordprocessingml': {
    representation: 'document',
    rendererId: 'source.docx',
    downloadable: false,
  },
} as const satisfies Record<
  string,
  {
    representation: CanvasRepresentationKind;
    rendererId: string;
    downloadable: boolean;
  }
>;

export class SourceResourceProjectionError extends Error {
  constructor(
    readonly code: CanvasResourceErrorCode,
    readonly status: 422 | 503,
  ) {
    super(code);
    this.name = 'SourceResourceProjectionError';
  }
}

export interface SourceResourceProjectionInput {
  assetId: string;
  notebookId: string;
  title: string;
  mimeType: string;
  status: AssetStatus;
  origin: AssetOrigin;
  createdAt: string;
  version: {
    versionId: string;
    byteSize: number;
    checksum: string;
  } | null;
}

function resourceStatus(status: AssetStatus): CanvasResource['status'] {
  switch (status) {
    case 'pending':
    case 'processing':
      return 'processing';
    case 'ready':
      return 'ready';
    case 'failed':
      return 'failed';
    case 'tombstoned':
      return 'unavailable';
  }
}

function provenance(origin: AssetOrigin): {
  origin: CanvasResource['provenance']['origin'];
  createdBy: CanvasResource['provenance']['createdBy'];
} {
  switch (origin) {
    case 'url_import':
      return { origin: 'url_import', createdBy: 'import' };
    case 'generated':
      return { origin: 'derived', createdBy: 'agent' };
    case 'library':
      return { origin: 'derived', createdBy: 'import' };
    case 'upload':
      return { origin: 'upload', createdBy: 'user' };
  }
}

function allowedActions(
  status: CanvasResource['status'],
  downloadable: boolean,
): CanvasResourceAction[] {
  if (status !== 'ready') return [];
  return downloadable ? ['view', 'download', 'delete'] : ['view', 'delete'];
}

/**
 * 将已经完成主体与Notebook归属校验的Source事实投影为浏览器安全资源描述。
 * 该函数不读取内容，也不接受客户端提交的renderer、动作或信任层。
 */
export function projectOwnedSourceResource(
  input: SourceResourceProjectionInput,
): CanvasResource {
  const renderer =
    SOURCE_RENDERERS[input.mimeType as keyof typeof SOURCE_RENDERERS];
  if (!renderer) {
    throw new SourceResourceProjectionError('renderer_not_found', 422);
  }

  const status = resourceStatus(input.status);
  const sourceProvenance = provenance(input.origin);
  const parsed = canvasResourceSchema.safeParse({
    schemaVersion: 1,
    resourceId: input.assetId,
    notebookId: input.notebookId,
    resourceKind: 'source',
    title: input.title,
    status,
    version: input.version
      ? {
          versionId: input.version.versionId,
          // Source版本只有不可变ID，没有可证明的数字序号。
          sequence: null,
          checksum: input.version.checksum,
        }
      : null,
    representation: {
      kind: renderer.representation,
      mimeType: input.mimeType,
      byteSize: input.version?.byteSize ?? null,
    },
    renderer: {
      rendererId: renderer.rendererId,
      rendererVersion: 1,
    },
    trustTier: 'tier1',
    allowedActions: allowedActions(status, renderer.downloadable),
    canProduceCandidateLearningEvents: false,
    provenance: {
      ...sourceProvenance,
      createdAt: input.createdAt,
      sourceResourceIds: [],
      operationId: null,
      generator: null,
    },
    runtime: { kind: 'none' },
  });
  if (!parsed.success) {
    throw new SourceResourceProjectionError('resource_invalid', 422);
  }
  return parsed.data;
}
