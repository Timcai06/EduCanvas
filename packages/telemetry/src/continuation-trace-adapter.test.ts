import { context, trace } from '@opentelemetry/api';
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-node';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenTelemetryContinuationTracePort } from './continuation-trace-adapter';
import { OpenTelemetryTurnTracePort } from './turn-trace-adapter';

describe('OpenTelemetryContinuationTracePort', () => {
  const providers: NodeTracerProvider[] = [];

  afterEach(async () => {
    await Promise.all(
      providers.splice(0).map((provider) => provider.shutdown()),
    );
  });

  it('只用traceparent恢复active子span并保持属性白名单', async () => {
    const exporter = new InMemorySpanExporter();
    const provider = new NodeTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    provider.register();
    providers.push(provider);
    const tracer = provider.getTracer('educanvas-continuation-test');
    const turn = new OpenTelemetryTurnTracePort(tracer).start({
      operationId: '00000000-0000-4000-8000-000000000001',
      traceId: 'must-not-export',
      actorId: 'must-not-export',
      agentId: 'must-not-export',
      notebookId: 'must-not-export',
      conversationId: 'must-not-export',
      profileId: 'must-not-export',
      entrypoint: 'web',
    });
    const carrier = turn.carrier();
    turn.end('suspended');
    const port = new OpenTelemetryContinuationTracePort(tracer);
    let activeSpanId: string | undefined;

    await port.run(
      {
        operationId: '00000000-0000-4000-8000-000000000001',
        carrier,
      },
      async () => {
        activeSpanId = trace.getSpan(context.active())?.spanContext().spanId;
      },
    );
    await provider.forceFlush();

    const spans = exporter.getFinishedSpans();
    const parent = spans.find((span) => span.name === 'educanvas.turn');
    const child = spans.find((span) => span.name === 'educanvas.continuation');
    expect(child?.spanContext().spanId).toBe(activeSpanId);
    expect(child?.parentSpanContext?.spanId).toBe(parent?.spanContext().spanId);
    expect(child?.spanContext().traceId).toBe(parent?.spanContext().traceId);
    expect(child?.attributes).toEqual({
      'educanvas.operation_id': '00000000-0000-4000-8000-000000000001',
      'educanvas.stage': 'continuation',
    });
    expect(child?.events).toEqual([]);
    expect(
      JSON.stringify({
        name: child?.name,
        attributes: child?.attributes,
        events: child?.events,
      }),
    ).not.toContain('must-not-export');
  });

  it('带额外字段的carrier从ROOT开新span且callback失败保持原错误', async () => {
    const exporter = new InMemorySpanExporter();
    const provider = new NodeTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    provider.register();
    providers.push(provider);
    const port = new OpenTelemetryContinuationTracePort(
      provider.getTracer('educanvas-invalid-carrier-test'),
    );
    const failure = new Error('business_failure');
    const callback = vi.fn(async () => {
      throw failure;
    });

    await expect(
      port.run(
        {
          operationId: '00000000-0000-4000-8000-000000000001',
          carrier: {
            traceparent:
              '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
            baggage: 'student=private',
          } as never,
        },
        callback,
      ),
    ).rejects.toBe(failure);
    expect(callback).toHaveBeenCalledTimes(1);
    await provider.forceFlush();
    const [span] = exporter.getFinishedSpans();
    expect(span?.parentSpanContext).toBeUndefined();
    expect(span?.status.code).not.toBe(0);
  });

  it('tracer在启动callback后异常也不会重复或改变业务结果', async () => {
    let releaseCallback!: () => void;
    const callbackGate = new Promise<void>((resolve) => {
      releaseCallback = resolve;
    });
    const callback = vi.fn(async () => {
      await callbackGate;
      return 'business_result';
    });
    const tracer = {
      startActiveSpan(
        _name: string,
        _options: unknown,
        _parent: unknown,
        run: (span: { setStatus(): void; end(): void }) => Promise<unknown>,
      ) {
        void run({ setStatus() {}, end() {} });
        throw new Error('trace_sdk_failure');
      },
    };
    const port = new OpenTelemetryContinuationTracePort(tracer as never);

    const result = port.run(
      {
        operationId: '00000000-0000-4000-8000-000000000001',
        carrier: null,
      },
      callback,
    );
    await vi.waitFor(() => expect(callback).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(callback).toHaveBeenCalledTimes(1);
    releaseCallback();
    await expect(result).resolves.toBe('business_result');
    expect(callback).toHaveBeenCalledTimes(1);
  });
});
