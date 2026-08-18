import { describe, expect, it, vi } from 'vitest';
import { createAssistantProxy } from '../src/main/assistant-proxy';
import type { StoredDesktopSession } from '../src/main/desktop-session-store';
import type { GatewayOperationEvent } from '@educanvas/gateway-core';

const session: StoredDesktopSession = {
  version: 2,
  token: `ecs1_${'t'.repeat(43)}`,
  expiresAt: '2026-09-10T08:00:00.000Z',
  webBaseUrl: 'https://learn.educanvas.example',
  gatewayBaseUrl: 'https://gateway.educanvas.example',
  userId: 'user:one',
  initialCursor: {
    notebookId: 'notebook:bound',
    conversationId: 'conversation:bound',
  },
};

function event(
  sequence: number,
  value:
    | { type: 'operation.accepted' }
    | { type: 'message.delta'; delta: string }
    | { type: 'operation.completed'; messageId: string },
): GatewayOperationEvent {
  return {
    protocol: 'gateway.v1',
    eventId: `event:${sequence}`,
    operationId: 'operation:one',
    sequence,
    occurredAt: '2026-08-11T08:00:00.000Z',
    ...value,
  };
}

describe('remote assistant proxy', () => {
  it('uses the initial Conversation/Notebook and aggregates deltas', async () => {
    const calls: Array<{
      url: string;
      authorization: string | null;
      body: unknown;
    }> = [];
    const fetchImpl = (async (input, init) => {
      const url = String(input);
      calls.push({
        url,
        authorization: new Headers(init?.headers).get('authorization'),
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      return new Response(
        [
          event(0, { type: 'operation.accepted' }),
          event(1, { type: 'message.delta', delta: '你好，' }),
          event(2, { type: 'message.delta', delta: '我是老师。' }),
          event(3, { type: 'operation.completed', messageId: 'message:one' }),
        ]
          .map((value) => JSON.stringify(value))
          .join('\n'),
        { headers: { 'content-type': 'application/x-ndjson' } },
      );
    }) as typeof fetch;
    const proxy = createAssistantProxy({
      getSession: async () => session,
      invalidateSession: async () => undefined,
      fetchImpl,
    });

    await expect(proxy.turn({ text: '你好' })).resolves.toEqual({
      ok: true,
      action: 'answered',
      message: '你好，我是老师。',
      assistantMessageId: 'message:one',
    });
    expect(calls).toHaveLength(1);
    expect(
      calls.every((call) => call.authorization === `Bearer ${session.token}`),
    ).toBe(true);
    expect(calls[0]!.url).toContain('/v1/client/turns');
    expect(calls[0]!.body).toMatchObject({
      notebookId: 'notebook:bound',
      conversationId: 'conversation:bound',
      parts: [{ type: 'text', text: '你好' }],
      clientMessageId: expect.stringMatching(/^desktop:/),
    });
  });

  it('can route the same signed-in identity to another conversation', async () => {
    let request: unknown;
    const proxy = createAssistantProxy({
      getSession: async () => session,
      invalidateSession: async () => undefined,
      clientFactory: () => ({
        async *streamTurn(value) {
          request = value;
          yield event(0, { type: 'operation.accepted' });
          yield event(1, {
            type: 'operation.completed',
            messageId: 'message:other',
          });
        },
        async cancelOperation() {
          return { status: 'cancelled' as const };
        },
      }),
    });

    await expect(
      proxy.turn({
        text: '继续',
        cursor: {
          notebookId: 'notebook:other',
          conversationId: 'conversation:other',
        },
      }),
    ).resolves.toMatchObject({ ok: true });
    expect(request).toMatchObject({
      notebookId: 'notebook:other',
      conversationId: 'conversation:other',
    });
  });

  it('forwards stream events through tracker.onEvent for DP05 projection', async () => {
    const seen: string[] = [];
    const proxy = createAssistantProxy({
      getSession: async () => session,
      invalidateSession: async () => undefined,
      clientFactory: () => ({
        async *streamTurn() {
          yield event(0, { type: 'operation.accepted' });
          yield event(1, { type: 'message.delta', delta: '你好，' });
          yield event(2, { type: 'message.delta', delta: '我是老师。' });
          yield event(3, {
            type: 'operation.completed',
            messageId: 'message:one',
          });
        },
        async cancelOperation() {
          return { status: 'cancelled' as const };
        },
      }),
    });
    const result = await proxy.turn({ text: '你好' }, undefined, {
      operationId: null,
      lastSequence: -1,
      onEvent: (item) => seen.push(item.type),
    });
    expect(result).toMatchObject({ ok: true });
    expect(seen).toEqual([
      'operation.accepted',
      'message.delta',
      'message.delta',
      'operation.completed',
    ]);
  });

  it('requires a desktop session', async () => {
    const withoutSession = createAssistantProxy({
      getSession: async () => null,
      invalidateSession: async () => undefined,
    });
    await expect(withoutSession.turn({ text: 'hi' })).resolves.toMatchObject({
      ok: false,
      code: 'unauthenticated',
    });
  });

  it('does not start a turn without an initial conversation cursor', async () => {
    const clientFactory = vi.fn();
    const proxy = createAssistantProxy({
      getSession: async () => ({ ...session, initialCursor: null }),
      invalidateSession: async () => undefined,
      clientFactory,
    });
    await expect(proxy.turn({ text: 'hi' })).resolves.toMatchObject({
      ok: false,
      code: 'route_required',
    });
    expect(clientFactory).not.toHaveBeenCalled();
  });

  it('clears an invalid local session after Gateway 401', async () => {
    const invalidateSession = vi.fn(async () => undefined);
    const proxy = createAssistantProxy({
      getSession: async () => session,
      invalidateSession,
      clientFactory: () => ({
        async *streamTurn() {
          throw Object.assign(new Error('unauthenticated'), { status: 401 });
        },
        async cancelOperation() {
          return { status: 'cancelled' as const };
        },
      }),
    });
    await expect(proxy.turn({ text: 'hi' })).resolves.toMatchObject({
      ok: false,
      code: 'unauthenticated',
    });
    expect(invalidateSession).toHaveBeenCalledOnce();
  });

  it('cancels the accepted Gateway operation when the user aborts', async () => {
    const cancelOperation = vi.fn(async () => ({
      status: 'cancelling' as const,
    }));
    const proxy = createAssistantProxy({
      getSession: async () => session,
      invalidateSession: async () => undefined,
      clientFactory: () => ({
        async *streamTurn(_request, options) {
          yield event(0, { type: 'operation.accepted' });
          await new Promise<void>((_resolve, reject) =>
            options?.signal?.addEventListener(
              'abort',
              () => reject(new DOMException('aborted', 'AbortError')),
              { once: true },
            ),
          );
        },
        cancelOperation,
      }),
    });
    const controller = new AbortController();
    const pending = proxy.turn({ text: '停止' }, controller.signal);
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();
    await expect(pending).resolves.toMatchObject({
      ok: false,
      code: 'aborted',
    });
    expect(cancelOperation).toHaveBeenCalledWith('operation:one');
  });

  it('ends the local stream immediately when remote cancellation hangs', async () => {
    const cancelOperation = vi.fn(
      () =>
        new Promise<{ status: 'cancelling' }>((resolve) => {
          setTimeout(() => resolve({ status: 'cancelling' }), 100);
        }),
    );
    const proxy = createAssistantProxy({
      getSession: async () => session,
      invalidateSession: async () => undefined,
      clientFactory: () => ({
        async *streamTurn(_request, options) {
          yield event(0, { type: 'operation.accepted' });
          await new Promise<void>((_resolve, reject) =>
            options?.signal?.addEventListener(
              'abort',
              () => reject(new DOMException('aborted', 'AbortError')),
              { once: true },
            ),
          );
        },
        cancelOperation,
      }),
    });
    const controller = new AbortController();
    const pending = proxy.turn({ text: '停止' }, controller.signal);
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();

    const outcome = await Promise.race([
      pending.then(() => 'settled' as const),
      new Promise<'hung'>((resolve) => setTimeout(() => resolve('hung'), 30)),
    ]);
    expect(outcome).toBe('settled');
    expect(cancelOperation).toHaveBeenCalledWith('operation:one');
  });

  it('does not project events that arrive after local cancellation', async () => {
    const cancelOperation = vi.fn(async () => ({
      status: 'cancelling' as const,
    }));
    let releaseAccepted!: () => void;
    const accepted = new Promise<void>((resolve) => {
      releaseAccepted = resolve;
    });
    const seen: string[] = [];
    const tracker = {
      operationId: null as string | null,
      lastSequence: -1,
      onEvent: (item: GatewayOperationEvent) => seen.push(item.type),
    };
    const proxy = createAssistantProxy({
      getSession: async () => session,
      invalidateSession: async () => undefined,
      clientFactory: () => ({
        async *streamTurn() {
          await accepted;
          yield event(0, { type: 'operation.accepted' });
          yield event(1, { type: 'message.delta', delta: '迟到的回答' });
          yield event(2, {
            type: 'operation.completed',
            messageId: 'message:late',
          });
        },
        cancelOperation,
      }),
    });
    const controller = new AbortController();
    const pending = proxy.turn({ text: '停止' }, controller.signal, tracker);
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();

    await expect(pending).resolves.toMatchObject({
      ok: false,
      code: 'aborted',
    });
    releaseAccepted();
    await vi.waitFor(() =>
      expect(cancelOperation).toHaveBeenCalledWith('operation:one'),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(seen).toEqual([]);
    expect(tracker.operationId).toBeNull();
    expect(tracker.lastSequence).toBe(-1);
  });

  it('still cancels remotely when the user aborts before operation.accepted arrives', async () => {
    const cancelOperation = vi.fn(async () => ({
      status: 'cancelling' as const,
    }));
    let releaseAccepted!: () => void;
    const accepted = new Promise<void>((resolve) => {
      releaseAccepted = resolve;
    });
    const proxy = createAssistantProxy({
      getSession: async () => session,
      invalidateSession: async () => undefined,
      clientFactory: () => ({
        async *streamTurn(_request, options) {
          await accepted;
          if (options?.signal?.aborted) return;
          yield event(0, { type: 'operation.accepted' });
          await new Promise<void>((_resolve, reject) =>
            options?.signal?.addEventListener(
              'abort',
              () => reject(new DOMException('aborted', 'AbortError')),
              { once: true },
            ),
          );
        },
        cancelOperation,
      }),
    });
    const controller = new AbortController();
    const pending = proxy.turn({ text: '停止' }, controller.signal);
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();
    releaseAccepted();

    await expect(pending).resolves.toMatchObject({
      ok: false,
      code: 'aborted',
    });
    expect(cancelOperation).toHaveBeenCalledWith('operation:one');
  });

  it('does not accept operation.completed after a user cancellation wins', async () => {
    let releaseCancel!: () => void;
    const cancelOperation = vi.fn(
      () =>
        new Promise<{ status: 'cancelling' }>((resolve) => {
          releaseCancel = () => resolve({ status: 'cancelling' });
        }),
    );
    const proxy = createAssistantProxy({
      getSession: async () => session,
      invalidateSession: async () => undefined,
      clientFactory: () => ({
        async *streamTurn() {
          yield event(0, { type: 'operation.accepted' });
          await new Promise((resolve) => setTimeout(resolve, 0));
          yield event(1, { type: 'message.delta', delta: '不应显示' });
          yield event(2, {
            type: 'operation.completed',
            messageId: 'message:late',
          });
        },
        cancelOperation,
      }),
    });
    const controller = new AbortController();
    const pending = proxy.turn({ text: '停止' }, controller.signal);
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();

    await expect(pending).resolves.toMatchObject({
      ok: false,
      code: 'aborted',
    });
    releaseCancel();
  });

  it('does not accept operation.completed after the local timeout wins', async () => {
    let releaseCancel!: () => void;
    const proxy = createAssistantProxy({
      getSession: async () => session,
      invalidateSession: async () => undefined,
      timeoutMs: 1,
      clientFactory: () => ({
        async *streamTurn() {
          yield event(0, { type: 'operation.accepted' });
          await new Promise((resolve) => setTimeout(resolve, 5));
          yield event(1, { type: 'message.delta', delta: '过期回答' });
          yield event(2, {
            type: 'operation.completed',
            messageId: 'message:too-late',
          });
        },
        cancelOperation: () =>
          new Promise<{ status: 'cancelling' }>((resolve) => {
            releaseCancel = () => resolve({ status: 'cancelling' });
          }),
      }),
    });

    const pending = proxy.turn({ text: '一个很慢的问题' });
    await expect(pending).resolves.toMatchObject({
      ok: false,
      code: 'timeout',
    });
    releaseCancel();
  });
});

describe('remote assistant proxy resume & interrupted', () => {
  it('resumes from afterSequence and re-terminates on operation.completed', async () => {
    const resume = vi.fn(async (_operationId: string, _after?: number) => [
      event(2, { type: 'message.delta', delta: '后半句' }),
      event(3, { type: 'operation.completed', messageId: 'message:one' }),
    ]);
    const proxy = createAssistantProxy({
      getSession: async () => session,
      invalidateSession: async () => undefined,
      clientFactory: () => ({
        async *streamTurn() {},
        async cancelOperation() {
          return { status: 'cancelled' as const };
        },
        resume,
      }),
    });
    await expect(
      proxy.resume({ operationId: 'operation:one', afterSequence: 1 }),
    ).resolves.toMatchObject({ ok: true, action: 'answered' });
    expect(resume).toHaveBeenCalledWith('operation:one', 1);
  });

  it('reports interrupted when the resume snapshot has no terminal event', async () => {
    const proxy = createAssistantProxy({
      getSession: async () => session,
      invalidateSession: async () => undefined,
      clientFactory: () => ({
        async *streamTurn() {},
        async cancelOperation() {
          return { status: 'cancelled' as const };
        },
        async resume() {
          return [event(2, { type: 'message.delta', delta: '进行中' })];
        },
      }),
    });
    await expect(
      proxy.resume({ operationId: 'operation:one', afterSequence: 1 }),
    ).resolves.toMatchObject({ ok: false, code: 'interrupted' });
  });

  it('reports interrupted when the turn stream ends without a terminal event', async () => {
    const proxy = createAssistantProxy({
      getSession: async () => session,
      invalidateSession: async () => undefined,
      clientFactory: () => ({
        async *streamTurn() {
          yield event(0, { type: 'operation.accepted' });
          yield event(1, { type: 'message.delta', delta: '只说了一半' });
        },
        async cancelOperation() {
          return { status: 'cancelled' as const };
        },
      }),
    });
    await expect(proxy.turn({ text: '你好' })).resolves.toMatchObject({
      ok: false,
      code: 'interrupted',
    });
  });

  it('reports the operationId and lastSequence through the tracker', async () => {
    const tracker = { operationId: null as string | null, lastSequence: -1 };
    const proxy = createAssistantProxy({
      getSession: async () => session,
      invalidateSession: async () => undefined,
      clientFactory: () => ({
        async *streamTurn() {
          yield event(0, { type: 'operation.accepted' });
          yield event(1, { type: 'message.delta', delta: '你好' });
          yield event(2, {
            type: 'operation.completed',
            messageId: 'message:one',
          });
        },
        async cancelOperation() {
          return { status: 'cancelled' as const };
        },
      }),
    });
    await proxy.turn({ text: '你好' }, undefined, tracker);
    expect(tracker.operationId).toBe('operation:one');
    expect(tracker.lastSequence).toBe(2);
  });

  it('sinks an owned attachment into asset_ref parts with the cursor notebook (DP10)', async () => {
    let requestBody: unknown;
    const fetchImpl = (async (_input, init) => {
      requestBody = init?.body ? JSON.parse(String(init.body)) : null;
      return new Response(
        [
          event(0, { type: 'operation.accepted' }),
          event(1, { type: 'operation.completed', messageId: 'message:one' }),
        ]
          .map((value) => JSON.stringify(value))
          .join('\n'),
        { headers: { 'content-type': 'application/x-ndjson' } },
      );
    }) as typeof fetch;
    const proxy = createAssistantProxy({
      getSession: async () => session,
      invalidateSession: async () => undefined,
      fetchImpl,
    });
    await proxy.turn({
      text: '看看这张图',
      attachment: {
        assetId: 'asset:one',
        versionId: 'version:one',
        kind: 'image',
        mimeType: 'image/png',
        displayName: '截图.png',
        notebookId: 'notebook:bound',
      },
    });
    expect(requestBody).toMatchObject({
      notebookId: 'notebook:bound',
      parts: [
        { type: 'text', text: '看看这张图' },
        {
          type: 'asset_ref',
          reference: {
            assetId: 'asset:one',
            versionId: 'version:one',
            kind: 'image',
          },
          usage: 'attachment',
        },
      ],
    });
  });

  it('allows an empty prompt when an attachment is attached (only asset_ref) (DP10)', async () => {
    let requestBody: unknown;
    const fetchImpl = (async (_input, init) => {
      requestBody = init?.body ? JSON.parse(String(init.body)) : null;
      return new Response(
        [
          event(0, { type: 'operation.accepted' }),
          event(1, { type: 'operation.completed', messageId: 'message:one' }),
        ]
          .map((value) => JSON.stringify(value))
          .join('\n'),
        { headers: { 'content-type': 'application/x-ndjson' } },
      );
    }) as typeof fetch;
    const proxy = createAssistantProxy({
      getSession: async () => session,
      invalidateSession: async () => undefined,
      fetchImpl,
    });
    await proxy.turn({
      text: '',
      attachment: {
        assetId: 'asset:one',
        versionId: 'version:one',
        kind: 'image',
        mimeType: 'image/png',
        displayName: '截图.png',
        notebookId: 'notebook:bound',
      },
    });
    expect(requestBody).toMatchObject({
      parts: [
        {
          type: 'asset_ref',
          reference: {
            assetId: 'asset:one',
            versionId: 'version:one',
            kind: 'image',
          },
          usage: 'attachment',
        },
      ],
    });
  });

  it('rejects an attachment bound to a different notebook before streaming (DP10)', async () => {
    const fetchImpl = vi.fn();
    const proxy = createAssistantProxy({
      getSession: async () => session,
      invalidateSession: async () => undefined,
      fetchImpl,
    });
    await expect(
      proxy.turn({
        text: '你好',
        attachment: {
          assetId: 'asset:one',
          versionId: 'version:one',
          kind: 'image',
          mimeType: 'image/png',
          displayName: '截图.png',
          notebookId: 'notebook:other',
        },
      }),
    ).resolves.toMatchObject({
      ok: false,
      code: 'route_required',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
