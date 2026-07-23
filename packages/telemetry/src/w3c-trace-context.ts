import {
  ROOT_CONTEXT,
  trace,
  type Context,
  type Span,
} from '@opentelemetry/api';
import {
  w3cTraceCarrierSchema,
  type W3cTraceCarrier,
} from '@educanvas/agent-core';
import { W3CTraceContextPropagator } from '@opentelemetry/core';

const TRACEPARENT = 'traceparent';
function parseCarrier(value: unknown): W3cTraceCarrier | null {
  const parsed = w3cTraceCarrierSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** 只传播W3C traceparent；tracestate、baggage和任意业务字段均不进入载体。 */
export class W3cTraceContextAdapter {
  private readonly propagator = new W3CTraceContextPropagator();

  inject(span: Span): W3cTraceCarrier | null {
    const carrier: Record<string, string> = {};
    try {
      this.propagator.inject(trace.setSpan(ROOT_CONTEXT, span), carrier, {
        set(target, key, value) {
          if (key === TRACEPARENT) target[TRACEPARENT] = value;
        },
      });
    } catch {
      return null;
    }
    return parseCarrier({ traceparent: carrier[TRACEPARENT] });
  }

  extract(carrier: W3cTraceCarrier | null | undefined): Context {
    const validated = parseCarrier(carrier);
    if (!validated) return ROOT_CONTEXT;
    try {
      return this.propagator.extract(ROOT_CONTEXT, validated, {
        get(target, key) {
          return key === TRACEPARENT ? target.traceparent : undefined;
        },
        keys() {
          return [TRACEPARENT];
        },
      });
    } catch {
      return ROOT_CONTEXT;
    }
  }
}
