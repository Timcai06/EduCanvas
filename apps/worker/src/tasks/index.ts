import { OPERATION_CONTINUATION_TASK } from '@educanvas/agent-core';
import {
  ARTIFACT_GENERATE_TASK,
  ASSET_EXTRACT_TEXT_TASK,
  ASSET_GENERATE_THUMBNAIL_TASK,
  ASSET_PROCESS_VIDEO_TASK,
  ASSET_RENDER_PREVIEW_TASK,
  ASSET_TRANSCRIBE_AUDIO_TASK,
} from '@educanvas/db';
import type { ContinuationTracePort } from '@educanvas/telemetry';
import type { TaskList } from 'graphile-worker';
import {
  embedKnowledgeDocument,
  KNOWLEDGE_EMBED_DOCUMENT_TASK,
} from './embed-knowledge-document.js';
import { generateArtifact } from './generate-artifact.js';
import { ingestKnowledgeDocument } from './ingest-knowledge-document.js';
import { purgeAnonymousSubjects } from './purge-anonymous-subjects.js';
import { recoverOperationContinuations } from './recover-operation-continuations.js';
import { reconcileToolApprovalIntents } from './reconcile-tool-approval-intents.js';
import { systemHeartbeat } from './system-heartbeat.js';
import { createProductionContinueOperationTask } from './continue-operation.js';
import {
  backfillK12Conversation,
  K12_CONVERSATION_BACKFILL_TASK,
} from './backfill-k12-conversation.js';
import { deleteObjectOutbox } from './delete-object-outbox.js';
import { extractAssetTextTask } from './extract-asset-text.js';
import { renderPreviewTask } from './render-preview.js';
import { generateThumbnailTask } from './generate-thumbnail.js';
import { processVideoTask } from './process-video.js';
import { transcribeAudioTask } from './transcribe-audio.js';

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
    [ASSET_TRANSCRIBE_AUDIO_TASK]: transcribeAudioTask,
    [ASSET_PROCESS_VIDEO_TASK]: processVideoTask,
    [OPERATION_CONTINUATION_TASK]: createProductionContinueOperationTask(
      input.continuationTrace,
    ),
    'knowledge:ingest_document': ingestKnowledgeDocument,
    [KNOWLEDGE_EMBED_DOCUMENT_TASK]: embedKnowledgeDocument,
    'maintenance:purge_anonymous_subjects': purgeAnonymousSubjects,
    'maintenance:delete_object_outbox': deleteObjectOutbox,
    'maintenance:recover_operation_continuations':
      recoverOperationContinuations,
    'maintenance:reconcile_tool_approval_intents': reconcileToolApprovalIntents,
    [K12_CONVERSATION_BACKFILL_TASK]: backfillK12Conversation,
    'system.heartbeat': systemHeartbeat,
  };
}
