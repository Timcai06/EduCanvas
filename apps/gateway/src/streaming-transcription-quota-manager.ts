/**
 * V13 进程内流式转录配额协调器 — 两类独立租约（REVISE 第二轮拆分）。
 *
 * ## 为什么拆成两类租约
 *
 * 一个连接上实际存在两种资源，生命周期不同：
 *
 * 1. **WebSocket 连接槽（socket lease）**：握手成功后占用，只在实际
 *    close/error/terminate 时释放——连接真实存在期间必须计入配额，否则
 *    客户端"终态后拖延 close handshake"可开出不计数连接；
 * 2. **Session/recognizer 槽（session lease）**：收到 start、创建
 *    recognizer 前占用，Session 终态形成时释放（不等连接关闭，也不等
 *    事件迭代器结束）——终态后即使客户端拖延关闭，底层 recognizer 内存
 *    也已释放。
 *
 * 两者独立计数、独立上限（连接上限 `maxConnectionsPerUser` /
 * `maxConnectionsPerNotebook` / `maxConnectionsGlobal`；recognizer 上限
 * `maxActiveSessionsGlobal`），各自幂等释放。
 *
 * ## 语义
 *
 * - `acquireSocket` 在握手成功后调用（ticket redeem + Notebook 访问 +
 *   resolver 可用之后、升级前）；任一维度超限返回 null，调用方拒绝连接；
 * - `acquireSession` 在创建 recognizer 之前调用（start 消息处理中）；全局
 *   超限返回 null，调用方不创建 recognizer 并稳定失败；
 * - ticket 签发不经过本协调器（ticket 只是握手凭证，`issue` 不占用
 *   槽位），因此"签发后从未握手"不会泄漏计数；
 * - `release` 幂等：每类租约最多释放一次（`released` 标志），重复调用
 *   无副作用；正常释放路径是主动的，**不依赖**定时轮询清扫；
 * - 一个连接的失败不影响其他连接（计数按维度独立维护，释放只减自身）。
 *
 * ## 原子性
 *
 * 本协调器是单进程内存状态，`acquire`/`release` 均为同步方法，在 Node
 * 事件循环的单个 tick 内完成，天然原子；未来若跨进程/多副本需要配额
 * 协调，应新增 ADR 并换用分布式计数器，而不是在本类里加锁。
 */

import type { StreamingTranscriptionQuotas } from './streaming-transcription-quotas';

/** 一条已占用的 WebSocket 连接槽租约。 */
export interface StreamingTranscriptionSocketLease {
  readonly userId: string;
  readonly notebookId: string;
  /** 是否已释放（幂等保护）。 */
  readonly released: boolean;
  /** 释放槽位；幂等，最多生效一次。 */
  release(): void;
}

/** 一条已占用的 Session/recognizer 槽租约。 */
export interface StreamingTranscriptionSessionLease {
  /** 是否已释放（幂等保护）。 */
  readonly released: boolean;
  /** 释放槽位；幂等，最多生效一次。 */
  release(): void;
}

/** 审计/测试用两类租约的维度占用快照。 */
export interface StreamingTranscriptionQuotaStats {
  /** 活跃 WebSocket 连接数。 */
  readonly socketGlobalActive: number;
  readonly socketUserActive: ReadonlyMap<string, number>;
  readonly socketNotebookActive: ReadonlyMap<string, number>;
  /** 活跃 Session/recognizer 数。 */
  readonly sessionGlobalActive: number;
}

export class StreamingTranscriptionQuotaManager {
  private readonly socketPerUser = new Map<string, number>();
  private readonly socketPerNotebook = new Map<string, number>();
  private socketGlobalActive = 0;
  private sessionGlobalActive = 0;

  constructor(private readonly quotas: StreamingTranscriptionQuotas) {}

  /**
   * 原子申请 WebSocket 连接槽。任一维度（用户 / 用户+Notebook / 全局
   * 连接数）达到上限返回 null；调用方应拒绝握手。槽位只在实际连接
   * close/error/terminate 时释放（连接存在期间始终计入配额）。
   */
  acquireSocket(input: {
    userId: string;
    notebookId: string;
  }): StreamingTranscriptionSocketLease | null {
    if (this.socketGlobalActive >= this.quotas.maxConnectionsGlobal) {
      return null;
    }
    const userActive = this.socketPerUser.get(input.userId) ?? 0;
    if (userActive >= this.quotas.maxConnectionsPerUser) return null;
    const notebookKey = notebookKeyOf(input.userId, input.notebookId);
    const notebookActive = this.socketPerNotebook.get(notebookKey) ?? 0;
    if (notebookActive >= this.quotas.maxConnectionsPerNotebook) return null;
    this.socketPerUser.set(input.userId, userActive + 1);
    this.socketPerNotebook.set(notebookKey, notebookActive + 1);
    this.socketGlobalActive += 1;
    let released = false;
    return {
      userId: input.userId,
      notebookId: input.notebookId,
      get released() {
        return released;
      },
      release: () => {
        if (released) return;
        released = true;
        this.releaseSocketCounts(input.userId, notebookKey);
      },
    };
  }

  /**
   * 原子申请 Session/recognizer 槽（全局并发上限）。在创建 recognizer
   * 之前调用；超限返回 null，调用方不创建 recognizer。槽位在 Session
   * 终态形成时释放（与连接关闭解耦）。
   */
  acquireSession(): StreamingTranscriptionSessionLease | null {
    if (this.sessionGlobalActive >= this.quotas.maxActiveSessionsGlobal) {
      return null;
    }
    this.sessionGlobalActive += 1;
    let released = false;
    return {
      get released() {
        return released;
      },
      release: () => {
        if (released) return;
        released = true;
        this.sessionGlobalActive -= 1;
      },
    };
  }

  /** 审计/测试：两类租约当前各维度活跃数（释放后立即归零）。 */
  stats(): StreamingTranscriptionQuotaStats {
    return {
      socketGlobalActive: this.socketGlobalActive,
      socketUserActive: new Map(this.socketPerUser),
      socketNotebookActive: new Map(this.socketPerNotebook),
      sessionGlobalActive: this.sessionGlobalActive,
    };
  }

  private releaseSocketCounts(userId: string, notebookKey: string): void {
    const userActive = (this.socketPerUser.get(userId) ?? 1) - 1;
    if (userActive <= 0) this.socketPerUser.delete(userId);
    else this.socketPerUser.set(userId, userActive);
    const notebookActive = (this.socketPerNotebook.get(notebookKey) ?? 1) - 1;
    if (notebookActive <= 0) this.socketPerNotebook.delete(notebookKey);
    else this.socketPerNotebook.set(notebookKey, notebookActive);
    this.socketGlobalActive -= 1;
  }
}

/** 用户+Notebook 组合键：分隔符选用 NUL 防用户名/Notebook id 拼接歧义。 */
function notebookKeyOf(userId: string, notebookId: string): string {
  return `${userId}\u0000${notebookId}`;
}
