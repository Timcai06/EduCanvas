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
 * Turn Application 纯辅助函数 — 无副作用，不触碰数据库或 Provider。
 *
 * ## 函数清单
 *
 * | 函数 | 用途 |
 * |------|------|
 * | `NOOP_TRACE` / `startTraceSafely` | Trace 遥测安全包装 — trace 端口故障不能影响业务终态 |
 * | `NOOP_CANCELLATION` | 取消端口默认实现 — 永远不取消 |
 * | `candidates` | 从 ContextPlan 展开所有候选 Segment |
 * | `modelMessages` | Segment → ModelMessage 映射 + 防漂移校验 |
 * | `validCitationMarkers` | 引用标记必须是正整数、升序、1-99 |
 * | `validPublicDelta` / `validGuardDeltas` | 公开文本长度校验（1-16000 字符） |
 * | `mapModelFailure` / `mapToolFailure` | 内部错误码 → 公开 TurnApplicationFailureCode |
 * | `executionId` | SHA256(operationId:round:callId) — 确定性幂等 ID 生成 |
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

/** 从 ContextPlan 展开所有候选 Segment（profile + conversation + sources + memory） */
export function candidates(plan: TurnApplicationContextPlan) {
  return [
    ...plan.profile,
    ...plan.conversation,
    ...plan.sourcesAndAssets,
    ...(plan.memory.status === 'available' ? plan.memory.candidates : []),
  ];
}

/**
 * Segment → ModelMessage 映射 + 防漂移校验。
 *
 * 每个入选的 Segment 必须在 candidates 中找到匹配的 candidate，
 * 且 candidate.message.content 的 trim 结果必须与 segment.content 一致。
 * 不一致 → Context Prompt Drift（候选在预算选择后被篡改）。
 *
 * synthesis 阶段可用独立的 synthesisMessage（更严格的系统指令），
 * 省略时复用 answer 的 message。
 */
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
