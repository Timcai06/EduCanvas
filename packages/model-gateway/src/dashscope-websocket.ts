import WebSocket from 'ws';
import type { DashScopeSpeechConfiguration } from './dashscope-speech-config';

export interface DashScopeSocket {
  readonly readyState: number;
  on(
    event: 'open' | 'close' | 'error' | 'message',
    listener: (...args: any[]) => void,
  ): this;
  send(data: string | Uint8Array): void;
  close(): void;
}

export type DashScopeSocketFactory = (
  configuration: DashScopeSpeechConfiguration,
) => DashScopeSocket;

export const createDashScopeSocket: DashScopeSocketFactory = (configuration) =>
  new WebSocket(configuration.websocketUrl, {
    handshakeTimeout: 5_000,
    maxPayload: 1_048_576,
    perMessageDeflate: false,
    headers: {
      authorization: `Bearer ${configuration.apiKey}`,
      'X-DashScope-WorkSpace': configuration.workspaceId,
      'user-agent': 'EduCanvas/voice',
    },
  });
