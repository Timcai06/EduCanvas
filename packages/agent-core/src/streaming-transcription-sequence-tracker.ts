/**
 * 流式转录跨消息序列的增量验证器（O(1)/条，V13）。
 *
 * ## 为什么存在
 *
 * `validateStreamingTranscriptionClientMessageSequence` /
 * `validateStreamingTranscriptionEventSequence` 是批量纯验证器：每次调用都
 * 从头扫描整个历史数组，单个长会话按"每收到一条消息/事件就重扫全历史"
 * 使用会退化为 O(n²)。本文件提供语义完全等价的增量版本：每次 `accept`
 * 只与当前常量级状态比较，不保存历史数组、不保存 PCM 或转录文本。
 *
 * ## 等价性契约
 *
 * 对任意消息/事件序列 `S`，`批量验证(S[0..k]) === true` 当且仅当
 * `tracker` 对 `S[0..k]` 的每一步 `accept` 都返回 true（前缀一致性）。
 * 该等价性由本模块的单元测试对穷举序列与手工违约用例断言（见
 * `streaming-transcription-sequence-tracker.test.ts`），语义与批量验证器
 * 单源一致，不复制第二套判定逻辑。
 *
 * ## 违约即锁存（sticky）
 *
 * `accept` 返回 false 后，tracker 进入永久拒绝状态（violated），此后任何
 * `accept` 一律返回 false。这是批量验证器的真实语义：批量验证器对"首条
 * 非法"的整个数组返回 false，不会因为后续出现合法消息而"重新开始"；
 * 增量版本必须同样锁存，否则一个以非法消息开头的序列可能被后续消息误
 * 当作新序列接受（穷举等价性测试曾捕获该漂移）。调用方违约后应立即
 * 终止会话（通道在协议违约时 close + 终态）。
 *
 * ## 纪律
 *
 * - 失败原因不对外暴露：违约的具体类型（重复 start、sequence 跳号、
 *   终态后消息等）由调用方以稳定错误面表达，本模块只回答 yes/no；
 * - 本模块是纯状态机，不产生 I/O、不持有全局可变状态。
 */

import {
  isStreamingTranscriptionTerminalEvent,
  type StreamingTranscriptionEvent,
} from './streaming-transcription-contracts';
import type { StreamingTranscriptionClientMessage } from './streaming-transcription-envelope';

/**
 * client 消息序列增量验证器，与
 * `validateStreamingTranscriptionClientMessageSequence` 等价：
 * 首条必须 start；operationId/segmentId 全程一致；sequence 从 0 严格
 * 连续递增；finish/cancel 是唯一终态动作且其后拒绝任何消息；chunk 的
 * chunkSequence 从 0 严格连续递增。
 */
export class StreamingTranscriptionClientMessageSequenceTracker {
  private count = 0;
  private operationId: string | null = null;
  private segmentId: string | null = null;
  private _terminalActionSeen = false;
  private expectedChunkSequence = 0;
  private violated = false;

  /** 接受下一条消息；返回 false 后本 tracker 永久拒绝（见文件头 sticky 说明）。 */
  accept(message: StreamingTranscriptionClientMessage): boolean {
    if (this.violated) return false;
    // 首条决定会话身份：start 是唯一允许的起始消息（与批量验证器一致）。
    if (this.operationId === null) {
      if (message.type !== 'start') return this.fail();
      this.operationId = message.operationId;
      this.segmentId = message.segmentId;
    }
    if (message.operationId !== this.operationId) return this.fail();
    if (message.segmentId !== this.segmentId) return this.fail();
    // sequence 必须与已接受消息数一致（从 0 连续递增）。
    if (message.sequence !== this.count) return this.fail();
    // 终态动作后不再接受任何消息（含重复 finish/cancel、finish 后 chunk）。
    if (this._terminalActionSeen) return this.fail();
    if (message.type === 'start' && this.count !== 0) return this.fail();
    if (message.type === 'chunk') {
      if (message.chunkSequence !== this.expectedChunkSequence) {
        return this.fail();
      }
      this.expectedChunkSequence += 1;
    }
    if (message.type === 'finish' || message.type === 'cancel') {
      this._terminalActionSeen = true;
    }
    this.count += 1;
    return true;
  }

  /** 已合法接受的消息数（= 下一条消息应满足的 sequence）。 */
  get acceptedCount(): number {
    return this.count;
  }

  /** 是否已出现 finish/cancel 终态动作。 */
  get terminalActionSeen(): boolean {
    return this._terminalActionSeen;
  }

  /** 是否已违约（锁存）。 */
  get isViolated(): boolean {
    return this.violated;
  }

  private fail(): false {
    this.violated = true;
    return false;
  }
}

/**
 * server 事件序列增量验证器，与
 * `validateStreamingTranscriptionEventSequence` 等价：
 * 同一 operationId/segmentId；sequence 从 0 严格连续递增；终态
 * （final/failed）至多一次且必须最后；endpoint 至多一次且其后不允许
 * partial。
 */
export class StreamingTranscriptionEventSequenceTracker {
  private count = 0;
  private operationId: string | null = null;
  private segmentId: string | null = null;
  private _terminalSeen = false;
  private endpointSeen = false;
  private violated = false;

  /** 接受下一条事件；返回 false 后本 tracker 永久拒绝（见文件头 sticky 说明）。 */
  accept(event: StreamingTranscriptionEvent): boolean {
    if (this.violated) return false;
    if (this.operationId === null) {
      this.operationId = event.operationId;
      this.segmentId = event.segmentId;
    }
    if (event.operationId !== this.operationId) return this.fail();
    if (event.segmentId !== this.segmentId) return this.fail();
    if (event.sequence !== this.count) return this.fail();
    if (this._terminalSeen) return this.fail();
    if (this.endpointSeen && event.type === 'partial') return this.fail();
    if (event.type === 'endpoint') {
      if (this.endpointSeen) return this.fail();
      this.endpointSeen = true;
    }
    this._terminalSeen = isStreamingTranscriptionTerminalEvent(event);
    this.count += 1;
    return true;
  }

  /** 已合法接受的事件数（= 下一条事件应满足的 sequence）。 */
  get acceptedCount(): number {
    return this.count;
  }

  /** 是否已出现终态事件（final/failed）。 */
  get terminalSeen(): boolean {
    return this._terminalSeen;
  }

  /** 是否已违约（锁存）。 */
  get isViolated(): boolean {
    return this.violated;
  }

  private fail(): false {
    this.violated = true;
    return false;
  }
}
