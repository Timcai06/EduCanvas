import { eq, inArray, or } from 'drizzle-orm';
import { getDb } from './client';
import {
  agentMessageParts,
  agentOperations,
  artifactGenerationJobs,
  artifacts,
  artifactVersions,
  assets,
  assetVersions,
  canvasArtifactGradingKeys,
  canvasArtifacts,
  chatMessages,
  conversationMessageCitations,
  conversationMessages,
  conversations,
  k12ConversationMessageProjections,
  learningEvents,
  lessonSessions,
  masteryStates,
  messageCitations,
  modelRuns,
  notebookSurfacePositions,
  operationSources,
  resourceAnnotations,
  retrievalCandidates,
  sessionSourceBindings,
  spaces,
  toolCalls,
  turnSafetyDecisions,
  turnSourceSnapshots,
  turnSourceVersions,
} from './schema';
import { anonymousStudyLifecycleDefinitions } from './anonymous-study-data-lifecycle';

type Database = ReturnType<typeof getDb>;
type DatabaseTransaction = Parameters<
  Parameters<Database['transaction']>[0]
>[0];

export type AnonymousDataOwnershipPath =
  | 'session_id'
  | 'student_id'
  | 'attempt_id -> diagnostic_attempts.student_id'
  | 'goal_id -> learning_goals.student_id'
  | 'message_id -> chat_messages.session_id'
  | 'artifact_record_id -> canvas_artifacts.session_id'
  | 'message_id -> conversation_messages.conversation_id'
  | 'session_id | conversation_id'
  | 'operation_id -> agent_operations.conversation_id'
  | 'artifact_id -> artifacts.owner_subject_id'
  | 'conversation_id -> conversations.owner_subject_id'
  | 'asset_id -> assets.owner_subject_id'
  | 'owner_subject_id';

export interface AnonymousLifecycleDeletionContext {
  transaction: DatabaseTransaction;
  subjectId: string;
  sessionIds: readonly string[];
  artifactRecordIds: readonly string[];
  conversationIds: readonly string[];
  operationIds: readonly string[];
  conversationMessageIds: readonly string[];
  platformArtifactIds: readonly string[];
}

interface AnonymousLifecycleDefinition {
  tableName: string;
  ownershipPath: AnonymousDataOwnershipPath;
  deleteRows(context: AnonymousLifecycleDeletionContext): Promise<number>;
}

async function deleteConversationMessageCitations(
  context: AnonymousLifecycleDeletionContext,
) {
  if (context.conversationMessageIds.length === 0) return 0;
  return (
    await context.transaction
      .delete(conversationMessageCitations)
      .where(
        inArray(conversationMessageCitations.assistantMessageId, [
          ...context.conversationMessageIds,
        ]),
      )
      .returning({ id: conversationMessageCitations.id })
  ).length;
}

async function deleteOperationSources(
  context: AnonymousLifecycleDeletionContext,
) {
  if (context.operationIds.length === 0) return 0;
  return (
    await context.transaction
      .delete(operationSources)
      .where(inArray(operationSources.operationId, [...context.operationIds]))
      .returning({ id: operationSources.id })
  ).length;
}

async function deleteArtifactGenerationJobs(
  context: AnonymousLifecycleDeletionContext,
) {
  if (context.platformArtifactIds.length === 0) return 0;
  return (
    await context.transaction
      .delete(artifactGenerationJobs)
      .where(
        inArray(artifactGenerationJobs.artifactId, [
          ...context.platformArtifactIds,
        ]),
      )
      .returning({ id: artifactGenerationJobs.id })
  ).length;
}

async function deleteArtifactVersions(
  context: AnonymousLifecycleDeletionContext,
) {
  if (context.platformArtifactIds.length === 0) return 0;
  return (
    await context.transaction
      .delete(artifactVersions)
      .where(
        inArray(artifactVersions.artifactId, [...context.platformArtifactIds]),
      )
      .returning({ id: artifactVersions.id })
  ).length;
}

async function deletePlatformArtifacts(
  context: AnonymousLifecycleDeletionContext,
) {
  return (
    await context.transaction
      .delete(artifacts)
      .where(eq(artifacts.ownerSubjectId, context.subjectId))
      .returning({ id: artifacts.id })
  ).length;
}

