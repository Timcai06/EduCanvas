/** EduCanvas通用Agent运行时的公共入口。 @packageDocumentation */
export {
  UnsupportedAgentInputModalityError,
  buildAssetContext,
  type AgentInputCapabilities,
  type BuiltAssetContext,
  type MaterializedAssetInput,
} from './asset-context';
export {
  CONVERSATION_CONTEXT_VERSION,
  buildConversationContext,
  type ConversationContextMessage,
  type ConversationContextOptions,
  type ConversationContextSnapshot,
} from './conversation-context';
export { LocalObjectStorage } from './local-object-storage';
