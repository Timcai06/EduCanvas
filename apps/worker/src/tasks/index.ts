import { OPERATION_CONTINUATION_TASK } from '@educanvas/agent-core';
import {
  ARTIFACT_GENERATE_TASK,
  ASSET_EXTRACT_TEXT_TASK,
  ASSET_GENERATE_THUMBNAIL_TASK,
  ASSET_PROCESS_VIDEO_TASK,
  ASSET_RENDER_PREVIEW_TASK,
  ASSET_TRANSCRIBE_AUDIO_TASK,
  type GatewayTerminalReconciliationMode,
} from '@educanvas/db';
import {
  recordMetricSafely,
  type ContinuationTracePort,
  type MetricsPort,
} from '@educanvas/telemetry';
import type { Task, TaskList } from 'graphile-worker';
import {
  embedKnowledgeDocument,
  KNOWLEDGE_EMBED_DOCUMENT_TASK,
} from './embed-knowledge-document.js';
import { generateArtifact } from './generate-artifact.js';
import {
  ingestKnowledgeDocument,
  KNOWLEDGE_INGEST_DOCUMENT_TASK,
} from './ingest-knowledge-document.js';
import { purgeAnonymousSubjects } from './purge-anonymous-subjects.js';
import { recoverOperationContinuations } from './recover-operation-continuations.js';
import { reconcileToolApprovalIntents } from './reconcile-tool-approval-intents.js';
import { systemHeartbeat } from './system-heartbeat.js';
import { createProductionContinueOperationTask } from './continue-operation.js';
import { deleteObjectOutbox } from './delete-object-outbox.js';
import { extractAssetTextTask } from './extract-asset-text.js';
import { renderPreviewTask } from './render-preview.js';
import { generateThumbnailTask } from './generate-thumbnail.js';
import { processVideoTask } from './process-video.js';
import { transcribeAudioTask } from './transcribe-audio.js';

/** 任务名直接作为指标标签值，必须在注册时就是低基数短串。 */
const TASK_LABEL_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/;

/**
 * Q04：任务执行包装 — 记录 worker_task_total{task,status} 与
 * worker_task_retry_total{task}（attempts>1 即为重试执行）。
 * 任务名是编译期注册表闭集；标签值校验失败在引导期即抛错，不会污染任务结果。
 */
export function withTaskMetrics(
  metrics: MetricsPort,
): (taskName: string, handler: Task) => Task {
  return (taskName, handler) => {
    if (!TASK_LABEL_PATTERN.test(taskName)) {
      throw new Error(`worker 任务名不符合指标标签格式: ${taskName}`);
    }
    return async (payload, helpers) => {
      if (helpers.job.attempts > 1) {
        recordMetricSafely(() =>
          metrics.increment('worker_task_retry_total', { task: taskName }),
        );
      }
      try {
        await handler(payload, helpers);
        recordMetricSafely(() =>
          metrics.increment('worker_task_total', {
            task: taskName,
            status: 'success',
          }),
        );
      } catch (error) {
        recordMetricSafely(() =>
          metrics.increment('worker_task_total', {
            task: taskName,
            status: 'failed',
          }),
        );
        throw error;
      }
    };
  };
}

/**
 * worker 的任务注册表。周期任务使用Graphile crontab兼容的 `域:动作` 命名;
 * 任务只能通过本注册表暴露,与 Tool Registry 同样是编译期显式白名单,
 * 不做运行时动态注册。
 */
export function createTaskList(input: {
  continuationTrace: ContinuationTracePort;
  metrics: MetricsPort;
  terminalReconciliationMode?: GatewayTerminalReconciliationMode;
}): TaskList {
  const wrap = withTaskMetrics(input.metrics);
  return {
    [ARTIFACT_GENERATE_TASK]: wrap(ARTIFACT_GENERATE_TASK, generateArtifact),
    [ASSET_EXTRACT_TEXT_TASK]: wrap(
      ASSET_EXTRACT_TEXT_TASK,
      extractAssetTextTask,
    ),
    [ASSET_RENDER_PREVIEW_TASK]: wrap(
      ASSET_RENDER_PREVIEW_TASK,
      renderPreviewTask,
    ),
    [ASSET_GENERATE_THUMBNAIL_TASK]: wrap(
      ASSET_GENERATE_THUMBNAIL_TASK,
      generateThumbnailTask,
    ),
    [ASSET_TRANSCRIBE_AUDIO_TASK]: wrap(
      ASSET_TRANSCRIBE_AUDIO_TASK,
      transcribeAudioTask,
    ),
    [ASSET_PROCESS_VIDEO_TASK]: wrap(
      ASSET_PROCESS_VIDEO_TASK,
      processVideoTask,
    ),
    [OPERATION_CONTINUATION_TASK]: wrap(
      OPERATION_CONTINUATION_TASK,
      createProductionContinueOperationTask(
        input.continuationTrace,
        input.terminalReconciliationMode ?? 'enabled',
      ),
    ),
    [KNOWLEDGE_INGEST_DOCUMENT_TASK]: wrap(
      KNOWLEDGE_INGEST_DOCUMENT_TASK,
      ingestKnowledgeDocument,
    ),
    [KNOWLEDGE_EMBED_DOCUMENT_TASK]: wrap(
      KNOWLEDGE_EMBED_DOCUMENT_TASK,
      embedKnowledgeDocument,
    ),
    'maintenance:purge_anonymous_subjects': wrap(
      'maintenance:purge_anonymous_subjects',
      purgeAnonymousSubjects,
    ),
    'maintenance:delete_object_outbox': wrap(
      'maintenance:delete_object_outbox',
      deleteObjectOutbox,
    ),
    'maintenance:recover_operation_continuations': wrap(
      'maintenance:recover_operation_continuations',
      recoverOperationContinuations,
    ),
    'maintenance:reconcile_tool_approval_intents': wrap(
      'maintenance:reconcile_tool_approval_intents',
      reconcileToolApprovalIntents,
    ),
    'system.heartbeat': wrap('system.heartbeat', systemHeartbeat),
  };
}
