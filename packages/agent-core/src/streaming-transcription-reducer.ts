/**
 * 流式转录增量归并 reducer（V05）— 供应商无关的纯归并层（ADR-0018）。
 *
 * 与 V04 契约的分工：
 * - `streaming-transcription-contracts.ts` 定义单事件 Schema 与单 segment
 *   序列验证器（`validateStreamingTranscriptionEventSequence`）；
 * - 本模块把事件逐个归并进**不可变快照**，跨 segment 隔离并生成组合文本。
 *
 * ## 不变量
 *
 * - 纯函数：无 I/O、无计时器、无全局可变状态、无供应商/SDK 类型；
 * - 输入（snapshot 与 event）绝不被修改，每次归并返回新快照；
 * - sequence 按 segment 独立、从 0 严格递增（与 V04 单 segment 语义一致，
 *   多 segment 时各自计数即"严格隔离"）；重复事件（同 segment 同 sequence
 *   同 type 同 payload）幂等，返回原快照；
 * - 终态按 segment 生效：final（成功）与 failed（失败）之后该 segment
 *   拒绝新事件；其他 segment 不受影响（隔离原则的推论）；
 * - failed 从不投影为成功文本：failed segment 在组合文本中跳过；
 * - 快照只承载领域事实，不包含 PCM、Provider、Prompt、Secret 或 stack。
 *
 * ## 拒绝错误码（复用 V04 稳定错误面）
 *
 * `applyStreamingTranscriptionEvent` 拒绝非法输入时抛 V04 的
 * `StreamingTranscriptionStateError`，code 取自 V04 failureCodes：
 *
 * | 违规                                   | code                 |
 * | -------------------------------------- | -------------------- |
 * | 事件 operationId ≠ 快照 operationId    | `UNKNOWN`            |
 * | sequence 跳号 / 倒序 / 非幂等重复      | `UNKNOWN`            |
 * | endpoint 后 partial / 重复 endpoint    | `INPUT_AFTER_ENDPOINT` |
 * | final 或 failed 后新事件（幂等除外）   | `INPUT_AFTER_TERMINAL` |
 *
 * `UNKNOWN` 用于 V04 没有专门码的结构违规（会话归属、序列结构），是稳定
 * 兜底而非"未知模型失败"；调用方按 code 精确断言。
 *
 * 优先级：结构违规（跨 operation、sequence 跳号/倒序/非幂等）先于语义
 * 违规判定，例如 endpoint 后同时跳号的 partial 报 `UNKNOWN` 而不是
 * `INPUT_AFTER_ENDPOINT`。
 */

import type {
  StreamingTranscriptionEvent,
  StreamingTranscriptionFailureCode,
} from './streaming-transcription-contracts';
import { StreamingTranscriptionStateError } from './streaming-transcription-contracts';

/** 事件类型别名，用于幂等判定（同一事件重放必须类型、sequence、payload 全部一致）。 */
export type StreamingTranscriptionEventType =
  'partial' | 'endpoint' | 'final' | 'failed';

/** 单个 segment 的归并状态；按 segment 独立终态，不与其他 segment 互相影响。 */
export interface StreamingTranscriptionSegmentState {
  readonly segmentId: string;
  /**
   * active：文本是最新 partial 假设，可被后续 partial/final 替换；
   * final：不可回退的终稿；failed：失败终态，text 恒为空串（不投影）。
   */
  readonly status: 'active' | 'final' | 'failed';
  /** 当前投影文本：active=最新 partial，final=终稿，failed=''。 */
  readonly text: string;
  /** 失败终态的稳定码；非 failed 时为 null。 */
  readonly failureCode: StreamingTranscriptionFailureCode | null;
  /** 该 segment 已接受的最大 sequence；未收任何事件时为 -1。 */
  readonly sequence: number;
  /** 是否已出现 endpoint；endpoint 之后拒绝新的 partial。 */
  readonly endpointSeen: boolean;
  /** 已接受的最大 sequence 对应的事件类型；幂等判定必须与类型一致。 */
  readonly lastEventType: StreamingTranscriptionEventType;
}

/**
 * 一个 operation 的不可变归并快照。segments 按首次出现顺序排列；
 * combinedText 按同一顺序拼接各 segment 投影文本（failed 跳过），
 * 是当前可见文本的确定性结果。
 */
export interface StreamingTranscriptionSnapshot {
  readonly operationId: string;
  readonly segments: readonly StreamingTranscriptionSegmentState[];
  readonly combinedText: string;
}

/** 创建空快照。operationId 随后所有事件的归属边界：不匹配即拒绝。 */
export function createStreamingTranscriptionSnapshot(
  operationId: string,
): StreamingTranscriptionSnapshot {
  return { operationId, segments: [], combinedText: '' };
}

