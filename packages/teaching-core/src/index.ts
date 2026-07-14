/**
 * EduCanvas教学领域核心的唯一公共入口。
 * @packageDocumentation
 */

export {
  assessmentExitDecisionSchema,
  assessmentExitDecisions,
  beginInterruption,
  evaluateTransition,
  resumeInterruption,
  selectInitialState,
  teachingStateSchema,
  teachingStates,
  transitionRequestSchema,
  type AssessmentExitDecision,
  type InterruptionResult,
  type TeachingSessionCursor,
  type TeachingState,
  type TransitionEvaluation,
  type TransitionRejectionCode,
  type TransitionRequest,
} from './state-machine';
export {
  assessmentEvidenceSchema,
  calculateMastery,
  decideAssessmentExit,
  defaultMasteryConfig,
  getReviewIntervalDays,
  masteryConfigSchema,
  masteryInputSchema,
  misconceptionTagSchema,
  misconceptionTags,
  type AssessmentEvidence,
  type AssessmentExit,
  type AssessmentReason,
  type MasteryCalculation,
  type MasteryConfig,
  type MasteryInput,
  type MisconceptionTag,
} from './mastery';
export {
  DOMAIN_EVENT_SCHEMA_VERSION,
  domainEventSources,
  domainLearningEventSchema,
  domainLearningEventTypes,
  type DomainLearningEvent,
  type DomainLearningEventType,
} from './domain-events';
export {
  defaultToolPolicy,
  isToolAllowed,
  teachingTools,
  type TeachingTool,
} from './tools';
export type {
  EventStore,
  KnowledgeEvidence,
  KnowledgeRetrievalRequest,
  KnowledgeRetriever,
  LessonSessionSnapshot,
  MasteryRepository,
  MasterySnapshot,
  ModelGateway,
  ModelMessage,
  SaveMasteryInput,
  SessionRepository,
  StructuredModelRequest,
  StructuredModelResult,
  TeachingTransaction,
  TeachingUnitOfWork,
  UpdateSessionStateInput,
} from './ports';
