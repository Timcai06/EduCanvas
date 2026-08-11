import type {
  StreamingSpeechGateway,
  StreamingTranscriptionGateway,
} from '@educanvas/agent-core';
import { parseDashScopeSpeechConfiguration } from './dashscope-speech-config';
import { DashScopeStreamingSpeechGateway } from './dashscope-streaming-speech-gateway';
import { DashScopeStreamingTranscriptionGateway } from './dashscope-streaming-transcription-gateway';

export type DashScopeUnavailableReason =
  'not_configured' | 'invalid_configuration';

export function resolveDashScopeSpeechAvailability(
  env: Readonly<Record<string, string | undefined>>,
):
  | { enabled: true; reason: null }
  | { enabled: false; reason: DashScopeUnavailableReason } {
  const resolution = parseDashScopeSpeechConfiguration(env);
  return resolution.enabled
    ? { enabled: true, reason: null }
    : { enabled: false, reason: resolution.reason };
}

export function resolveDashScopeStreamingTranscriptionGateway(
  env: Readonly<Record<string, string | undefined>>,
):
  | { gateway: StreamingTranscriptionGateway; reason: null }
  | { gateway: null; reason: DashScopeUnavailableReason } {
  const resolution = parseDashScopeSpeechConfiguration(env);
  return resolution.enabled
    ? {
        gateway: new DashScopeStreamingTranscriptionGateway({
          configuration: resolution.configuration,
        }),
        reason: null,
      }
    : { gateway: null, reason: resolution.reason };
}

export function resolveDashScopeStreamingSpeechGateway(
  env: Readonly<Record<string, string | undefined>>,
): StreamingSpeechGateway | null {
  const resolution = parseDashScopeSpeechConfiguration(env);
  return resolution.enabled
    ? new DashScopeStreamingSpeechGateway({
        configuration: resolution.configuration,
      })
    : null;
}
