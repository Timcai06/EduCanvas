'use client';

import {
  notebookScopedFetch,
  type NotebookRequestContext,
} from '@/features/workspace/general/notebook-request-context';
import { useNotebookRequestScope } from '@/features/workspace/general/notebook-request-scope';

import {
  createWebRuntimeSession,
  reduceWebRuntimeMessage,
  sandboxToHostMessageSchema,
  webRuntimeBindingSchema,
  webRuntimeFailureCodeSchema,
  type HostToSandboxMessage,
  type WebRuntimeFailureCode,
  type WebRuntimeSessionState,
} from '@educanvas/canvas-protocol';
import { ArrowClockwise, Stop } from '@phosphor-icons/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import {
  writeCancellation,
  persistObservedTerminal,
  cancelRequest,
  type ObservedTerminal,
} from './persistent-web-runtime-client';
import {
  resolveCancelFailure,
  shouldIgnoreRuntimeEvent,
  type PersistentRuntimeState,
} from './persistent-web-runtime-model';

const runResponseSchema = z
  .object({
    runId: z.string().uuid(),
    bootstrapToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    runtimeOrigin: z.string().url(),
    binding: webRuntimeBindingSchema.omit({ channelId: true }),
  })
  .strict();
const bridgeFailureSchema = z
  .object({
    type: z.literal('educanvas.runtime.bridge_failed'),
    failureCode: webRuntimeFailureCodeSchema,
  })
  .strict();

interface ActiveRun {
  context: NotebookRequestContext | null;
  runId: string;
  bootstrapToken: string;
  runtimeOrigin: string;
  startMessage: HostToSandboxMessage;
  session: WebRuntimeSessionState;
}

function postDestroy(frame: HTMLIFrameElement | null, run: ActiveRun | null) {
  frame?.contentWindow?.postMessage(
    { type: 'educanvas.runtime.destroy' },
    run?.runtimeOrigin ?? '*',
  );
}

