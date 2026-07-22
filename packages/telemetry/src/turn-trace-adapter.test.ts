import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
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
});
