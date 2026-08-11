import 'server-only';

import {
  DrizzleResourceAnnotationRepository,
  type ResourceAnnotationRow,
} from '@educanvas/db';
import type {
  CanvasAnnotation,
  CanvasResource,
  CanvasResourceKind,
  CreateCanvasAnnotation,
} from '@educanvas/canvas-protocol';
import type { AnonymousIdentity } from '../identity/anonymous-identity';
import {
  CanvasResourceAccessError,
  loadOwnedCanvasResource,
} from './resource-access';

function databaseResourceKind(
  resourceKind: CanvasResourceKind,
): 'asset' | 'artifact' {
  return resourceKind === 'source' ? 'asset' : 'artifact';
}

function projectAnnotation(
  row: ResourceAnnotationRow,
  resourceKind: CanvasResourceKind,
): CanvasAnnotation {
  return {
    id: row.id,
    notebookId: row.spaceId,
    resourceKind,
    resourceId: row.resourceId,
    resourceVersionId: row.resourceVersionId,
    authorPen: row.authorPen as CanvasAnnotation['authorPen'],
    kind: row.kind as CanvasAnnotation['kind'],
    geometry: row.geometry as CanvasAnnotation['geometry'],
    body: row.body,
    source: row.source as CanvasAnnotation['source'],
    createdAt: row.createdAt.toISOString(),
  };
}

async function requireAnnotatableResource(input: {
  identity: AnonymousIdentity;
  notebookId: string;
  resourceKind: CanvasResourceKind;
  resourceId: string;
}): Promise<CanvasResource> {
  const resource = await loadOwnedCanvasResource(input);
  if (!resource.allowedActions.includes('annotate')) {
    // 与不存在、跨 Notebook 使用同一外观，避免暴露资源能力差异。
    throw new CanvasResourceAccessError('resource_not_found', 404);
  }
  return resource;
}

export async function listOwnedResourceAnnotations(input: {
  identity: AnonymousIdentity;
  notebookId: string;
  resourceKind: CanvasResourceKind;
  resourceId: string;
}): Promise<readonly CanvasAnnotation[]> {
  await requireAnnotatableResource(input);
  const rows = await new DrizzleResourceAnnotationRepository().listForResource({
    spaceId: input.notebookId,
    ownerSubjectId: input.identity.studentId,
    resourceKind: databaseResourceKind(input.resourceKind),
    resourceId: input.resourceId,
  });
  return rows.map((row) => projectAnnotation(row, input.resourceKind));
}

export async function createOwnedResourceAnnotation(input: {
  identity: AnonymousIdentity;
  notebookId: string;
  resourceKind: CanvasResourceKind;
  resourceId: string;
  annotation: CreateCanvasAnnotation;
}): Promise<CanvasAnnotation> {
  const resource = await requireAnnotatableResource(input);
  const requestedVersionId = input.annotation.resourceVersionId ?? null;
  if (
    requestedVersionId !== null &&
    requestedVersionId !== resource.version?.versionId
  ) {
    throw new CanvasResourceAccessError('resource_not_found', 404);
  }
  const row = await new DrizzleResourceAnnotationRepository().create({
    spaceId: input.notebookId,
    resourceKind: databaseResourceKind(input.resourceKind),
    resourceId: input.resourceId,
    resourceVersionId:
      requestedVersionId ?? resource.version?.versionId ?? null,
    ownerSubjectId: input.identity.studentId,
    // Voice 内的圈点是老师朱批；Canvas/Chat 中用户直接落笔使用黛色。
    authorPen: input.annotation.source === 'voice' ? 'zhusha' : 'dai',
    kind: input.annotation.kind,
    geometry: input.annotation.geometry,
    body: input.annotation.body ?? null,
    source: input.annotation.source,
  });
  return projectAnnotation(row, input.resourceKind);
}

export async function removeOwnedResourceAnnotation(input: {
  identity: AnonymousIdentity;
  notebookId: string;
  resourceKind: CanvasResourceKind;
  resourceId: string;
  annotationId: string;
}): Promise<boolean> {
  await requireAnnotatableResource(input);
  return new DrizzleResourceAnnotationRepository().remove({
    id: input.annotationId,
    spaceId: input.notebookId,
    resourceKind: databaseResourceKind(input.resourceKind),
    resourceId: input.resourceId,
    ownerSubjectId: input.identity.studentId,
  });
}