async function deleteConversationMessages(
  context: AnonymousLifecycleDeletionContext,
) {
  if (context.conversationIds.length === 0) return 0;
  return (
    await context.transaction
      .delete(conversationMessages)
      .where(
        inArray(conversationMessages.conversationId, [
          ...context.conversationIds,
        ]),
      )
      .returning({ id: conversationMessages.id })
  ).length;
}

async function deleteK12ConversationMessageProjections(
  context: AnonymousLifecycleDeletionContext,
) {
  if (context.sessionIds.length === 0 && context.conversationIds.length === 0)
    return 0;
  return (
    await context.transaction
      .delete(k12ConversationMessageProjections)
      .where(
        or(
          context.sessionIds.length > 0
            ? inArray(k12ConversationMessageProjections.sessionId, [
                ...context.sessionIds,
              ])
            : undefined,
          context.conversationIds.length > 0
            ? inArray(k12ConversationMessageProjections.conversationId, [
                ...context.conversationIds,
              ])
            : undefined,
        ),
      )
      .returning({
        sourceChatMessageId:
          k12ConversationMessageProjections.sourceChatMessageId,
      })
  ).length;
}

async function deleteAgentOperations(
  context: AnonymousLifecycleDeletionContext,
) {
  if (context.conversationIds.length === 0) return 0;
  return (
    await context.transaction
      .delete(agentOperations)
      .where(
        inArray(agentOperations.conversationId, [...context.conversationIds]),
      )
      .returning({ id: agentOperations.id })
  ).length;
}

async function deleteConversations(context: AnonymousLifecycleDeletionContext) {
  return (
    await context.transaction
      .delete(conversations)
      .where(eq(conversations.ownerSubjectId, context.subjectId))
      .returning({ id: conversations.id })
  ).length;
}

async function deleteSpaces(context: AnonymousLifecycleDeletionContext) {
  return (
    await context.transaction
      .delete(spaces)
      .where(eq(spaces.ownerSubjectId, context.subjectId))
      .returning({ id: spaces.id })
  ).length;
}

async function deleteResourceAnnotations(
  context: AnonymousLifecycleDeletionContext,
) {
  return (
    await context.transaction
      .delete(resourceAnnotations)
      .where(eq(resourceAnnotations.ownerSubjectId, context.subjectId))
      .returning({ id: resourceAnnotations.id })
  ).length;
}

async function deleteNotebookSurfacePositions(
  context: AnonymousLifecycleDeletionContext,
) {
  return (
    await context.transaction
      .delete(notebookSurfacePositions)
      .where(eq(notebookSurfacePositions.ownerSubjectId, context.subjectId))
      .returning({ id: notebookSurfacePositions.resourceId })
  ).length;
}

async function deleteToolCalls(context: AnonymousLifecycleDeletionContext) {
  return (
    await context.transaction
      .delete(toolCalls)
      .where(inArray(toolCalls.sessionId, [...context.sessionIds]))
      .returning({ id: toolCalls.id })
  ).length;
}

async function deleteMessageCitations(
  context: AnonymousLifecycleDeletionContext,
) {
  return (
    await context.transaction
      .delete(messageCitations)
      .where(inArray(messageCitations.sessionId, [...context.sessionIds]))
      .returning({ id: messageCitations.id })
  ).length;
}

async function deleteModelRuns(context: AnonymousLifecycleDeletionContext) {
  return (
    await context.transaction
      .delete(modelRuns)
      .where(inArray(modelRuns.sessionId, [...context.sessionIds]))
      .returning({ id: modelRuns.id })
  ).length;
}

async function deleteSafetyDecisions(
  context: AnonymousLifecycleDeletionContext,
) {
  return (
    await context.transaction
      .delete(turnSafetyDecisions)
      .where(inArray(turnSafetyDecisions.sessionId, [...context.sessionIds]))
      .returning({ turnId: turnSafetyDecisions.turnId })
  ).length;
}

async function deleteGradingKeys(context: AnonymousLifecycleDeletionContext) {
  if (context.artifactRecordIds.length === 0) return 0;
  return (
    await context.transaction
      .delete(canvasArtifactGradingKeys)
      .where(
        inArray(canvasArtifactGradingKeys.artifactRecordId, [
          ...context.artifactRecordIds,
        ]),
      )
      .returning({ id: canvasArtifactGradingKeys.artifactRecordId })
  ).length;
}

async function deleteArtifacts(context: AnonymousLifecycleDeletionContext) {
  return (
    await context.transaction
      .delete(canvasArtifacts)
      .where(inArray(canvasArtifacts.sessionId, [...context.sessionIds]))
      .returning({ id: canvasArtifacts.id })
  ).length;
}

