import { describe, expect, it } from 'vitest';
import {
  canvasResourceSchema,
  validateCanvasResource,
  type CanvasResource,
} from './resource';

function createResource(
  overrides: Partial<CanvasResource> = {},
): CanvasResource {
  return {
    schemaVersion: 1,
    resourceId: 'asset-1',
    notebookId: 'notebook-1',
    resourceKind: 'source',
    title: '函数图像.pdf',
    status: 'ready',
    version: {
      versionId: 'asset-version-1',
      sequence: null,
      checksum: 'a'.repeat(64),
    },
    representation: {
      kind: 'document',
      mimeType: 'application/pdf',
      byteSize: 4_096,
    },
    renderer: {
      rendererId: 'source.pdf',
      rendererVersion: 1,
    },
    trustTier: 'tier1',
    allowedActions: ['view', 'download', 'annotate'],
    canProduceCandidateLearningEvents: false,
    provenance: {
      origin: 'upload',
      createdBy: 'user',
      createdAt: '2026-07-25T12:00:00+08:00',
      sourceResourceIds: [],
      operationId: null,
      generator: null,
    },
    runtime: { kind: 'none' },
    ...overrides,
  };
}

describe('canvasResourceSchema', () => {
  it('接受不暴露存储地址的Source描述', () => {
    const result = canvasResourceSchema.safeParse(createResource());

    expect(result.success).toBe(true);
    expect(result.data).not.toHaveProperty('objectKey');
  });

  it('接受受限Tier 2沙箱资源', () => {
    const result = canvasResourceSchema.safeParse(
      createResource({
        resourceId: 'artifact-1',
        resourceKind: 'artifact',
        representation: {
          kind: 'interactive_app',
          mimeType: 'application/vnd.educanvas.sandbox+json',
          byteSize: 16_384,
        },
        renderer: {
          rendererId: 'artifact.sandbox-app',
          rendererVersion: 1,
        },
        trustTier: 'tier2',
        allowedActions: ['view', 'run', 'cancel'],
        runtime: {
          kind: 'web_sandbox',
          protocolVersion: 1,
          maxDurationMs: 30_000,
          maxOutputBytes: 1_048_576,
          network: 'none',
        },
      }),
    );

    expect(result.success).toBe(true);
  });

  it('允许尚未产生版本的处理中Artifact但拒绝ready资源伪造空版本', () => {
    expect(
      canvasResourceSchema.safeParse(
        createResource({
          resourceKind: 'artifact',
          status: 'processing',
          version: null,
        }),
      ).success,
    ).toBe(true);

    expect(
      canvasResourceSchema.safeParse(
        createResource({
          status: 'ready',
          version: null,
        }),
      ).success,
    ).toBe(false);
  });

  it('拒绝重复动作和重复来源', () => {
    const result = canvasResourceSchema.safeParse(
      createResource({
        allowedActions: ['view', 'view'],
        provenance: {
          origin: 'derived',
          createdBy: 'agent',
          createdAt: '2026-07-25T12:00:00+08:00',
          sourceResourceIds: ['asset-parent', 'asset-parent'],
          operationId: 'operation-1',
          generator: {
            provider: 'provider',
            model: 'model',
            promptSummary: '根据所选来源生成摘要',
          },
        },
      }),
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.message)).toEqual(
        expect.arrayContaining([
          'allowedActions不能重复',
          'sourceResourceIds不能重复',
        ]),
      );
    }
  });

  it('拒绝非Tier 1资源声明候选学习事件能力', () => {
    const result = canvasResourceSchema.safeParse(
      createResource({
        trustTier: 'tier2',
        allowedActions: ['view', 'submit_candidate_learning_event'],
        canProduceCandidateLearningEvents: true,
        runtime: {
          kind: 'web_sandbox',
          protocolVersion: 1,
          maxDurationMs: 30_000,
          maxOutputBytes: 1_048_576,
          network: 'none',
        },
      }),
    );

    expect(result.success).toBe(false);
  });

  it('拒绝信任层与Runtime不匹配', () => {
    const result = canvasResourceSchema.safeParse(
      createResource({
        trustTier: 'tier3',
        runtime: {
          kind: 'web_sandbox',
          protocolVersion: 1,
          maxDurationMs: 30_000,
          maxOutputBytes: 1_048_576,
          network: 'none',
        },
      }),
    );

    expect(result.success).toBe(false);
  });

  it('拒绝对象存储键等未评审字段', () => {
    const result = canvasResourceSchema.safeParse({
      ...createResource(),
      objectKey: 'uploads/private.pdf',
    });

    expect(result.success).toBe(false);
  });
});

describe('validateCanvasResource', () => {
  it('返回判别结果而不是向Renderer抛出Zod异常', () => {
    expect(validateCanvasResource(createResource())).toMatchObject({
      ok: true,
    });

    const invalid = validateCanvasResource({
      ...createResource(),
      schemaVersion: 2,
    });
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) {
      expect(invalid.errors[0]).toContain('schemaVersion');
    }
  });
});
