import { SpanStatusCode, type Tracer } from '@opentelemetry/api';
import type { W3cTraceCarrier } from '@educanvas/agent-core';
import { W3cTraceContextAdapter } from './w3c-trace-context';

/** Worker Trace输入只包含低敏Operation关联键和可空的服务端W3C父上下文。 */
export interface ContinuationTraceInput {
  operationId: string;
  carrier: W3cTraceCarrier | null;
}

/** Worker恢复边界只接受稳定Operation键与W3C父上下文。 */
export interface ContinuationTracePort {
  run<T>(input: ContinuationTraceInput, callback: () => Promise<T>): Promise<T>;
}

type CallbackOutcome<T> =
  { status: 'completed'; value: T } | { status: 'failed'; error: unknown };

function unwrapOutcome<T>(outcome: CallbackOutcome<T>): T {
  if (outcome.status === 'completed') return outcome.value;
  throw outcome.error;
}

/** 创建active continuation子span；任何遥测故障都不能替换或重复业务回调。 */
export class OpenTelemetryContinuationTracePort implements ContinuationTracePort {
  constructor(
    private readonly tracer: Tracer,
    private readonly traceContext = new W3cTraceContextAdapter(),
  ) {}

  async run<T>(
    input: ContinuationTraceInput,
    callback: () => Promise<T>,
  ): Promise<T> {
    let callbackOutcome: Promise<CallbackOutcome<T>> | null = null;
    const invokeOnce = (): Promise<CallbackOutcome<T>> => {
      callbackOutcome ??= Promise.resolve()
        .then(callback)
        .then(
          (value): CallbackOutcome<T> => ({ status: 'completed', value }),
          (error: unknown): CallbackOutcome<T> => ({ status: 'failed', error }),
        );
      return callbackOutcome;
    };

    try {
      const parentContext = this.traceContext.extract(input.carrier);
      const outcome = await this.tracer.startActiveSpan(
        'educanvas.continuation',
        {
          attributes: {
            'educanvas.operation_id': input.operationId,
            'educanvas.stage': 'continuation',
          },
        },
        parentContext,
        async (span) => {
          try {
            const businessOutcome = await invokeOnce();
            if (businessOutcome.status === 'failed') {
              span.setStatus({ code: SpanStatusCode.ERROR });
            }
            return businessOutcome;
          } catch {
            // 遥测状态不是业务事实，SDK故障不得覆盖回调结果。
            return invokeOnce();
          } finally {
            try {
              span.end();
            } catch {
              // Exporter/SDK故障由健康状态承接，不能改变continuation结算。
            }
          }
        },
      );
      return unwrapOutcome(outcome);
    } catch {
      return unwrapOutcome(await invokeOnce());
    }
  }
}

/** 遥测关闭或降级时直接执行业务回调，不伪造任何Span。 */
export const NOOP_CONTINUATION_TRACE: ContinuationTracePort = {
  run(_input, callback) {
    return callback();
  },
};
