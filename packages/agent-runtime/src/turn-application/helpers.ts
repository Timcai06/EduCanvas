import { createHash } from 'node:crypto';
import type {
  ModelMessage,
  NormalizedModelError,
  TurnApplicationFailureCode,
} from '@educanvas/agent-core';
import { w3cTraceCarrierSchema } from '@educanvas/agent-core';
import type { ContextSegment } from '../context-engine';
import type {
  TurnApplicationCancellationPort,
  TurnApplicationContextCandidate,
  TurnApplicationContextPlan,
  TurnApplicationTracePort,
  TurnApplicationTraceSpan,
} from './ports';

/**
 * Turn Application 的纯辅助逻辑：Trace/Cancellation 默认实现、Context 候选展开、
 * Model Message 映射、citation/delta 校验、failure code 映射与 executionId 派生。
 * 全部为纯函数或无副作用默认值，不触碰数据库或 Provider。
 */

export const NOOP_TRACE: TurnApplicationTracePort = {
  start() {
    return { carrier: () => null, event() {}, end() {} };
  },
};

export function startTraceSafely(
  port: TurnApplicationTracePort,
  input: Parameters<TurnApplicationTracePort['start']>[0],
): TurnApplicationTraceSpan {
  let span: TurnApplicationTraceSpan;
  try {
    span = port.start(input);
  } catch {
    return NOOP_TRACE.start(input);
  }
  return {
    carrier() {
      try {
        const carrier = span.carrier();
        if (carrier === null) return null;
        const parsed = w3cTraceCarrierSchema.safeParse(carrier);
        return parsed.success ? parsed.data : null;
      } catch {
        return null;
      }
    },
    event(name, attributes) {
      try {
        span.event(name, attributes);
      } catch {
        // 遥测降级不能改变业务终态。
      }
    },
    end(status) {
      try {
        span.end(status);
      } catch {
        // 遥测降级不能改变业务终态。
      }
    },
  };
}

export const NOOP_CANCELLATION: TurnApplicationCancellationPort = {
  async open() {
    return {
      async isCancellationRequested() {
        return false;
      },
      close() {},
    };
  },
};

export function candidates(plan: TurnApplicationContextPlan) {
  return [
    ...plan.profile,
    ...plan.conversation,
    ...plan.sourcesAndAssets,
    ...(plan.memory.status === 'available' ? plan.memory.candidates : []),
  ];
}

export function modelMessages(
  selected: readonly ContextSegment[],
  all: readonly TurnApplicationContextCandidate[],
  phase: 'answer' | 'synthesis',
): readonly ModelMessage[] {
  const byId = new Map(
    all.map((candidate) => [candidate.segment.id, candidate]),
  );
  return selected.map((segment) => {
    const candidate = byId.get(segment.id);
    if (
      !candidate ||
      candidate.message.content.trim() !== segment.content.trim() ||
      (segment.kind === 'profile' && candidate.message.role !== 'system') ||
      (segment.kind !== 'profile' && candidate.message.role === 'system') ||
      (candidate.synthesisMessage !== undefined &&
        segment.kind !== 'profile') ||
      (candidate.synthesisMessage !== undefined &&
        candidate.synthesisMessage.role !== 'system')
    ) {
      throw new Error('context_prompt_drift');
    }
    return phase === 'synthesis'
      ? (candidate.synthesisMessage ?? candidate.message)
      : candidate.message;
  });
}

export function validCitationMarkers(markers: readonly number[]): boolean {
  return markers.every(
    (marker, index) =>
      Number.isInteger(marker) &&
      marker >= 1 &&
      marker <= 99 &&
      (index === 0 || marker > markers[index - 1]!),
  );
}

export function validPublicDelta(value: string): boolean {
  return value.length >= 1 && value.length <= 16_000;
}

export function validGuardDeltas(
  values: readonly string[],
  allowEmpty = false,
): boolean {
  return (allowEmpty || values.length > 0) && values.every(validPublicDelta);
}

export function mapModelFailure(error: NormalizedModelError): {
  code: TurnApplicationFailureCode;
  retryable: boolean;
} {
  return {
    code: error.code === 'rate_limit' ? 'RATE_LIMITED' : 'MODEL_FAILED',
    retryable: error.retryable,
  };
}

export function mapToolFailure(code: string): TurnApplicationFailureCode {
  if (code === 'approval_required') return 'APPROVAL_REQUIRED';
  if (code.startsWith('capability_denied:')) return 'FORBIDDEN';
  if (code === 'tool_not_available') return 'CAPABILITY_UNAVAILABLE';
  if (code === 'tool_cancelled') return 'CANCELLED';
  return 'TOOL_FAILED';
}

export function executionId(
  operationId: string,
  round: number,
  callId: string,
): string {
  return createHash('sha256')
    .update(`${operationId}:${round}:${callId}`, 'utf8')
    .digest('hex');
}
