import { OPERATION_CONTINUATION_TASK } from '@educanvas/agent-core';
import { ARTIFACT_GENERATE_TASK } from '@educanvas/db';
import type { TaskList } from 'graphile-worker';
import { generateArtifact } from './generate-artifact.js';
import { ingestKnowledgeDocument } from './ingest-knowledge-document.js';
import { purgeAnonymousSubjects } from './purge-anonymous-subjects.js';
import { systemHeartbeat } from './system-heartbeat.js';
import { continueOperation } from './continue-operation.js';

/**
 * worker 的任务注册表。周期任务使用Graphile crontab兼容的 `域:动作` 命名;
 * 任务只能通过本注册表暴露,与 Tool Registry 同样是编译期显式白名单,
 * 不做运行时动态注册。
 */
export const taskList: TaskList = {
  [ARTIFACT_GENERATE_TASK]: generateArtifact,
  [OPERATION_CONTINUATION_TASK]: continueOperation,
  'knowledge:ingest_document': ingestKnowledgeDocument,
  'maintenance:purge_anonymous_subjects': purgeAnonymousSubjects,
  'system.heartbeat': systemHeartbeat,
};
