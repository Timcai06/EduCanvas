/**
 * V17-A 流式转录 transport 公共入口（UI 无关，SSR 安全）。
 *
 * 只导出纯逻辑与依赖注入面：模块顶层不读取 window/WebSocket/location，
 * 浏览器 API 一律由调用方构造时注入（V17 接线真实 fetch/WebSocket）。
 */

export {
  StreamingTranscriptionClient,
  StreamingTranscriptionClientError,
  encodePcmToBase64,
  validateStreamingWsUrl,
  type StreamingTranscriptionClientErrorCode,
  type StreamingTranscriptionClientLogEntry,
  type StreamingTranscriptionClientOptions,
  type StreamingTranscriptionClientPhase,
  type StreamingTranscriptionClientStatus,
  type StreamingTranscriptionTerminalReason,
  type StreamingTranscriptionTerminalResult,
  type StreamingWsUrlValidationReason,
  type StreamingWsUrlValidationResult,
} from './streaming-transcription-client';

export {
  STREAMING_TRANSCRIPTION_TICKET_ENDPOINT,
  StreamingTranscriptionTicketError,
  createStreamingTranscriptionTicketClient,
  isValidTicketEndpoint,
  type StreamingTranscriptionTicketClient,
  type StreamingTranscriptionTicketClientOptions,
  type StreamingTranscriptionTicketErrorCode,
  type StreamingTranscriptionTicketGrant,
} from './streaming-transcription-ticket-client';
