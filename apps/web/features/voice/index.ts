/**
 * 语音能力（V17-B）公共入口（UI 无关，SSR 安全）。
 *
 * 只导出控制层纯逻辑与依赖注入面：浏览器 API 一律由完整 V17 在用户点击后
 * 经 capture/client 工厂注入调用；本模块顶层不读取 window/WebSocket。
 */

export {
  evaluateTranscriptionCapability,
  evaluateVoiceCapability,
  voiceCapabilityReasonLabel,
  type VoiceCapabilityCheck,
  type VoiceCapabilityKey,
  type VoiceCapabilityReason,
  type VoiceCapabilityState,
} from './voice-capability';

export {
  VoiceSessionController,
  type VoiceSessionCaptureHandlers,
  type VoiceSessionClientHandlers,
  type VoiceSessionControllerDeps,
  type VoiceSessionErrorCode,
  type VoiceSessionLogEntry,
  type VoiceSessionStatus,
  type VoiceSessionTranscriptionClient,
} from './voice-session-controller';

export { VoiceSessionLifecycle } from './voice-session-lifecycle';

export {
  useVoiceSession,
  type UseVoiceSessionOptions,
  type UseVoiceSessionState,
} from './use-voice-session';

export {
  VoiceComposer,
  VoiceComposerRuntime,
  type VoiceComposerRuntimeProps,
} from './voice-composer';
