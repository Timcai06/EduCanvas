export type VoiceFailureCode =
  'backend_offline' | 'timeout' | 'aborted' | 'http' | 'invalid_response';

export interface VoiceFailure {
  ok: false;
  code: VoiceFailureCode;
  message: string;
}

export type VoiceTranscriptionResult =
  { ok: true; text: string } | VoiceFailure;

export type VoiceSpeechResult =
  { ok: true; bytes: Uint8Array; contentType: 'audio/mpeg' } | VoiceFailure;

export interface VoiceAudioInput {
  bytes: Uint8Array;
  mimeType: 'audio/webm';
}
