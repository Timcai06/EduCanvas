import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
  TraceIdRatioBasedSampler,
} from '@opentelemetry/sdk-trace-node';
import { afterEach, describe, expect, it } from 'vitest';
import { OpenTelemetryTurnTracePort } from './turn-trace-adapter';

describe('OpenTelemetryTurnTracePort', () => {
  const providers: NodeTracerProvider[] = [];

  afterEach(async () => {
    await Promise.all(
      providers.splice(0).map((provider) => provider.shutdown()),
    );
  });

  it('只导出低基数白名单且丢弃身份、正文与Secret', async () => {
    const exporter = new InMemorySpanExporter();
    const provider = new NodeTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    providers.push(provider);
    const port = new OpenTelemetryTurnTracePort(
      provider.getTracer('educanvas-telemetry-test'),
    );
    const sensitive = 'student-body-or-secret-never-export';
    const span = port.start({
      operationId: '00000000-0000-4000-8000-000000000001',
      traceId: sensitive,
      actorId: sensitive,
      agentId: sensitive,
      notebookId: sensitive,
      conversationId: sensitive,
      profileId: sensitive,
      entrypoint: 'web',
    });
    expect(span.carrier()).toEqual({
      traceparent: expect.stringMatching(
        /^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/,
      ),
    });
    expect(Object.keys(span.carrier() ?? {})).toEqual(['traceparent']);
    span.event('context.prepare', { prompt: sensitive });
    span.event('approval.required', {
      capability: sensitive,
      risk: 'L2',
    });
    span.event(sensitive, { secret: sensitive });
    span.end('completed');
    span.end('failed');
    await provider.forceFlush();

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0]?.attributes).toEqual({
      'educanvas.operation_id': '00000000-0000-4000-8000-000000000001',
      'educanvas.stage': 'turn',
      'educanvas.entrypoint': 'web',
    });
    expect(spans[0]?.events).toEqual([
      expect.objectContaining({ name: 'context.prepare', attributes: {} }),
      expect.objectContaining({
        name: 'approval.required',
        attributes: { 'educanvas.risk': 'L2' },
      }),
    ]);
    expect(
      JSON.stringify(
        spans.map((finished) => ({
          name: finished.name,
          attributes: finished.attributes,
          events: finished.events,
        })),
      ),
    ).not.toContain(sensitive);
  });

  it('未采样Turn仍生成flags 00的合法carrier', async () => {
    const exporter = new InMemorySpanExporter();
    const provider = new NodeTracerProvider({
      sampler: new TraceIdRatioBasedSampler(0),
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    providers.push(provider);
    const span = new OpenTelemetryTurnTracePort(
      provider.getTracer('educanvas-unsampled-carrier-test'),
    ).start({
      operationId: '00000000-0000-4000-8000-000000000001',
      traceId: 'business-trace-id',
      actorId: 'actor:test',
      agentId: 'agent:test',
      notebookId: 'notebook:test',
      conversationId: 'conversation:test',
      profileId: 'profile:test',
      entrypoint: 'tui',
    });

    expect(span.carrier()?.traceparent).toMatch(
      /^00-[0-9a-f]{32}-[0-9a-f]{16}-00$/,
    );
    span.end('suspended');
    await provider.forceFlush();
    expect(exporter.getFinishedSpans()).toEqual([]);
  });
});
