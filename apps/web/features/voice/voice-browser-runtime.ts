import {
  createAudioCapture,
  type AudioContextLike,
  type AudioCapture,
  type MediaDevicesLike,
  type MediaStreamLike,
} from './capture/audio-capture';
import {
  StreamingSpeechClient,
  StreamingTranscriptionClient,
  createStreamingTranscriptionTicketClient,
} from './transport';
import type {
  LiveSpeechSessionClient,
  StreamingSpeechClientHandlers,
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
  /** Live 多轮之间复用已授权的 MediaStream，避免每句重新请求麦克风。 */
  readonly createLiveCapture?: (
    handlers: VoiceSessionCaptureHandlers,
  ) => AudioCapture;
  readonly disposeLiveCapturePool?: () => void;
  readonly createClient: (
    handlers: VoiceSessionClientHandlers,
  ) => VoiceSessionTranscriptionClient;
  readonly createSpeechClient?: (
    handlers: StreamingSpeechClientHandlers,
  ) => LiveSpeechSessionClient;
}

/**
 * 只创建惰性工厂；浏览器全局直到用户点击、Controller 调用工厂时才读取，
 * 因此 Client Component 的 SSR 预渲染不会请求麦克风或创建 WebSocket。
 */
export function createVoiceBrowserRuntime(
  websocketUrl: string | null,
): VoiceBrowserRuntime {
  const browser = globalThis as typeof globalThis & {
    navigator: Navigator;
    AudioContext?: new () => AudioContext;
    webkitAudioContext?: new () => AudioContext;
  };
  const AudioContextCtor = browser.AudioContext ?? browser.webkitAudioContext;
  const warmMedia = browser.navigator?.mediaDevices
    ? createWarmMediaDevices(browser.navigator.mediaDevices)
    : null;
  const captureWith = (
    handlers: VoiceSessionCaptureHandlers,
    mediaDevices: MediaDevicesLike,
  ) => {
    const AudioContextCtor = browser.AudioContext ?? browser.webkitAudioContext;
    if (!browser.navigator?.mediaDevices || !AudioContextCtor) {
      throw new Error('VOICE_BROWSER_UNAVAILABLE');
    }
    return createAudioCapture({
      mediaDevices,
      audioContextFactory: () =>
        new AudioContextCtor() as unknown as AudioContextLike,
      onChunk: handlers.onChunk,
      onFailure: handlers.onFailure,
      onLevel: handlers.onLevel,
    });
  };
  return {
    createCapture(handlers) {
      if (!browser.navigator?.mediaDevices || !AudioContextCtor) {
        throw new Error('VOICE_BROWSER_UNAVAILABLE');
      }
      return captureWith(handlers, browser.navigator.mediaDevices);
    },
    createLiveCapture(handlers) {
      if (!warmMedia || !AudioContextCtor) {
        throw new Error('VOICE_BROWSER_UNAVAILABLE');
      }
      return captureWith(handlers, warmMedia.devices);
    },
    disposeLiveCapturePool: () => warmMedia?.dispose(),
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
    createSpeechClient(handlers) {
      if (websocketUrl === null || typeof globalThis.WebSocket !== 'function') {
        throw new Error('VOICE_CONNECTION_UNAVAILABLE');
      }
      const parsed = new URL(websocketUrl);
      const allowedInsecureWsHosts =
        parsed.protocol === 'ws:' ? [parsed.host] : [];
      return new StreamingSpeechClient({
        ticketClient: createStreamingTranscriptionTicketClient({
          endpoint: '/api/v1/voice/speech-tickets',
        }),
        WebSocketCtor: globalThis.WebSocket,
        resolveWsUrl: ({ notebookId }) => {
          const url = new URL(websocketUrl);
          url.pathname = '/v1/client/streaming-speech';
          url.search = '';
          url.searchParams.set('notebookId', notebookId);
          return url.toString();
        },
        allowedInsecureWsHosts,
        ...handlers,
      });
    },
  };
}

/**
 * Live 内每个 ASR operation 仍独立鉴权，但共享同一个已授权 MediaStream。
 * 最后一轮释放后保留一个很短的暖窗口；退出 Live 时 `dispose` 立即停止真实 track。
 */
/** @internal Exported for deterministic lease and disposal tests. */
export function createWarmMediaDevices(
  mediaDevices: MediaDevices,
  keepAliveMs = 8_000,
): { readonly devices: MediaDevicesLike; readonly dispose: () => void } {
  let stream: MediaStream | null = null;
  let pending: Promise<MediaStream> | null = null;
  let leases = 0;
  let generation = 0;
  let stopTimer: ReturnType<typeof setTimeout> | null = null;
  const stop = () => {
    generation += 1;
    if (stopTimer) clearTimeout(stopTimer);
    stopTimer = null;
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    pending = null;
    leases = 0;
  };
  const acquire = async (
    constraints: MediaStreamConstraints,
  ): Promise<MediaStreamLike> => {
    if (stopTimer) clearTimeout(stopTimer);
    stopTimer = null;
    const active = stream
      ?.getTracks()
      .some((track) => track.readyState === 'live');
    if (!active) {
      const requestGeneration = generation;
      const request = (pending ??= mediaDevices.getUserMedia(constraints));
      const acquired = await request;
      if (pending === request) pending = null;
      if (generation !== requestGeneration) {
        acquired.getTracks().forEach((track) => track.stop());
        throw new DOMException('Live capture disposed', 'AbortError');
      }
      stream = acquired;
    }
    leases += 1;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      leases = Math.max(0, leases - 1);
      if (leases === 0) stopTimer = setTimeout(stop, keepAliveMs);
    };
    const rootStream = stream;
    if (!rootStream) {
      release();
      throw new DOMException('Live capture unavailable', 'AbortError');
    }

    /*
     * createMediaStreamSource() performs a browser brand check, so a plain
     * `{ getTracks() }` facade is not a valid source even when it satisfies
     * our TypeScript port. A native clone keeps that brand while allowing an
     * individual ASR operation to stop its tracks without stopping the warm
     * root stream shared by the next turn.
     */
    const leaseStream = rootStream.clone();
    const leaseTracks = leaseStream.getTracks();
    if (leaseTracks.length === 0) {
      release();
      return leaseStream;
    }
    let openTracks = leaseTracks.length;
    for (const track of leaseTracks) {
      const nativeStop = track.stop.bind(track);
      let stopped = false;
      const stopLeaseTrack = () => {
        if (stopped) return;
        stopped = true;
        nativeStop();
        openTracks -= 1;
        if (openTracks === 0) release();
      };
      track.stop = stopLeaseTrack;
      track.addEventListener('ended', stopLeaseTrack, { once: true });
    }
    return leaseStream;
  };
  return {
    devices: { getUserMedia: acquire },
    dispose: stop,
  };
}
