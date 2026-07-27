import { OPERATION_CONTINUATION_TASK } from '@educanvas/agent-core';
import {
  ARTIFACT_GENERATE_TASK,
  ASSET_EXTRACT_TEXT_TASK,
  ASSET_GENERATE_THUMBNAIL_TASK,
  ASSET_RENDER_PREVIEW_TASK,
} from '@educanvas/db';
import type { ContinuationTracePort } from '@educanvas/telemetry';
import type { TaskList } from 'graphile-worker';
import { generateArtifact } from './generate-artifact.js';
import { ingestKnowledgeDocument } from './ingest-knowledge-document.js';
import { purgeAnonymousSubjects } from './purge-anonymous-subjects.js';
import { recoverOperationContinuations } from './recover-operation-continuations.js';
import { reconcileToolApprovalIntents } from './reconcile-tool-approval-intents.js';
import { systemHeartbeat } from './system-heartbeat.js';
import { createProductionContinueOperationTask } from './continue-operation.js';
import { deleteObjectOutbox } from './delete-object-outbox.js';
import { extractAssetTextTask } from './extract-asset-text.js';
import { renderPreviewTask } from './render-preview.js';
import { generateThumbnailTask } from './generate-thumbnail.js';

/**
 * worker 的任务注册表。周期任务使用Graphile crontab兼容的 `域:动作` 命名;
 * 任务只能通过本注册表暴露,与 Tool Registry 同样是编译期显式白名单,
 * 不做运行时动态注册。
 */
export function createTaskList(input: {
  continuationTrace: ContinuationTracePort;
}): TaskList {
  return {
    [ARTIFACT_GENERATE_TASK]: generateArtifact,
    [ASSET_EXTRACT_TEXT_TASK]: extractAssetTextTask,
    [ASSET_RENDER_PREVIEW_TASK]: renderPreviewTask,
    [ASSET_GENERATE_THUMBNAIL_TASK]: generateThumbnailTask,
    [OPERATION_CONTINUATION_TASK]: createProductionContinueOperationTask(
      input.continuationTrace,
    ),
    'knowledge:ingest_document': ingestKnowledgeDocument,
    'maintenance:purge_anonymous_subjects': purgeAnonymousSubjects,
    'maintenance:delete_object_outbox': deleteObjectOutbox,
    'maintenance:recover_operation_continuations':
      recoverOperationContinuations,
    'maintenance:reconcile_tool_approval_intents': reconcileToolApprovalIntents,
    'system.heartbeat': systemHeartbeat,
  };
}