async function deleteRetrievalCandidates(
  context: AnonymousLifecycleDeletionContext,
) {
  return (
    await context.transaction
      .delete(retrievalCandidates)
      .where(inArray(retrievalCandidates.sessionId, [...context.sessionIds]))
      .returning({ id: retrievalCandidates.id })
  ).length;
}

async function deleteTurnSourceVersions(
  context: AnonymousLifecycleDeletionContext,
) {
  return (
    await context.transaction
      .delete(turnSourceVersions)
      .where(inArray(turnSourceVersions.sessionId, [...context.sessionIds]))
      .returning({ id: turnSourceVersions.id })
  ).length;
}

async function deleteTurnSourceSnapshots(
  context: AnonymousLifecycleDeletionContext,
) {
  return (
    await context.transaction
      .delete(turnSourceSnapshots)
      .where(inArray(turnSourceSnapshots.sessionId, [...context.sessionIds]))
      .returning({ id: turnSourceSnapshots.id })
  ).length;
}

async function deleteSessionSourceBindings(
  context: AnonymousLifecycleDeletionContext,
) {
  return (
    await context.transaction
      .delete(sessionSourceBindings)
      .where(inArray(sessionSourceBindings.sessionId, [...context.sessionIds]))
      .returning({ id: sessionSourceBindings.id })
  ).length;
}

async function deleteChatMessages(context: AnonymousLifecycleDeletionContext) {
  return (
    await context.transaction
      .delete(chatMessages)
      .where(inArray(chatMessages.sessionId, [...context.sessionIds]))
      .returning({ id: chatMessages.id })
  ).length;
}

async function deleteAgentMessageParts(
  context: AnonymousLifecycleDeletionContext,
) {
  const messages = await context.transaction
    .select({ id: chatMessages.id })
    .from(chatMessages)
    .where(inArray(chatMessages.sessionId, [...context.sessionIds]));
  if (messages.length === 0) return 0;
  return (
    await context.transaction
      .delete(agentMessageParts)
      .where(
        inArray(
          agentMessageParts.messageId,
          messages.map((message) => message.id),
        ),
      )
      .returning({ messageId: agentMessageParts.messageId })
  ).length;
}

