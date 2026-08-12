import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type {
  StreamingSpeechEvent,
  StreamingSpeechGateway,
  StreamingSpeechSession,
  StreamingSpeechTextInput,
} from '@educanvas/agent-core';
import { WebSocket } from 'ws';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StreamingTranscriptionQuotaManager } from './streaming-transcription-quota-manager';
import { STREAMING_TRANSCRIPTION_DEFAULT_QUOTAS } from './streaming-transcription-quotas';
import { StreamingTranscriptionTicketStore } from './streaming-transcription-ticket';
import {
  createStreamingSpeechUpgradeHandler,
  STREAMING_SPEECH_WS_PATH,
} from './streaming-speech-ws-transport';

const servers: Server[] = [];
const clients: WebSocket[] = [];

afterEach(async () => {
  clients.splice(0).forEach((client) => {
    try {
      client.terminate();
    } catch {
      /* 握手已被拒绝。 */
    }
  });
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections?.();
          server.close(() => resolve());
        }),
    ),
  );
});

class FakeSession implements StreamingSpeechSession {
  readonly pushed: StreamingSpeechTextInput[] = [];
  readonly finish = vi.fn();
  readonly cancel = vi.fn();
  private readonly queue: StreamingSpeechEvent[] = [];
  private readonly waiters: Array<() => void> = [];
  private terminal = false;
  readonly events: AsyncIterable<StreamingSpeechEvent> = this.iterate();

  pushText(input: StreamingSpeechTextInput): void {
    this.pushed.push(input);
  }
  emit(event: StreamingSpeechEvent): void {
    this.queue.push(event);
    if (event.type !== 'audio') this.terminal = true;
    this.waiters.splice(0).forEach((resolve) => resolve());
  }
  private async *iterate(): AsyncIterable<StreamingSpeechEvent> {
    while (true) {
      while (this.queue.length > 0) yield this.queue.shift()!;
      if (this.terminal) return;
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
  }
}

async function start() {
  const tickets = new StreamingTranscriptionTicketStore();
  const session = new FakeSession();
  const gateway: StreamingSpeechGateway = {
    beginStreaming: () => session,
    streamSpeech: vi.fn(),
  };
  const server = createServer();
  server.on(
    'upgrade',
    createStreamingSpeechUpgradeHandler({
      tickets,
      checkNotebookAccess: async ({ notebookId, trustedSubjectId }) =>
        notebookId === 'notebook:A' && trustedSubjectId === 'user:A',
      isAllowedOrigin: (origin) => origin === 'https://app.example',
      gateway,
      quotaManager: new StreamingTranscriptionQuotaManager(
        STREAMING_TRANSCRIPTION_DEFAULT_QUOTAS,
      ),
      quotas: STREAMING_TRANSCRIPTION_DEFAULT_QUOTAS,
    }),
  );
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  const port = (server.address() as AddressInfo).port;
  return { tickets, session, url: `ws://127.0.0.1:${port}` };
}

function connect(url: string, ticket: string, origin = 'https://app.example') {
  const client = new WebSocket(
    `${url}${STREAMING_SPEECH_WS_PATH}?notebookId=notebook:A`,
    [`ticket.${ticket}`],
    { headers: { origin } },
  );
  client.on('error', () => undefined);
  clients.push(client);
  return client;
}

describe('streaming speech websocket transport', () => {
  it('scoped ticket + Origin + Notebook 权限后才允许连续文本与二进制 PCM', async () => {
    const ctx = await start();
    const ticket = ctx.tickets.issue({
      userId: 'user:A',
      notebookId: 'notebook:A',
      scope: 'speech',
    }).ticket;
    const client = connect(ctx.url, ticket);
    const messages: Array<{ data: Buffer; binary: boolean }> = [];
    client.on('message', (data, binary) =>
      messages.push({ data: Buffer.from(data as Buffer), binary }),
    );
    await new Promise<void>((resolve, reject) => {
      client.once('open', resolve);
      client.once('error', reject);
    });
    client.send(JSON.stringify({ type: 'speech.start', sequence: 0 }));
    client.send(
      JSON.stringify({ type: 'speech.submit', sequence: 1, text: '你好。' }),
    );
    client.send(JSON.stringify({ type: 'speech.finish', sequence: 2 }));
    await vi.waitFor(() => expect(ctx.session.finish).toHaveBeenCalledOnce());
    expect(ctx.session.pushed).toEqual([{ sequence: 0, input: '你好。' }]);
    ctx.session.emit({
      type: 'audio',
      sequence: 0,
      pcmBytes: Uint8Array.of(1, 2),
    });
    ctx.session.emit({ type: 'finished' });
    await vi.waitFor(() => expect(messages.length).toBe(3));
    expect(JSON.parse(messages[0]!.data.toString()).type).toBe(
      'speech.started',
    );
    expect([...messages[1]!.data]).toEqual([
      0x45, 0x44, 0x54, 0x53, 0, 0, 0, 0, 1, 2,
    ]);
    expect(messages[1]!.binary).toBe(true);
    expect(JSON.parse(messages[2]!.data.toString()).type).toBe(
      'speech.finished',
    );
  });

  it('transcription scope ticket 和非白名单 Origin 均拒绝握手', async () => {
    const ctx = await start();
    const transcription = ctx.tickets.issue({
      userId: 'user:A',
      notebookId: 'notebook:A',
    }).ticket;
    const wrongScope = connect(ctx.url, transcription);
    const status = await new Promise<number>((resolve) =>
      wrongScope.once('unexpected-response', (_request, response) =>
        resolve(response.statusCode ?? 0),
      ),
    );
    expect(status).toBe(401);

    const speech = ctx.tickets.issue({
      userId: 'user:A',
      notebookId: 'notebook:A',
      scope: 'speech',
    }).ticket;
    const badOrigin = connect(ctx.url, speech, 'https://evil.example');
    const forbidden = await new Promise<number>((resolve) =>
      badOrigin.once('unexpected-response', (_request, response) =>
        resolve(response.statusCode ?? 0),
      ),
    );
    expect(forbidden).toBe(403);
  });
});