function combineText(
  segments: readonly StreamingTranscriptionSegmentState[],
): string {
  // segment 是独立识别单元，组合时必须保留词边界。直接字符串相加会让
  // `Bagging` + `and boosting` 变成 `Baggingand boosting`，破坏双语输入。
  // 空文本（例如只有 endpoint 的 segment）不产生多余分隔符。
  return segments
    .filter((segment) => segment.status !== 'failed' && segment.text.length > 0)
    .map((segment) => segment.text)
    .join(' ');
}

/** 幂等判定：同 segment 同 sequence 同 type 同 payload 视为同一事件重放。 */
function isIdempotentReplay(
  segment: StreamingTranscriptionSegmentState,
  event: StreamingTranscriptionEvent,
): boolean {
  if (segment.sequence !== event.sequence) return false;
  // 同 sequence 不同类型不是重复（如 partial 后同号 final），必须拒绝而非幂等。
  if (segment.lastEventType !== event.type) return false;
  switch (event.type) {
    case 'partial':
    case 'final':
      return segment.text === event.text;
    case 'endpoint':
      return segment.endpointSeen;
    case 'failed':
      return (
        segment.status === 'failed' && segment.failureCode === event.failureCode
      );
  }
}

/**
 * 归并单个事件到快照，返回新快照；非法输入抛
 * `StreamingTranscriptionStateError`（稳定 code，见文件头映射表）。
 * 幂等重放返回原快照引用（深度相等，且不产生新对象）。
 */
export function applyStreamingTranscriptionEvent(
  snapshot: StreamingTranscriptionSnapshot,
  event: StreamingTranscriptionEvent,
): StreamingTranscriptionSnapshot {
  if (event.operationId !== snapshot.operationId) {
    throw new StreamingTranscriptionStateError('UNKNOWN');
  }

  const segmentIndex = snapshot.segments.findIndex(
    (segment) => segment.segmentId === event.segmentId,
  );

  // 新 segment 首次出现：按事件类型直接创建（endpoint/final/failed 均可
  // 作为首事件，与 V04 验证器允许 [endpoint(0)]/[failed(0)] 一致）。
  if (segmentIndex === -1) {
    if (event.sequence !== 0) {
      throw new StreamingTranscriptionStateError('UNKNOWN');
    }
    const segments = [...snapshot.segments];
    segments.push(createSegment(event));
    return {
      operationId: snapshot.operationId,
      segments,
      combinedText: combineText(segments),
    };
  }

  const segment = snapshot.segments[
    segmentIndex
  ] as StreamingTranscriptionSegmentState;

  // 终态之后：只接受幂等重放，其余一律拒绝。
  if (segment.status === 'final' || segment.status === 'failed') {
    if (isIdempotentReplay(segment, event)) return snapshot;
    throw new StreamingTranscriptionStateError('INPUT_AFTER_TERMINAL');
  }

  // active：先检查 sequence 顺序，再按事件类型推进。
  if (event.sequence === segment.sequence) {
    if (isIdempotentReplay(segment, event)) return snapshot;
    throw new StreamingTranscriptionStateError('UNKNOWN');
  }
  if (event.sequence < segment.sequence) {
    throw new StreamingTranscriptionStateError('UNKNOWN');
  }
  if (event.sequence > segment.sequence + 1) {
    throw new StreamingTranscriptionStateError('UNKNOWN');
  }

  if (event.type === 'partial' && segment.endpointSeen) {
    throw new StreamingTranscriptionStateError('INPUT_AFTER_ENDPOINT');
  }
  if (event.type === 'endpoint' && segment.endpointSeen) {
    throw new StreamingTranscriptionStateError('INPUT_AFTER_ENDPOINT');
  }

  const next: StreamingTranscriptionSegmentState = {
    segmentId: segment.segmentId,
    status:
      event.type === 'final'
        ? 'final'
        : event.type === 'failed'
          ? 'failed'
          : 'active',
    text:
      event.type === 'endpoint'
        ? segment.text
        : event.type === 'failed'
          ? ''
          : event.text,
    failureCode:
      event.type === 'failed' ? event.failureCode : segment.failureCode,
    sequence: event.sequence,
    endpointSeen: segment.endpointSeen || event.type === 'endpoint',
    lastEventType: event.type,
  };

  const segments = [...snapshot.segments];
  segments[segmentIndex] = next;
  return {
    operationId: snapshot.operationId,
    segments,
    combinedText: combineText(segments),
  };
}

/** 由首事件创建新 segment 状态（首事件 sequence 必须为 0，已由调用方校验）。 */
function createSegment(
  event: StreamingTranscriptionEvent,
): StreamingTranscriptionSegmentState {
  return {
    segmentId: event.segmentId,
    status:
      event.type === 'final'
        ? 'final'
        : event.type === 'failed'
          ? 'failed'
          : 'active',
    text:
      event.type === 'endpoint'
        ? ''
        : event.type === 'failed'
          ? ''
          : event.text,
    failureCode: event.type === 'failed' ? event.failureCode : null,
    sequence: event.sequence,
    endpointSeen: event.type === 'endpoint',
    lastEventType: event.type,
  };
}
