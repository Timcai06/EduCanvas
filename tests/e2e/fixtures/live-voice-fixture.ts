import type { Page } from '@playwright/test';

export interface FakeLiveVoiceSnapshot {
  readonly readyConnections: number;
  readonly turnRequests: readonly Record<string, unknown>[];
  readonly cancelRequests: readonly string[];
  readonly speechTicketsRequests: number;
  readonly speechRequests: number;
  readonly speechAborts: number;
  readonly streamingSpeechRequests: number;
  readonly streamingSpeechStarts: number;
  readonly streamingSpeechAbortEvents: number;
  readonly streamingSpeechCloseEvents: number;
  readonly streamingSpeechFinished: number;
  readonly streamingSpeechFailed: number;
  readonly streamingSpeechCancelled: number;
  readonly streamingSpeechTransportMode: 'streaming' | 'fallback';
  readonly playbackStarts: number;
  readonly playbackStops: number;
  readonly activePlaybackSources: number;
  readonly clientFrameTypes: readonly string[];
  readonly events: readonly string[];
}

interface BrowserLiveVoiceDriver {
  emitPartial(text: string): void;
  emitFinal(text: string): void;
  holdNextTurn(assistantText: string): void;
  setSpeechTransportMode(mode: 'streaming' | 'fallback'): void;
  snapshot(): FakeLiveVoiceSnapshot;
}

declare global {
  interface Window {
    __EDUCANVAS_E2E_LIVE_VOICE__?: BrowserLiveVoiceDriver;
  }
}

