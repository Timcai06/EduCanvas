import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { gatewayOpaqueIdSchema } from '@educanvas/gateway-core';
import type { StreamingSpeechGateway } from '@educanvas/agent-core';
import { WebSocket, WebSocketServer } from 'ws';
import { readBearerToken } from './client-auth';
import { StreamingSpeechChannel } from './streaming-speech-channel';
import {
  decodeStreamingSpeechClientMessage,
  encodeStreamingSpeechAudioFrame,
} from './streaming-speech-wire';
import type { StreamingSpeechServerMessage } from './streaming-speech-wire';
import type { StreamingTranscriptionQuotaManager } from './streaming-transcription-quota-manager';
import type { StreamingTranscriptionQuotas } from './streaming-transcription-quotas';
import type { StreamingTranscriptionTicketStore } from './streaming-transcription-ticket';
import { TICKET_SUBPROTOCOL_PREFIX } from './streaming-transcription-ws-transport';

export const STREAMING_SPEECH_WS_PATH = '/v1/client/streaming-speech' as const;

interface StreamingSpeechUpgradeDependencies {
  readonly tickets: StreamingTranscriptionTicketStore | null;
  readonly checkNotebookAccess: (input: {
    notebookId: string;
    trustedSubjectId: string;
  }) => Promise<boolean>;
  readonly isAllowedOrigin: (origin: string | null | undefined) => boolean;
  readonly gateway: StreamingSpeechGateway | null;
  readonly quotaManager: StreamingTranscriptionQuotaManager;
  readonly quotas: StreamingTranscriptionQuotas;
  readonly readBufferedAmount?: (ws: WebSocket) => number;
  readonly log?: (entry: { label: string; code?: string }) => void;
}

const HTTP_STATUS_TEXT: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  429: 'Too Many Requests',
  503: 'Service Unavailable',
};

function rejectUpgrade(socket: Duplex, status: number, code: string): void {
  const body = JSON.stringify({ error: { code } });
  socket.write(
    `HTTP/1.1 ${status} ${HTTP_STATUS_TEXT[status] ?? 'Error'}\r\n` +
      'content-type: application/json\r\n' +
      `content-length: ${Buffer.byteLength(body)}\r\n` +
      'connection: close\r\n' +
      'x-content-type-options: nosniff\r\n\r\n' +
      body,
  );
  socket.destroy();
}

function readTicket(request: IncomingMessage): string | null {
  const bearer = readBearerToken(request.headers.authorization);
  if (bearer) return bearer;
  const header = request.headers['sec-websocket-protocol'];
  const values = (Array.isArray(header) ? header : header ? [header] : [])
    .flatMap((value) => value.split(','))
    .map((value) => value.trim());
  const protocol = values.find((value) =>
    value.startsWith(TICKET_SUBPROTOCOL_PREFIX),
  );
  const ticket = protocol?.slice(TICKET_SUBPROTOCOL_PREFIX.length) ?? '';
  return ticket.length > 0 && ticket.length <= 4_096 ? ticket : null;
}

function closeWebSocket(ws: WebSocket, code: 1000 | 1008 | 1011): void {
  try {
    if (ws.readyState === WebSocket.OPEN) ws.close(code);
    else ws.terminate();
  } catch {
    ws.terminate();
  }
}

