/**
 * 数据访问包的公共入口；业务层应通过此处导入，避免绕过统一连接生命周期或绑定内部文件结构。
 * @packageDocumentation
 */

export { getDb } from './client';
export * from './schema';
export {
  AssetAccessError,
  AssetPersistenceError,
  DrizzleAssetRepository,
  type AssetSnapshot,
  type CreateUploadedAssetInput,
  type MaterializedAssetVersion,
} from './asset-repository';
export { MessagePartValidationError } from './message-parts';
export {
  DrizzlePlatformConversationRepository,
  PlatformConversationOwnershipError,
  type PlatformConversationSnapshot,
  type PlatformMessageSnapshot,
} from './conversation-platform-repository';
export {
  DrizzlePlatformTurnRepository,
  PlatformMessageIdConflictError,
  PlatformTurnInProgressError,
  PlatformTurnLifecycleError,
  PlatformTurnOwnershipError,
  type PlatformTurnMessageSnapshot,
  type PlatformTurnSnapshot,
  type PlatformSettledCitationSnapshot,
  type PlatformTurnSettlementSnapshot,
  type PlatformTurnTerminalStatus,
} from './platform-turn-repository';
export {
  DrizzlePlatformSourceRepository,
  PlatformSourceOwnershipError,
  type PlatformMessageCitationSnapshot,
  type PlatformOperationSourceSnapshot,
} from './platform-source-repository';
export {
  DrizzleGatewayIdentityRepository,
  DrizzleGatewayDirectoryRepository,
  DrizzleGatewayChannelBindingRepository,
  DrizzleGatewayDeliveryRepository,
  DrizzleGatewayNodeRepository,
  DrizzleGatewayApprovalRepository,
  DrizzleGatewayOperationStore,
  DrizzleGatewayRouteResolver,
  GatewayPersistenceError,
  ensurePersonalIdentity,
  type GatewayIdentitySnapshot,
  type GatewayConversationDirectoryEntry,
  type GatewayChannelPrivateRoute,
  type GatewayPendingApprovalSnapshot,
  type GatewayStoredOperationSnapshot,
} from './gateway-repository';
export {
  DrizzleGatewayHandoffRepository,
  type GatewayHandoffConsumeResult,
  type GatewayHandoffRejectionReason,
} from './gateway-handoff-repository';
export { DrizzleGatewayConnectionRepository } from './gateway-connection-repository';
export {
  ARTIFACT_GENERATE_TASK,
  ArtifactJobLifecycleError,
  ArtifactOwnershipError,
  ArtifactRevisionConflictError,
  ArtifactVersionConflictError,
  DrizzlePlatformArtifactRepository,
  type ArtifactJobStatus,
  type ArtifactStatus,
  type ArtifactTrustTier,
  type PlatformArtifact,
  type PlatformArtifactJob,
  type PlatformArtifactVersion,
} from './platform-artifact-repository';
export {
  ArtifactContentConflictError,
  DrizzleArtifactRepository,
} from './artifact-repository';
export {
  DrizzleEventStore,
  DrizzleMasteryRepository,
  DrizzleSessionRepository,
  DrizzleTeachingUnitOfWork,
  IdempotencyConflictError,
  OptimisticLockError,
} from './teaching-adapters';
export {
  ANONYMOUS_LEARNING_SESSION_TTL_MS,
  DrizzleLearningSessionRepository,
  LearningSessionNotFoundError,
  type BootstrappedLearningSession,
  type BootstrapLearningSessionInput,
  type LearningPageSnapshot,
  type LearningSessionCourseScope,
  type LearningSessionListCursor,
  type LearningSessionListPage,
  type LearningSessionScope,
  type LearningSessionSummary,
  type OwnedLearningSession,
  type OwnedLearningGatewayTarget,
} from './learning-session-repository';
export {
  ChatLifecycleError,
  ChatMessageIdConflictError,
  DEFAULT_ASSISTANT_LEASE_MS,
  DrizzleChatRepository,
  LearningSessionOwnershipError,
  MAX_ASSISTANT_LEASE_MS,
  MIN_ASSISTANT_LEASE_MS,
  TurnInProgressError,
  normalizeStudentMessageContent,
  teachingTurnSessionLockKey,
  validateAssistantLeaseDuration,
  type AssistantTerminalStatus,
  type ChatHistoryCursor,
  type ChatHistoryPage,
  type ChatMessageRole,
  type ChatMessageSnapshot,
  type ChatMessageStatus,
  type TeachingTurnSnapshot,
} from './chat-repository';
export {
  AgentModelRunConflictError,
  AgentModelRunLifecycleError,
  AgentModelRunOwnershipError,
  DrizzleAgentModelRunRepository,
} from './agent-model-run-repository';
export {
  DrizzleModelRunRepository,
  ModelRunConflictError,
  ModelRunLifecycleError,
  type CreateTeachingModelRunInput,
  type ModelRunProviderResult,
  type ModelRunSnapshot,
  type ModelRunStatus,
  type ModelRunTerminalStatus,
  type ModelRunUsage,
  type TeachingModelRunPhase,
} from './model-run-repository';
export {
  DEFAULT_TURN_RATE_LIMIT,
  DrizzleTeachingTurnLedger,
  TurnLedgerInvariantError,
  TurnRateLimitError,
  type BeginTeachingApplicationTurnInput,
  type BeginTeachingTurnInput,
  type TeachingApplicationTurnLedgerSnapshot,
  type TeachingTurnLedgerSnapshot,
} from './turn-ledger-repository';
export {
  DrizzleTurnLeaseRepository,
  type ExpiredTurnConvergence,
} from './turn-lease-repository';
export {
  TurnContextConflictError,
  prepareTurnContextMaterial,
  type PreparedTurnContextMaterial,
  type TurnContextMaterial,
} from './turn-context';
export {
  AgentTurnContextLifecycleError,
  AgentTurnContextOwnershipError,
  DrizzleAgentTurnContextRepository,
} from './agent-turn-context-repository';
export {
  DrizzleToolCallRepository,
  MAX_TOOL_AUDIT_VALUE_BYTES,
  ToolCallConflictError,
  ToolCallLifecycleError,
  summarizeRedactedValue,
  type CreateToolCallInput,
  type RedactedValueSummary,
  type ToolCallSnapshot,
  type ToolCallStatus,
  type ToolCallTerminalStatus,
  type ToolEffect,
  type ToolExposure,
} from './tool-call-repository';
export {
  AgentToolCallConflictError,
  AgentToolCallLifecycleError,
  AgentToolCallOwnershipError,
  DrizzleAgentToolCallRepository,
} from './agent-tool-call-repository';
export {
  DrizzleToolEffectRepository,
  ToolEffectConflictError,
  ToolEffectLifecycleError,
  ToolEffectOwnershipError,
} from './tool-effect-repository';
export {
  DrizzleOperationContinuationRepository,
  OperationContinuationConflictError,
  OperationContinuationLifecycleError,
  OperationContinuationOwnershipError,
} from './operation-continuation-repository';
export {
  DrizzleTurnSafetyDecisionRepository,
  SafetyDecisionConflictError,
  SafetyDecisionOwnershipError,
  TURN_SAFETY_ACTIONS,
  TURN_SAFETY_CATEGORIES,
  TURN_SAFETY_PHASES,
  type RecordTurnSafetyDecisionInput,
  type RecordedTurnSafetyDecision,
  type TurnSafetyAction,
  type TurnSafetyCategory,
  type TurnSafetyDecisionSnapshot,
  type TurnSafetyPhase,
} from './turn-safety-decision-repository';
export {
  ANONYMOUS_DATA_LIFECYCLE_REGISTRY,
  ANONYMOUS_SUBJECT_RETENTION_MS,
  DrizzleAnonymousDataLifecycleService,
  anonymousSubjectLockKey,
  assertAnonymousDataLifecycleRegistryCoverage,
  isAnonymousSyntheticSubjectId,
  type AnonymousDataLifecycleRegistryEntry,
  type AnonymousDataLifecycleTableName,
  type AnonymousDataOwnershipPath,
  type AnonymousLifecycleTestHooks,
  type PurgeExpiredAnonymousSubjectsInput,
  type PurgeExpiredAnonymousSubjectsResult,
} from './anonymous-data-lifecycle';
export {
  DrizzleKnowledgeSourceRepository,
  KnowledgeDocumentConflictError,
  KnowledgeSourceConflictError,
  KnowledgeSourceNotAvailableError,
  hashKnowledgeText,
  knowledgeSourceLockKey,
  type IngestKnowledgeChunkInput,
  type IngestKnowledgeDocumentInput,
  type IngestedKnowledgeDocument,
  type KnowledgeDocumentSnapshot,
  type KnowledgeDocumentStatus,
  type KnowledgeSourceSnapshot,
  type KnowledgeSourceType,
} from './knowledge-source-repository';
export {
  CitationCandidateInvalidError,
  CitationConflictError,
  DrizzleKnowledgeRetrievalRepository,
  KnowledgeAccessError,
  KnowledgeSourceScopeError,
  SourceBindingConflictError,
  type MessageCitationSnapshot,
  type RetrievalCandidateEvidence,
  type SessionSourceBindingSnapshot,
  type TurnSourceVersionSnapshot,
} from './knowledge-retrieval-repository';