async function deleteAssetVersions(context: AnonymousLifecycleDeletionContext) {
  const ownedAssets = await context.transaction
    .select({ id: assets.id })
    .from(assets)
    .where(eq(assets.ownerSubjectId, context.subjectId));
  if (ownedAssets.length === 0) return 0;
  // ready资产通过current_version_id形成受约束的回指。先解除回指，再显式删除不可变版本。
  await context.transaction
    .update(assets)
    .set({
      status: 'tombstoned',
      currentVersionId: null,
      tombstonedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(assets.ownerSubjectId, context.subjectId));
  return (
    await context.transaction
      .delete(assetVersions)
      .where(
        inArray(
          assetVersions.assetId,
          ownedAssets.map((asset) => asset.id),
        ),
      )
      .returning({ id: assetVersions.id })
  ).length;
}

async function deleteAssets(context: AnonymousLifecycleDeletionContext) {
  return (
    await context.transaction
      .delete(assets)
      .where(eq(assets.ownerSubjectId, context.subjectId))
      .returning({ id: assets.id })
  ).length;
}

async function deleteLearningEvents(
  context: AnonymousLifecycleDeletionContext,
) {
  return (
    await context.transaction
      .delete(learningEvents)
      .where(inArray(learningEvents.sessionId, [...context.sessionIds]))
      .returning({ id: learningEvents.id })
  ).length;
}

async function deleteLessonSessions(
  context: AnonymousLifecycleDeletionContext,
) {
  return (
    await context.transaction
      .delete(lessonSessions)
      .where(inArray(lessonSessions.id, [...context.sessionIds]))
      .returning({ id: lessonSessions.id })
  ).length;
}

async function deleteMasteryStates(context: AnonymousLifecycleDeletionContext) {
  return (
    await context.transaction
      .delete(masteryStates)
      .where(eq(masteryStates.studentId, context.subjectId))
      .returning({ studentId: masteryStates.studentId })
  ).length;
}

/** 中央删除闭包；数组顺序就是事务中的真实执行顺序。 */
export const anonymousLifecycleDefinitions = [
  {
    tableName: 'conversation_message_citations',
    ownershipPath: 'message_id -> conversation_messages.conversation_id',
    deleteRows: deleteConversationMessageCitations,
  },
  {
    tableName: 'operation_sources',
    ownershipPath: 'operation_id -> agent_operations.conversation_id',
    deleteRows: deleteOperationSources,
  },
  {
    tableName: 'artifact_versions',
    ownershipPath: 'artifact_id -> artifacts.owner_subject_id',
    deleteRows: deleteArtifactVersions,
  },
  {
    tableName: 'artifact_generation_jobs',
    ownershipPath: 'artifact_id -> artifacts.owner_subject_id',
    deleteRows: deleteArtifactGenerationJobs,
  },
  {
    tableName: 'artifacts',
    ownershipPath: 'owner_subject_id',
    deleteRows: deletePlatformArtifacts,
  },
  {
    tableName: 'k12_conversation_message_projections',
    ownershipPath: 'session_id | conversation_id',
    deleteRows: deleteK12ConversationMessageProjections,
  },
  {
    tableName: 'conversation_messages',
    ownershipPath: 'conversation_id -> conversations.owner_subject_id',
    deleteRows: deleteConversationMessages,
  },
  {
    tableName: 'agent_operations',
    ownershipPath: 'conversation_id -> conversations.owner_subject_id',
    deleteRows: deleteAgentOperations,
  },
  ...anonymousStudyLifecycleDefinitions,
  {
    tableName: 'message_citations',
    ownershipPath: 'session_id',
    deleteRows: deleteMessageCitations,
  },
  {
    tableName: 'tool_calls',
    ownershipPath: 'session_id',
    deleteRows: deleteToolCalls,
  },
  {
    tableName: 'model_runs',
    ownershipPath: 'session_id',
    deleteRows: deleteModelRuns,
  },
  {
    tableName: 'turn_safety_decisions',
    ownershipPath: 'session_id',
    deleteRows: deleteSafetyDecisions,
  },
  {
    tableName: 'canvas_artifact_grading_keys',
    ownershipPath: 'artifact_record_id -> canvas_artifacts.session_id',
    deleteRows: deleteGradingKeys,
  },
  {
    tableName: 'canvas_artifacts',
    ownershipPath: 'session_id',
    deleteRows: deleteArtifacts,
  },
  {
    tableName: 'retrieval_candidates',
    ownershipPath: 'session_id',
    deleteRows: deleteRetrievalCandidates,
  },
  {
    tableName: 'turn_source_versions',
    ownershipPath: 'session_id',
    deleteRows: deleteTurnSourceVersions,
  },
  {
    tableName: 'turn_source_snapshots',
    ownershipPath: 'session_id',
    deleteRows: deleteTurnSourceSnapshots,
  },
  {
    tableName: 'session_source_bindings',
    ownershipPath: 'session_id',
    deleteRows: deleteSessionSourceBindings,
  },
  {
    tableName: 'agent_message_parts',
    ownershipPath: 'message_id -> chat_messages.session_id',
    deleteRows: deleteAgentMessageParts,
  },
  {
    tableName: 'chat_messages',
    ownershipPath: 'session_id',
    deleteRows: deleteChatMessages,
  },
  {
    tableName: 'learning_events',
    ownershipPath: 'session_id',
    deleteRows: deleteLearningEvents,
  },
  {
    tableName: 'asset_versions',
    ownershipPath: 'asset_id -> assets.owner_subject_id',
    deleteRows: deleteAssetVersions,
  },
  {
    tableName: 'assets',
    ownershipPath: 'owner_subject_id',
    deleteRows: deleteAssets,
  },
  {
    tableName: 'lesson_sessions',
    ownershipPath: 'student_id',
    deleteRows: deleteLessonSessions,
  },
  {
    tableName: 'mastery_states',
    ownershipPath: 'student_id',
    deleteRows: deleteMasteryStates,
  },
  {
    tableName: 'conversations',
    ownershipPath: 'owner_subject_id',
    deleteRows: deleteConversations,
  },
  {
    tableName: 'resource_annotations',
    ownershipPath: 'owner_subject_id',
    deleteRows: deleteResourceAnnotations,
  },
  {
    tableName: 'notebook_surface_positions',
    ownershipPath: 'owner_subject_id',
    deleteRows: deleteNotebookSurfacePositions,
  },
  {
    tableName: 'spaces',
    ownershipPath: 'owner_subject_id',
    deleteRows: deleteSpaces,
  },
] as const satisfies readonly AnonymousLifecycleDefinition[];
