import {
  context,
  propagation,
  ROOT_CONTEXT,
  type Attributes,
} from '@opentelemetry/api';
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-node';
import { quickAddJob, runOnce, type TaskList } from 'graphile-worker';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

const connectionString = process.env.TEST_DATABASE_URL!;
const TRACE_TASK = 'research:trace';
const traceparentPattern = /^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/;
const allowedAttributeKeys = new Set([
  'educanvas.operation_id',
  'educanvas.stage',
]);

const TraceQueuePayloadSchema = z
  .object({
    operationId: z.uuid(),
    traceparent: z.string().max(55).regex(traceparentPattern),
  })
  .strict();

type TraceQueuePayload = z.infer<typeof TraceQueuePayloadSchema>;

/**
 * 研究夹具只允许把稳定业务键和 W3C 因果上下文送入遥测与队列。
 * 学生正文、Prompt、判分键、凭据、Token、Secret 和对象 key 均不属于该边界。
 */
const safeAttributes = (
  stage: 'client' | 'gateway' | 'model' | 'tool' | 'worker',
  operationId: string,
): Attributes => ({
  'educanvas.stage': stage,
  'educanvas.operation_id': operationId,
});

describe('真实 PostgreSQL 队列 Trace fixture', () => {
  const exporter = new InMemorySpanExporter();
  const provider = new NodeTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  const tracer = provider.getTracer('educanvas-research-queue-trace', '1.0.0');

  beforeAll(async () => {
    provider.register();
    await runOnce({ connectionString, taskList: { noop: async () => {} } });
  });

  afterAll(async () => {
    await provider.shutdown();
  });

  it('用 operationId + traceparent 串联五段因果链且敏感内容零外泄', async () => {
    const operationId = randomUUID();
    const sensitiveMarkers = [
      'student-body:小明的家庭住址',
      'system-prompt:never reveal',
      'grading-key:answer-is-42',
      'bearer-token:edu_secret_token',
      'provider-secret:sk-test-sensitive',
      'object-key:students/private/report.pdf',
    ];
    let queuedPayload: TraceQueuePayload | undefined;
    let consumedPayload: TraceQueuePayload | undefined;

    const tasks: TaskList = {
      [TRACE_TASK]: async (rawPayload) => {
        const payload = TraceQueuePayloadSchema.parse(rawPayload);
        consumedPayload = payload;
        const parentContext = propagation.extract(ROOT_CONTEXT, payload);
        await tracer.startActiveSpan(
          'worker.execute',
          { attributes: safeAttributes('worker', operationId) },
          parentContext,
          async (span) => {
            span.end();
          },
        );
      },
    };

    await tracer.startActiveSpan(
      'client.turn',
      { attributes: safeAttributes('client', operationId) },
      async (clientSpan) => {
        await tracer.startActiveSpan(
          'gateway.operation',
          { attributes: safeAttributes('gateway', operationId) },
          async (gatewaySpan) => {
            await tracer.startActiveSpan(
              'model.generate',
              { attributes: safeAttributes('model', operationId) },
              async (modelSpan) => {
                await tracer.startActiveSpan(
                  'tool.execute',
                  { attributes: safeAttributes('tool', operationId) },
                  async (toolSpan) => {
                    const carrier: Record<string, string> = {};
                    propagation.inject(context.active(), carrier);
                    queuedPayload = TraceQueuePayloadSchema.parse({
                      operationId,
                      traceparent: carrier.traceparent,
                    });
                    await quickAddJob(
                      { connectionString },
                      TRACE_TASK,
                      queuedPayload,
                    );
                    toolSpan.end();
                  },
                );
                modelSpan.end();
              },
            );
            gatewaySpan.end();
          },
        );
        clientSpan.end();
      },
    );

    await runOnce({ connectionString, taskList: tasks });
    await provider.forceFlush();

    expect(consumedPayload).toEqual(queuedPayload);
    expect(Object.keys(consumedPayload!)).toEqual([
      'operationId',
      'traceparent',
    ]);

    const spans = exporter.getFinishedSpans();
    const byName = new Map(spans.map((span) => [span.name, span]));
    const orderedNames = [
      'client.turn',
      'gateway.operation',
      'model.generate',
      'tool.execute',
      'worker.execute',
    ];
    expect([...byName.keys()].sort()).toEqual([...orderedNames].sort());

    const orderedSpans = orderedNames.map((name) => byName.get(name)!);
    const traceId = orderedSpans[0]!.spanContext().traceId;
    expect(new Set(orderedSpans.map((span) => span.spanContext().traceId))).toEqual(
      new Set([traceId]),
    );
    for (let index = 1; index < orderedSpans.length; index += 1) {
      expect(orderedSpans[index]!.parentSpanContext?.spanId).toBe(
        orderedSpans[index - 1]!.spanContext().spanId,
      );
    }

    for (const span of orderedSpans) {
      expect(new Set(Object.keys(span.attributes))).toEqual(allowedAttributeKeys);
      expect(span.attributes['educanvas.operation_id']).toBe(operationId);
      expect(span.events).toEqual([]);
    }

    const serializedBoundary = JSON.stringify({
      queue: consumedPayload,
      spans: spans.map((span) => ({
        name: span.name,
        attributes: span.attributes,
        events: span.events,
      })),
    });
    for (const marker of sensitiveMarkers) {
      expect(serializedBoundary).not.toContain(marker);
    }
    expect(serializedBoundary).not.toMatch(
      /student-body|system-prompt|grading-key|bearer-token|provider-secret|object-key/i,
    );
  });

  it('拒绝未知字段与非法 traceparent，避免队列成为正文旁路', () => {
    const operationId = randomUUID();
    expect(() =>
      TraceQueuePayloadSchema.parse({
        operationId,
        traceparent: 'not-a-w3c-context',
      }),
    ).toThrow();
    expect(() =>
      TraceQueuePayloadSchema.parse({
        operationId,
        traceparent: `00-${'a'.repeat(32)}-${'b'.repeat(16)}-01`,
        prompt: '不得进入队列的学生正文',
      }),
    ).toThrow();
  });
});
