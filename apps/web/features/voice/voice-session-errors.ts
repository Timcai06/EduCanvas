import type {
  StreamingTranscriptionClientError,
  StreamingTranscriptionTerminalResult,
} from './transport';
import type { VoiceSessionErrorCode } from './voice-session-controller';

/** V17-A client.start 拒绝错误到会话稳定错误码。 */
export function mapClientStartError(
  code: StreamingTranscriptionClientError['code'],
): VoiceSessionErrorCode {
  switch (code) {
    case 'TICKET_FAILED':
      return 'TICKET_FAILED';
    case 'CONNECTION_FAILED':
      return 'CONNECTION_FAILED';
    case 'ABORTED':
      return 'ABORTED';
    default:
      return 'UNKNOWN';
  }
}

/** V17-A 终态结果到会话稳定错误码。 */
export function mapTerminalToError(
  result: StreamingTranscriptionTerminalResult,
): VoiceSessionErrorCode {
  switch (result.reason) {
    case 'failed':
      return result.failureCode === 'MODEL_FAILED' ? 'MODEL_FAILED' : 'UNKNOWN';
    case 'disconnected':
    case 'connection-failed':
      return 'CONNECTION_FAILED';
    case 'ticket-failed':
      return 'TICKET_FAILED';
    case 'protocol-error':
      return 'PROTOCOL_ERROR';
    case 'aborted':
      return 'ABORTED';
    case 'final':
    case 'cancelled':
      return 'UNKNOWN';
  }
}