/** 浏览器仍跑真实产品状态机；fixture 只封住外部 I/O，且不保存合成 PCM。 */
export async function installFakeLiveVoice(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const originalFetch = globalThis.fetch.bind(globalThis);
    const encoder = new TextEncoder();

    const FRAME_HEADER_BYTES = 8;
    const FRAME_MAGIC = [0x45, 0x44, 0x54, 0x53] as const;

    const turnRequests: Record<string, unknown>[] = [];
    const cancelRequests: string[] = [];
    const clientFrameTypes: string[] = [];
    const events: string[] = [];
    const sockets: FakeWebSocket[] = [];

    let readyConnections = 0;
    let speechTicketsRequests = 0;
    let speechRequests = 0;
    let speechAborts = 0;
    let streamingSpeechRequests = 0;
    let streamingSpeechStarts = 0;
    let streamingSpeechAbortEvents = 0;
    let streamingSpeechCloseEvents = 0;
    let streamingSpeechFinished = 0;
    let streamingSpeechFailed = 0;
    let streamingSpeechCancelled = 0;
    let playbackStarts = 0;
    let playbackStops = 0;
    let activePlaybackSources = 0;
    let speechTransportMode: 'streaming' | 'fallback' = 'streaming';

    let holdNext = false;
    let holdNextSpeech = false;
    let nextAssistantText = '';

    const frame = (
      type: string,
      turnId: string,
      data: Record<string, unknown>,
    ) =>
      encoder.encode(
        `event: ${type}\ndata: ${JSON.stringify({ type, schemaVersion: '1', turnId, ...data })}\n\n`,
      );

    class FakeWebSocket extends EventTarget {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSING = 2;
      static readonly CLOSED = 3;

      readonly url: string;
      readonly mode: 'asr' | 'streaming';
      readonly protocol = '';
      readonly extensions = '';
      readonly bufferedAmount = 0;
      binaryType: BinaryType = 'blob';
      readyState = FakeWebSocket.CONNECTING;
      onopen: ((event: Event) => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onclose: ((event: CloseEvent) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;

      private operationId: string | null = null;
      private segmentId: string | null = null;
      private serverSequence = 0;
      private streamingSequence = 0;
      private streamingCompleted = false;
      private streamingHold = false;
      private streamingFrameTimer:
        (number | ReturnType<typeof window.setInterval>) | null = null;

      constructor(url: string | URL, _protocols?: string | string[]) {
        super();
        this.url = String(url);
        const parsed = new URL(this.url, location.origin);
        this.mode = parsed.pathname.includes('/v1/client/streaming-speech')
          ? 'streaming'
          : 'asr';
        sockets.push(this);

        queueMicrotask(() => {
          this.readyState = FakeWebSocket.OPEN;
          if (this.mode === 'streaming') {
            streamingSpeechRequests += 1;
            events.push('streaming.speech.open');
          } else {
            events.push('asr.socket.open');
          }
          const event = new Event('open');
          this.dispatchEvent(event);
          this.onopen?.(event);
        });
      }

      send(raw: string | ArrayBufferLike | Blob | ArrayBufferView): void {
        if (typeof raw !== 'string') return;
        const message = JSON.parse(raw) as {
          type?: string;
          operationId?: string;
          segmentId?: string;
          text?: string;
        };
        if (message.type) clientFrameTypes.push(message.type);
        if (this.mode === 'streaming') {
          if (message.type === 'speech.start') {
            streamingSpeechStarts += 1;
            events.push('streaming.speech.start');
            this.streamingHold = holdNextSpeech;
            events.push('speech.started');
            this.dispatchMessage({
              type: 'speech.started',
              format: 'pcm_s16le',
              sampleRate: 24_000,
              channels: 1,
            });
          }
          if (message.type === 'speech.submit') {
            events.push('streaming.speech.submit');
            this.beginStreaming();
          }
          if (message.type === 'speech.finish') {
            events.push('streaming.speech.finish');
            if (!this.streamingCompleted && !this.streamingHold) {
              this.finish();
            }
          }
          if (message.type === 'speech.cancel') {
            events.push('streaming.speech.cancel');
            streamingSpeechCancelled += 1;
            this.cancel();
          }
          return;
        }

        if (message.type === 'start') {
          this.operationId = message.operationId ?? null;
          this.segmentId = message.segmentId ?? null;
          readyConnections += 1;
          events.push('voice.ready');
        }
      }

      private beginStreaming(): void {
        if (this.streamingCompleted || this.streamingFrameTimer !== null) {
          return;
        }
        this.streamingFrameTimer = window.setInterval(() => {
          this.emitFrame();
        }, 40);
        this.emitFrame();
      }

      private emitFrame(): void {
        if (this.streamingCompleted || this.readyState !== FakeWebSocket.OPEN) {
          return;
        }
        // Each frame spans 200 ms so the real AudioBufferSource is observable
        // as audible playback before barge-in stops the scheduled source.
        const pcm = new Int16Array(4_800);
        for (let index = 0; index < pcm.length; index += 1) {
          const sample = index % 80 < 20 ? 2_048 : -2_048;
          pcm[index] = sample;
        }
        const pcmBytes = new Uint8Array(pcm.buffer);
        const message = new Uint8Array(FRAME_HEADER_BYTES + pcm.byteLength);
        message.set(FRAME_MAGIC, 0);
        const view = new DataView(message.buffer, message.byteOffset);
        view.setUint32(4, this.streamingSequence, false);
        message.set(pcmBytes, FRAME_HEADER_BYTES);
        this.streamingSequence += 1;
        const event = new MessageEvent('message', { data: message.buffer });
        this.dispatchEvent(event);
        this.onmessage?.(event);
        events.push('streaming.speech.frame');
      }

      private finish(): void {
        if (this.streamingCompleted) return;
        this.streamingCompleted = true;
        this.stopStreaming();
        this.dispatchMessage({ type: 'speech.finished' });
        events.push('speech.finished');
        streamingSpeechFinished += 1;
      }

      private fail(code: 'CANCELLED' | 'CONNECTION_LOST'): void {
        if (this.streamingCompleted) return;
        this.streamingCompleted = true;
        this.stopStreaming();
        this.dispatchMessage({
          type: 'speech.failed',
          failureCode: code,
        });
        events.push('speech.failed');
        streamingSpeechFailed += 1;
      }

      private cancel(): void {
        streamingSpeechAbortEvents += 1;
        if (this.streamingCompleted) return;
        this.fail('CANCELLED');
      }

      private stopStreaming(): void {
        if (this.streamingFrameTimer === null) return;
        window.clearInterval(this.streamingFrameTimer);
        this.streamingFrameTimer = null;
      }

      private dispatchMessage(message: object): void {
        if (this.readyState === FakeWebSocket.CLOSED) return;
        const event = new MessageEvent('message', {
          data: JSON.stringify(message),
        });
        this.dispatchEvent(event);
        this.onmessage?.(event);
      }

      close(): void {
        if (
          this.readyState === FakeWebSocket.CLOSED ||
          this.readyState === FakeWebSocket.CLOSING
        ) {
          return;
        }
        if (this.mode === 'streaming') {
          streamingSpeechCloseEvents += 1;
          events.push('streaming.speech.close');
          this.stopStreaming();
          if (!this.streamingCompleted) {
            this.fail('CONNECTION_LOST');
          }
        }
        this.readyState = FakeWebSocket.CLOSING;
        const event = new CloseEvent('close', { code: 1000 });
        this.dispatchEvent(event);
        this.onclose?.(event);
        this.readyState = FakeWebSocket.CLOSED;
      }

      emit(type: 'partial' | 'final', text: string): void {
        if (
          this.mode !== 'asr' ||
          this.readyState !== FakeWebSocket.OPEN ||
          !this.operationId ||
          !this.segmentId
        ) {
          throw new Error('fake voice socket is not ready');
        }
        const data = JSON.stringify({
          protocolVersion: 'educanvas.streaming-transcription.v1',
          operationId: this.operationId,
          segmentId: this.segmentId,
          sequence: this.serverSequence,
          type,
          text,
        });
        this.serverSequence += 1;
        const event = new MessageEvent('message', { data });
        this.dispatchEvent(event);
        this.onmessage?.(event);
        events.push(`voice.${type}`);
      }
    }

    const activeSocket = () => {
      const socket = [...sockets]
        .reverse()
        .find(
          (candidate) =>
            candidate.readyState === FakeWebSocket.OPEN &&
            candidate.mode === 'asr',
        );
      if (!socket) throw new Error('no active fake voice socket');
      return socket;
    };

    Object.defineProperty(globalThis, 'WebSocket', {
      configurable: true,
      value: FakeWebSocket,
    });

    const nativeCreateScriptProcessor =
      AudioContext.prototype.createScriptProcessor;
    AudioContext.prototype.createScriptProcessor = function (
      ...args: Parameters<AudioContext['createScriptProcessor']>
    ) {
      const processor = nativeCreateScriptProcessor.apply(this, args);
      const samples = new Float32Array(args[0] ?? 2_048).fill(0.2);
      const timer = window.setInterval(() => {
        processor.onaudioprocess?.({
          inputBuffer: {
            numberOfChannels: 1,
            getChannelData: () => samples,
          },
        } as unknown as AudioProcessingEvent);
      }, 40);
      const disconnect = processor.disconnect.bind(processor);
      processor.disconnect = () => {
        window.clearInterval(timer);
        disconnect();
      };
      return processor;
    };

    const nativeCreateBufferSource = AudioContext.prototype.createBufferSource;
    AudioContext.prototype.createBufferSource = function () {
      const source = nativeCreateBufferSource.call(this);
      const nativeStart = source.start.bind(source);
      const nativeStop = source.stop.bind(source);
      let audible = false;
      let settled = false;
      source.start = (...args: Parameters<AudioBufferSourceNode['start']>) => {
        audible = (source.buffer?.duration ?? 0) >= 0.1;
        if (audible) {
          playbackStarts += 1;
          activePlaybackSources += 1;
          events.push('playback.start');
        }
        nativeStart(...args);
      };
      source.stop = (...args: Parameters<AudioBufferSourceNode['stop']>) => {
        if (audible && !settled) {
          settled = true;
          playbackStops += 1;
          activePlaybackSources -= 1;
          events.push('playback.stop');
        }
        nativeStop(...args);
      };
      source.addEventListener('ended', () => {
        if (!audible || settled) return;
        settled = true;
        activePlaybackSources -= 1;
      });
      return source;
    };

    const audioContext = new AudioContext();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const mediaDestination = audioContext.createMediaStreamDestination();
    gain.gain.value = 0.2;
    oscillator.connect(gain).connect(mediaDestination);
    oscillator.start();
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: async () => mediaDestination.stream.clone(),
      },
    });

    globalThis.fetch = async (input, init) => {
      const request = input instanceof Request ? input : null;
      const url = new URL(
        request?.url ?? (input instanceof URL ? input.href : String(input)),
        location.origin,
      );
      const method = (init?.method ?? request?.method ?? 'GET').toUpperCase();

      if (url.pathname === '/api/v1/voice/capability') {
        return Response.json({
          checks: [
            { key: 'model', healthy: true },
            { key: 'speech', healthy: true },
            { key: 'connection', healthy: true },
          ],
          websocketUrl: 'wss://voice-fixture.invalid/live',
        });
      }
      if (url.pathname === '/api/v1/voice/tickets' && method === 'POST') {
        return Response.json(
          {
            ticket: 'synthetic-e2e-ticket',
            expiresAt: '2030-01-01T00:00:00.000Z',
          },
          { status: 201 },
        );
      }
      if (
        url.pathname === '/api/v1/voice/speech-tickets' &&
        method === 'POST'
      ) {
        speechTicketsRequests += 1;
        if (speechTransportMode === 'fallback') {
          return Response.json(
            { error: { code: 'STREAMING_SPEECH_UNSUPPORTED' } },
            {
              status: 503,
            },
          );
        }
        return Response.json(
          {
            ticket: 'streaming-speech-ticket',
            expiresAt: '2030-01-01T00:00:00.000Z',
          },
          { status: 201 },
        );
      }
      if (url.pathname === '/api/v1/chat/assets' && method === 'GET') {
        const asset = (
          assetId: string,
          versionId: string | null,
          kind: 'image' | 'document',
          displayName: string,
          status: 'ready' | 'processing',
        ) => ({
          descriptor: {
            assetId,
            scope: 'space',
            kind,
            displayName,
            status,
            currentVersionId: versionId,
          },
          version: versionId ? { versionId } : null,
          processing: null,
          enabled: true,
        });
        return Response.json({
          assets: [
            asset(
              'asset-image-1',
              'version-image-7',
              'image',
              '电路图.png',
              'ready',
            ),
            asset(
              'asset-doc-1',
              'version-doc-3',
              'document',
              '实验记录.pdf',
              'ready',
            ),
            asset(
              'asset-processing-1',
              null,
              'document',
              '处理中资料.pdf',
              'processing',
            ),
          ],
        });
      }
      if (url.pathname === '/api/v1/chat/turn' && method === 'POST') {
        const rawBody = init?.body ?? (request ? await request.text() : null);
        const body = JSON.parse(String(rawBody)) as Record<string, unknown>;
        turnRequests.push(body);
        const index = turnRequests.length;
        const turnId = `fake-turn-${index}`;
        const messageId = `fake-assistant-${index}`;
        const assistantText =
          nextAssistantText || `第 ${index} 轮回答已经准备好，请继续。`;
        const shouldHold = holdNext;
        holdNext = false;
        nextAssistantText = '';
        holdNextSpeech = shouldHold;
        events.push('turn.request');

        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              frame('turn.accepted', turnId, {
                studentMessageId: `fake-student-${index}`,
                assistantMessageId: messageId,
                replayed: false,
              }),
            );
            controller.enqueue(
              frame('tool.started', turnId, {
                toolCallId: `fake-tool-${index}`,
                label: '正在检索资料',
              }),
            );
            controller.enqueue(
              frame('tool.completed', turnId, {
                toolCallId: `fake-tool-${index}`,
              }),
            );
            controller.enqueue(
              frame('message.delta', turnId, {
                messageId,
                delta: assistantText,
              }),
            );
            if (!shouldHold) {
              controller.enqueue(
                frame('turn.completed', turnId, { messageId }),
              );
              controller.close();
              return;
            }
            init?.signal?.addEventListener(
              'abort',
              () => {
                events.push('turn.abort');
                try {
                  controller.error(new DOMException('aborted', 'AbortError'));
                } catch {
                  // The consumer may already have closed after a confirmed cancel.
                }
              },
              { once: true },
            );
          },
        });
        return new Response(stream, {
          headers: { 'content-type': 'text/event-stream; charset=utf-8' },
        });
      }
      const cancelMatch =
        method === 'POST'
          ? /^\/api\/v1\/chat\/turn\/([^/]+)\/cancel$/.exec(url.pathname)
          : null;
      if (cancelMatch) {
        cancelRequests.push(decodeURIComponent(cancelMatch[1]!));
        events.push('turn.cancel');
        return Response.json({ accepted: true, status: 'cancelled' });
      }
      if (url.pathname === '/api/v1/voice/live/speech' && method === 'POST') {
        speechRequests += 1;
        events.push('speech.request');
        const shouldHold = holdNextSpeech;
        holdNextSpeech = false;
        let aborted = false;
        const pcm = new Uint8Array(shouldHold ? 480_000 : 96_000);
        const view = new DataView(pcm.buffer);
        for (let offset = 0; offset < pcm.byteLength; offset += 2) {
          view.setInt16(offset, offset % 8 === 0 ? 2_048 : -2_048, true);
        }
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(pcm);
            if (!shouldHold) {
              controller.close();
              return;
            }
            init?.signal?.addEventListener(
              'abort',
              () => {
                if (aborted) return;
                aborted = true;
                speechAborts += 1;
                events.push('speech.abort');
                try {
                  controller.error(new DOMException('aborted', 'AbortError'));
                } catch {
                  // The stream may already have been closed by the consumer.
                }
              },
              { once: true },
            );
          },
        });
        return new Response(body, {
          headers: {
            'content-type': 'audio/L16; rate=24000; channels=1',
          },
        });
      }
      return originalFetch(input, init);
    };

    window.__EDUCANVAS_E2E_LIVE_VOICE__ = {
      emitPartial: (text) => activeSocket().emit('partial', text),
      emitFinal: (text) => activeSocket().emit('final', text),
      holdNextTurn: (assistantText) => {
        holdNext = true;
        nextAssistantText = assistantText;
      },
      setSpeechTransportMode: (mode) => {
        speechTransportMode = mode;
      },
      snapshot: () => ({
        readyConnections,
        turnRequests: structuredClone(turnRequests),
        cancelRequests: [...cancelRequests],
        speechTicketsRequests,
        speechRequests,
        speechAborts,
        streamingSpeechRequests,
        streamingSpeechStarts,
        streamingSpeechAbortEvents,
        streamingSpeechCloseEvents,
        streamingSpeechFinished,
        streamingSpeechFailed,
        streamingSpeechCancelled,
        streamingSpeechTransportMode: speechTransportMode,
        playbackStarts,
        playbackStops,
        activePlaybackSources,
        clientFrameTypes: [...clientFrameTypes],
        events: [...events],
      }),
    };
  });
}