export function PersistentWebRuntime({
  artifactId,
  artifactVersionId,
}: {
  artifactId: string;
  artifactVersionId: string;
}) {
  const requestContext = useNotebookRequestScope();
  const [state, setState] = useState<PersistentRuntimeState>('starting');
  const [iframeUrl, setIframeUrl] = useState<string | null>(null);
  const [instance, setInstance] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const active = useRef<ActiveRun | null>(null);

  const detachFrame = useCallback(() => {
    const frame = iframeRef.current;
    postDestroy(frame, active.current);
    setIframeUrl(null);
  }, []);

  const destroy = useCallback(() => {
    detachFrame();
    active.current = null;
  }, [detachFrame]);

  const settleObservedTerminal = useCallback(
    async (run: ActiveRun, terminal: ObservedTerminal) => {
      detachFrame();
      try {
        const result = await persistObservedTerminal(
          run.runId,
          terminal,
          run.context,
        );
        if (active.current === run) setState(result.status);
      } catch {
        /*
         * A client observation is not authoritative until the same-origin API
         * accepts it. Never present an uncommitted success or cancellation.
         */
        if (active.current === run) setState('failed');
      } finally {
        if (active.current === run) active.current = null;
      }
    },
    [detachFrame],
  );

  const failRunning = useCallback(
    (failureCode: WebRuntimeFailureCode) => {
      const run = active.current;
      if (!run) return;
      setState('failed');
      void settleObservedTerminal(run, { status: 'failed', failureCode });
    },
    [settleObservedTerminal],
  );

  useEffect(() => {
    let disposed = false;
    const requestId = crypto.randomUUID();
    const context = requestContext;
    queueMicrotask(() => {
      if (!disposed) setState('starting');
    });
    void notebookScopedFetch(
      '/api/v1/canvas/runtime/runs',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ requestId, artifactId, artifactVersionId }),
      },
      context,
    )
      .then(async (response) => {
        if (!response.ok) {
          if (!disposed) {
            setState(response.status === 503 ? 'unavailable' : 'failed');
          }
          if (disposed) {
            void cancelRequest(requestId, context).catch(() => undefined);
          }
          return null;
        }
        return runResponseSchema.parse(await response.json());
      })
      .then((run) => {
        if (!run) return;
        if (disposed) {
          void writeCancellation(run.runId, context).catch(() => undefined);
          return;
        }
        const binding = {
          ...run.binding,
          channelId: crypto.randomUUID(),
        };
        const startMessage: HostToSandboxMessage = {
          ...binding,
          type: 'start',
          sequence: 0,
          payload: {},
        };
        const started = reduceWebRuntimeMessage(
          createWebRuntimeSession(binding),
          'host_to_sandbox',
          startMessage,
        );
        if (!started.ok) throw new Error('runtime_rejected');
        active.current = {
          ...run,
          context,
          startMessage,
          session: started.state,
        };
        setIframeUrl(`${run.runtimeOrigin}/host`);
      })
      .catch((error: unknown) => {
        if (!disposed) {
          setState(error instanceof TypeError ? 'offline' : 'failed');
          return;
        }
        void cancelRequest(requestId, context).catch(() => undefined);
      });
    return () => {
      disposed = true;
      void cancelRequest(requestId, context).catch(() => undefined);
      destroy();
    };
  }, [artifactId, artifactVersionId, destroy, instance, requestContext]);

  useEffect(() => {
    const listener = (event: MessageEvent<unknown>) => {
      const run = active.current;
      if (
        !run ||
        event.source !== iframeRef.current?.contentWindow ||
        event.origin !== run.runtimeOrigin ||
        !event.data ||
        typeof event.data !== 'object'
      ) {
        return;
      }
      const envelope = event.data as Record<string, unknown>;
      if (shouldIgnoreRuntimeEvent(run.session)) return;
      if (envelope.type === 'educanvas.runtime.bridge_failed') {
        const failure = bridgeFailureSchema.safeParse(envelope);
        failRunning(
          failure.success ? failure.data.failureCode : 'runtime_crashed',
        );
        return;
      }
      if (
        envelope.type === 'educanvas.runtime.host_ready' &&
        envelope.runtimeId === run.startMessage.runtimeId
      ) {
        iframeRef.current?.contentWindow?.postMessage(
          {
            type: 'educanvas.runtime.activate',
            channelId: run.startMessage.channelId,
          },
          run.runtimeOrigin,
        );
        return;
      }
      if (envelope.type !== 'educanvas.runtime.event') return;
      const parsed = sandboxToHostMessageSchema.safeParse(envelope.message);
      if (!parsed.success) {
        failRunning('runtime_crashed');
        return;
      }
      const next = reduceWebRuntimeMessage(
        run.session,
        'sandbox_to_host',
        parsed.data,
      );
      if (!next.ok) {
        failRunning('runtime_crashed');
        return;
      }
      run.session = next.state;
      if (parsed.data.type === 'ready') setState('running');
      if (parsed.data.type === 'succeeded') {
        void settleObservedTerminal(run, { status: 'succeeded' });
      }
      if (parsed.data.type === 'failed') {
        void settleObservedTerminal(run, {
          status: 'failed',
          failureCode: parsed.data.payload.failureCode,
        });
      }
      if (parsed.data.type === 'cancelled') {
        void settleObservedTerminal(run, { status: 'cancelled' });
      }
    };
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, [failRunning, settleObservedTerminal]);

  useEffect(() => {
    if (!iframeUrl || !active.current) return;
    const timeout = window.setTimeout(
      () => failRunning('runtime_timeout'),
      30_000,
    );
    return () => window.clearTimeout(timeout);
  }, [failRunning, iframeUrl]);

  const cancel = useCallback(async () => {
    const run = active.current;
    if (!run) return;
    const message: HostToSandboxMessage = {
      ...run.startMessage,
      type: 'cancel',
      sequence: run.session.nextSequence,
      payload: {},
    };
    const next = reduceWebRuntimeMessage(
      run.session,
      'host_to_sandbox',
      message,
    );
    if (next.ok) {
      run.session = next.state;
      iframeRef.current?.contentWindow?.postMessage(
        { type: 'educanvas.runtime.cancel', message },
        run.runtimeOrigin,
      );
    }
    try {
      detachFrame();
      const result = await writeCancellation(run.runId, run.context);
      setState(result.status);
    } catch {
      setState(resolveCancelFailure);
    } finally {
      if (active.current === run) active.current = null;
    }
  }, [detachFrame]);

  return (
    <section
      className="flex min-h-72 flex-col gap-3 motion-reduce:scroll-auto"
      data-testid="persistent-web-runtime"
      data-runtime-state={state}
      data-runtime-instance={instance}
    >
      <div className="flex items-center justify-between gap-3 text-sm">
        <span aria-live="polite" data-testid="runtime-status-message">
          {state === 'starting'
            ? '正在启动隔离运行环境…'
            : state === 'running'
              ? '运行状态：运行中'
              : state === 'offline'
                ? '无法连接隔离运行环境，请检查网络或本地服务后重试。'
                : state === 'unavailable'
                  ? '隔离运行环境暂不可用，请确认服务已启动后重试。'
                  : state === 'failed'
                    ? '运行未能完成，可重新加载后重试。'
                    : `运行状态：${state}`}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              void cancel().finally(() => setInstance((value) => value + 1));
            }}
            className="ec-button-secondary min-h-9 px-3 motion-reduce:transition-none"
          >
            <ArrowClockwise aria-hidden />
            {state === 'offline' ||
            state === 'unavailable' ||
            state === 'failed'
              ? '重试运行'
              : '重新加载'}
          </button>
          <button
            type="button"
            onClick={() => void cancel()}
            disabled={iframeUrl === null}
            className="ec-button-secondary min-h-9 px-3"
          >
            <Stop aria-hidden />
            取消
          </button>
        </div>
      </div>
      {iframeUrl ? (
        <iframe
          ref={iframeRef}
          src={iframeUrl}
          title="持久 Web Runtime"
          referrerPolicy="no-referrer"
          allow=""
          className="min-h-64 w-full flex-1 rounded-xl border border-line bg-white"
          data-testid="runtime-host-frame"
          onLoad={() => {
            const run = active.current;
            if (!run) return;
            iframeRef.current?.contentWindow?.postMessage(
              {
                type: 'educanvas.runtime.bootstrap',
                runId: run.runId,
                bootstrapToken: run.bootstrapToken,
                startMessage: run.startMessage,
              },
              run.runtimeOrigin,
            );
          }}
        />
      ) : null}
    </section>
  );
}
