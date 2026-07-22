import { SpanStatusCode, type Tracer } from '@opentelemetry/api';
import type {
  TurnApplicationTracePort,
  TurnApplicationTraceSpan,
} from '@educanvas/agent-runtime';

const allowedEvents = new Set([
  'context.prepare',
  'approval.required',
  'lifecycle.event.invalid',
]);

const safeEventAttributes = (
  name: string,
  attributes: Readonly<Record<string, string>> | undefined,
): Record<string, string> => {
  if (name !== 'approval.required' || attributes === undefined) return {};
  const risk = attributes.risk;
  return risk !== undefined && /^L[0-3]$/.test(risk)
    ? { 'educanvas.risk': risk }
    : {};
};

/** OTel Turn Adapter只记录白名单标识；Actor、Notebook、正文和参数全部丢弃。 */
export class OpenTelemetryTurnTracePort implements TurnApplicationTracePort {
  constructor(private readonly tracer: Tracer) {}

  start(
    input: Parameters<TurnApplicationTracePort['start']>[0],
  ): TurnApplicationTraceSpan {
    const span = this.tracer.startSpan('educanvas.turn', {
      attributes: {
        'educanvas.operation_id': input.operationId,
        'educanvas.stage': 'turn',
        'educanvas.entrypoint': input.entrypoint,
      },
    });
    let ended = false;
    return {
      event(name, attributes) {
        if (ended || !allowedEvents.has(name)) return;
        span.addEvent(name, safeEventAttributes(name, attributes));
      },
      end(status) {
        if (ended) return;
        ended = true;
        if (status === 'failed') {
          span.setStatus({ code: SpanStatusCode.ERROR });
        }
        span.end();
      },
    };
  }
}
