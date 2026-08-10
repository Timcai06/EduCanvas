import {
  createAudioCapture,
  type AudioContextLike,
  type AudioCapture,
} from './capture/audio-capture';
import {
  StreamingTranscriptionClient,
  createStreamingTranscriptionTicketClient,
} from './transport';
import type {
  VoiceSessionCaptureHandlers,
  VoiceSessionClientHandlers,
  VoiceSessionTranscriptionClient,
} from './voice-session-controller';

export interface VoiceBrowserRuntime {
  readonly createCapture: (
    handlers: VoiceSessionCaptureHandlers,
  ) => AudioCapture;
  readonly createClient: (
    handlers: VoiceSessionClientHandlers,
  ) => VoiceSessionTranscriptionClient;
}

/**
 * 只创建惰性工厂；浏览器全局直到用户点击、Controller 调用工厂时才读取，
 * 因此 Client Component 的 SSR 预渲染不会请求麦克风或创建 WebSocket。
 */
export function createVoiceBrowserRuntime(
  websocketUrl: string | null,
): VoiceBrowserRuntime {
  return {
    createCapture(handlers) {
      const browser = globalThis as typeof globalThis & {
        navigator: Navigator;
        AudioContext?: new () => AudioContext;
        webkitAudioContext?: new () => AudioContext;
      };
      const AudioContextCtor =
        browser.AudioContext ?? browser.webkitAudioContext;
      if (!browser.navigator?.mediaDevices || !AudioContextCtor) {
        throw new Error('VOICE_BROWSER_UNAVAILABLE');
      }
      return createAudioCapture({
        mediaDevices: browser.navigator.mediaDevices,
        audioContextFactory: () =>
          new AudioContextCtor() as unknown as AudioContextLike,
        onChunk: handlers.onChunk,
        onFailure: handlers.onFailure,
      });
    },
    createClient(handlers) {
      if (websocketUrl === null || typeof globalThis.WebSocket !== 'function') {
        throw new Error('VOICE_CONNECTION_UNAVAILABLE');
      }
      const parsed = new URL(websocketUrl);
      const allowedInsecureWsHosts =
        parsed.protocol === 'ws:' ? [parsed.host] : [];
      return new StreamingTranscriptionClient({
        ticketClient: createStreamingTranscriptionTicketClient({
          endpoint: '/api/v1/voice/tickets',
        }),
        WebSocketCtor: globalThis.WebSocket,
        resolveWsUrl: ({ notebookId }) => {
          const url = new URL(websocketUrl);
          url.searchParams.set('notebookId', notebookId);
          return url.toString();
        },
        allowedInsecureWsHosts,
        onSnapshot: handlers.onSnapshot,
        onStatus: handlers.onStatus,
        onTerminal: handlers.onTerminal,
      });
    },
  };
}