export async function emitVoicePartial(page: Page, text: string) {
  await page.evaluate((value) => {
    window.__EDUCANVAS_E2E_LIVE_VOICE__!.emitPartial(value);
  }, text);
}

export async function emitVoiceFinal(page: Page, text: string) {
  await page.evaluate((value) => {
    window.__EDUCANVAS_E2E_LIVE_VOICE__!.emitFinal(value);
  }, text);
}

export async function holdNextVoiceTurn(page: Page, assistantText: string) {
  await page.evaluate((value) => {
    window.__EDUCANVAS_E2E_LIVE_VOICE__!.holdNextTurn(value);
  }, assistantText);
}

export async function setSpeechTransportMode(
  page: Page,
  mode: 'streaming' | 'fallback',
) {
  await page.evaluate((value) => {
    window.__EDUCANVAS_E2E_LIVE_VOICE__!.setSpeechTransportMode(value);
  }, mode);
}

export async function readFakeLiveVoiceSnapshot(
  page: Page,
): Promise<FakeLiveVoiceSnapshot> {
  return page.evaluate(() => {
    const driver = window.__EDUCANVAS_E2E_LIVE_VOICE__;
    if (!driver) throw new Error('Live Voice fixture driver is unavailable');
    return driver.snapshot();
  });
}
