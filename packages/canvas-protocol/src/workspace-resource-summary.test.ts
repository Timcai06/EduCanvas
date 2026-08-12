import { describe, expect, it } from 'vitest';
import {
  parseWorkspaceResourceSummary,
  workspaceResourceSummarySchema,
  type WorkspaceArtifactResourceSummary,
  type WorkspaceSourceResourceSummary,
} from './workspace-resource-summary';

function sourceSummary(
  overrides: Partial<WorkspaceSourceResourceSummary> = {},
): WorkspaceSourceResourceSummary {
  return {
    schemaVersion: 1,
    resourceKind: 'source',
    resourceId: 'asset-1',
    notebookId: 'notebook-1',
    title: '函数图像.pdf',
    updatedAt: '2026-08-12T12:00:00.000Z',
    status: 'ready',
    version: { versionId: 'asset-version-1', sequence: null },
    renderer: { rendererId: 'source.pdf', rendererVersion: 1 },
    allowedActions: ['view', 'download', 'annotate'],
    provenance: { sourceResourceIds: [], sourceReferences: [] },
    context: { enabled: true },
    surface: { restState: 'pinned' },
    ...overrides,
  };
}

function artifactSummary(
  overrides: Partial<WorkspaceArtifactResourceSummary> = {},
): WorkspaceArtifactResourceSummary {
  return {
    schemaVersion: 1,
    resourceKind: 'artifact',
    resourceId: 'artifact-1',
    notebookId: 'notebook-1',
    title: '函数图像讲义',
    updatedAt: '2026-08-12T12:01:00.000Z',
    status: 'ready',
    version: { versionId: 'artifact-version-2', sequence: 2 },
    renderer: {
      rendererId: 'artifact.markdown-document',
      rendererVersion: 1,
    },
    allowedActions: ['view', 'edit', 'download'],
    provenance: {
      sourceResourceIds: ['asset-1'],
      sourceReferences: [
        { resourceId: 'asset-1', versionId: 'asset-version-1' },
      ],
    },
    surface: { restState: null },
    ...overrides,
  };
}

describe('workspaceResourceSummarySchema', () => {
  it('接受 Source 的真实版本、context 和共享 surface 状态', () => {
    expect(workspaceResourceSummarySchema.parse(sourceSummary())).toEqual(
      sourceSummary(),
    );
  });

  it('接受 Artifact 的数字版本和有限 Source provenance', () => {
    expect(workspaceResourceSummarySchema.parse(artifactSummary())).toEqual(
      artifactSummary(),
    );
  });

  it.each([
    ['resource kind', { ...sourceSummary(), resourceKind: 'video' }],
    ['lifecycle status', { ...sourceSummary(), status: 'queued' }],
    ['schema version', { ...sourceSummary(), schemaVersion: 2 }],
    [
      'surface rest state',
      { ...sourceSummary(), surface: { restState: 'hidden' } },
    ],
  ])('未知 %s fail closed', (_label, value) => {
    expect(workspaceResourceSummarySchema.safeParse(value).success).toBe(false);
  });

  it('严格区分 Source 与 Artifact 分支', () => {
    expect(
      workspaceResourceSummarySchema.safeParse({
        ...sourceSummary(),
        version: { versionId: 'asset-version-1', sequence: 1 },
      }).success,
    ).toBe(false);

    expect(
      workspaceResourceSummarySchema.safeParse({
        ...artifactSummary(),
        context: { enabled: true },
      }).success,
    ).toBe(false);

    expect(
      workspaceResourceSummarySchema.safeParse({
        ...artifactSummary(),
        version: { versionId: 'artifact-version-2', sequence: null },
      }).success,
    ).toBe(false);
  });

  it('拒绝 ready/archived 空版本、重复动作和重复 provenance Source', () => {
    expect(
      workspaceResourceSummarySchema.safeParse(sourceSummary({ version: null }))
        .success,
    ).toBe(false);
    expect(
      workspaceResourceSummarySchema.safeParse(
        artifactSummary({ status: 'archived', version: null }),
      ).success,
    ).toBe(false);
    expect(
      workspaceResourceSummarySchema.safeParse(
        sourceSummary({ allowedActions: ['view', 'view'] }),
      ).success,
    ).toBe(false);
    expect(
      workspaceResourceSummarySchema.safeParse(
        artifactSummary({
          provenance: {
            sourceResourceIds: ['asset-1'],
            sourceReferences: [
              { resourceId: 'asset-1', versionId: 'asset-version-1' },
              { resourceId: 'asset-1', versionId: 'asset-version-2' },
            ],
          },
        }),
      ).success,
    ).toBe(false);
  });

  it.each([
    ['content', '# 私有正文'],
    ['objectKey', 'uploads/private.pdf'],
    ['prompt', 'system prompt'],
    ['providerBody', { raw: true }],
    ['credential', 'secret-token'],
  ])('拒绝额外的 %s 字段', (field, value) => {
    expect(
      workspaceResourceSummarySchema.safeParse({
        ...artifactSummary(),
        [field]: value,
      }).success,
    ).toBe(false);
  });

  it('嵌套对象同样拒绝额外字段', () => {
    expect(
      workspaceResourceSummarySchema.safeParse({
        ...artifactSummary(),
        provenance: {
          ...artifactSummary().provenance,
          provider: 'private-provider',
        },
      }).success,
    ).toBe(false);
    expect(
      workspaceResourceSummarySchema.safeParse({
        ...sourceSummary(),
        version: {
          versionId: 'asset-version-1',
          sequence: null,
          objectKey: 'uploads/private.pdf',
        },
      }).success,
    ).toBe(false);
  });
});

describe('parseWorkspaceResourceSummary', () => {
  it('返回判别结果，调用方无需捕获 Zod 异常', () => {
    expect(parseWorkspaceResourceSummary(sourceSummary())).toMatchObject({
      ok: true,
      summary: { resourceKind: 'source' },
    });
    expect(
      parseWorkspaceResourceSummary({
        ...artifactSummary(),
        schemaVersion: 99,
      }),
    ).toMatchObject({ ok: false });
  });
});