function attachSpeechChannel(
  ws: WebSocket,
  deps: StreamingSpeechUpgradeDependencies,
  socketLease: { release(): void },
): void {
  const sendEvent = (event: StreamingSpeechServerMessage): void => {
    if (ws.readyState !== WebSocket.OPEN) return;
    if (event.type === 'speech.failed') {
      deps.log?.({ label: 'session_failed', code: event.failureCode });
    } else if (event.type === 'speech.finished') {
      deps.log?.({ label: 'session_finished' });
    }
    try {
      ws.send(JSON.stringify(event));
    } catch {
      channel.disconnect();
    }
  };
  const channel = new StreamingSpeechChannel({
    gateway: deps.gateway as StreamingSpeechGateway,
    acquireSession: () => deps.quotaManager.acquireSession(),
    sendEvent,
    sendAudio: (sequence, pcmBytes) => {
      const frame = encodeStreamingSpeechAudioFrame(sequence, pcmBytes);
      if (frame === null || ws.readyState !== WebSocket.OPEN) return false;
      const buffered = deps.readBufferedAmount
        ? deps.readBufferedAmount(ws)
        : ws.bufferedAmount;
      if (buffered + frame.byteLength > deps.quotas.maxOutputBufferedBytes) {
        return false;
      }
      try {
        ws.send(frame, { binary: true });
        return true;
      } catch {
        return false;
      }
    },
    onTerminal: () => closeWebSocket(ws, 1000),
    quotas: deps.quotas,
  });
  ws.on('message', (data, isBinary) => {
    if (isBinary) {
      channel.disconnect();
      closeWebSocket(ws, 1008);
      return;
    }
    const raw = Array.isArray(data) ? Buffer.concat(data) : data;
    const message = decodeStreamingSpeechClientMessage(raw.toString());
    if (message === null) {
      channel.disconnect();
      closeWebSocket(ws, 1008);
      return;
    }
    channel.receive(message);
  });
  const release = () => {
    channel.disconnect();
    socketLease.release();
  };
  ws.on('close', release);
  ws.on('error', () => {
    release();
    ws.terminate();
  });
}

export function createStreamingSpeechUpgradeHandler(
  deps: StreamingSpeechUpgradeDependencies,
): (request: IncomingMessage, socket: Duplex, head: Buffer) => void {
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 80_000,
    handleProtocols: (protocols) =>
      [...protocols].find((value) =>
        value.startsWith(TICKET_SUBPROTOCOL_PREFIX),
      ) ?? false,
  });
  return (request, socket, head) => {
    void handleUpgrade(deps, wss, request, socket, head);
  };
}

async function handleUpgrade(
  deps: StreamingSpeechUpgradeDependencies,
  wss: WebSocketServer,
  request: IncomingMessage,
  socket: Duplex,
  head: Buffer,
): Promise<void> {
  let url: URL;
  try {
    url = new URL(request.url ?? '/', 'http://gateway.internal');
  } catch {
    rejectUpgrade(socket, 400, 'INVALID_REQUEST');
    return;
  }
  if (url.pathname !== STREAMING_SPEECH_WS_PATH) {
    socket.destroy();
    return;
  }
  if (deps.tickets === null) {
    rejectUpgrade(socket, 503, 'CLIENT_TRANSPORT_DISABLED');
    return;
  }
  const notebook = gatewayOpaqueIdSchema.safeParse(
    url.searchParams.get('notebookId'),
  );
  if (!notebook.success) {
    rejectUpgrade(socket, 400, 'INVALID_REQUEST');
    return;
  }
  if (!deps.isAllowedOrigin(request.headers.origin)) {
    rejectUpgrade(socket, 403, 'FORBIDDEN');
    return;
  }
  const ticket = readTicket(request);
  const bound = ticket ? deps.tickets.redeem(ticket, 'speech') : null;
  if (!bound || bound.notebookId !== notebook.data) {
    rejectUpgrade(socket, 401, 'UNAUTHENTICATED');
    return;
  }
  let allowed = false;
  try {
    allowed = await deps.checkNotebookAccess({
      notebookId: notebook.data,
      trustedSubjectId: bound.userId,
    });
  } catch {
    allowed = false;
  }
  if (!allowed) {
    rejectUpgrade(socket, 404, 'NOT_FOUND');
    return;
  }
  if (deps.gateway === null) {
    rejectUpgrade(socket, 503, 'STREAMING_SPEECH_UNAVAILABLE');
    return;
  }
  const socketLease = deps.quotaManager.acquireSocket({
    userId: bound.userId,
    notebookId: notebook.data,
  });
  if (socketLease === null) {
    rejectUpgrade(socket, 429, 'CONNECTION_LIMIT_EXCEEDED');
    return;
  }
  if (socket.destroyed) {
    socketLease.release();
    return;
  }
  let wsCreated = false;
  const releaseIfAborted = () => {
    if (!wsCreated) socketLease.release();
  };
  socket.once('close', releaseIfAborted);
  socket.once('error', releaseIfAborted);
  wss.handleUpgrade(request, socket, head, (ws) => {
    wsCreated = true;
    deps.log?.({ label: 'connection_opened' });
    attachSpeechChannel(ws, deps, socketLease);
  });
}
