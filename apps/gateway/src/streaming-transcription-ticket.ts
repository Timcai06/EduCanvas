/**
 * V12 WebSocket ticket — 短时、单次使用、绑定主体与 Notebook 的连接凭证。
 *
 * ## 为什么不用长时 session bearer 直连
 *
 * 浏览器 WebSocket API 无法设置自定义 header，唯一可行的握手携带通道是
 * `Sec-WebSocket-Protocol` 子协议；把最长 24 小时有效的 session bearer 放
 * 进该 header 会被服务端原样 echo，并可能进入代理、网关或诊断日志。因此
 * 握手凭证改为：先经 HTTPS 用 session bearer 换取 30–60 秒、单次使用、
 * 绑定 userId + notebookId 的随机 ticket，再用 ticket 建立连接。ticket 被
 * 泄露的暴露窗口短且不能重放、不能用于其他主体或 Notebook。
 *
 * ## 存储与生命周期
 *
 * 单实例内存 Map（Gateway 是单进程组合根）；`issue` 时顺带惰性清理过期
 * 项，避免表无限增长。`redeem` 幂等失败：过期或已消费都返回 null（不区分
 * 原因，避免泄露 ticket 状态）。ticket 随机值由调用方注入（默认
 * randomBytes），本模块不读取 Secret。
 */

import { randomBytes, randomUUID } from 'node:crypto';

/** ticket 默认有效期：60 秒（Codex 建议 30–60 秒）。 */
export const STREAMING_TICKET_TTL_MS = 60_000 as const;

/** 内部状态：ticket 到绑定信息的映射；consumed 标记单次使用。 */
interface TicketRecord {
  readonly userId: string;
  readonly notebookId: string;
  readonly expiresAt: number;
  consumed: boolean;
}

export interface StreamingTranscriptionTicketStoreOptions {
  /** ticket 有效期毫秒；默认 60 秒。 */
  ttlMs?: number;
  /** 时钟注入（测试用）。 */
  now?: () => number;
  /** 随机值生成（测试用）；默认 32 字节 base64url。 */
  createRandom?: () => string;
  /** 日志（脱敏）；缺省静默。 */
  log?: (entry: { label: string; code?: string }) => void;
}

export interface StreamingTranscriptionTicketGrant {
  /** 传输层凭证（不透明随机值）。 */
  readonly ticket: string;
  /** ISO 过期时间。 */
  readonly expiresAt: string;
}

/**
 * 单次使用 ticket 存储。`redeem` 消费后立即失效；过期与已消费统一返回
 * null，不向调用方暴露 ticket 的内部状态。
 */
export class StreamingTranscriptionTicketStore {
  private readonly tickets = new Map<string, TicketRecord>();
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly createRandom: () => string;
  private readonly log: (entry: { label: string; code?: string }) => void;

  constructor(options: StreamingTranscriptionTicketStoreOptions = {}) {
    this.ttlMs = options.ttlMs ?? STREAMING_TICKET_TTL_MS;
    this.now = options.now ?? Date.now;
    this.createRandom =
      options.createRandom ?? (() => randomBytes(32).toString('base64url'));
    this.log = options.log ?? (() => undefined);
    if (
      !Number.isFinite(this.ttlMs) ||
      this.ttlMs <= 0 ||
      this.ttlMs > 600_000
    ) {
      throw new TypeError('ticket TTL 必须在 (0, 600_000] 毫秒内');
    }
  }

  /** 签发绑定主体与 Notebook 的单次使用 ticket。 */
  issue(input: {
    userId: string;
    notebookId: string;
  }): StreamingTranscriptionTicketGrant {
    this.expireStale();
    const ticket = this.createRandom();
    const now = this.now();
    const expiresAt = now + this.ttlMs;
    this.tickets.set(ticket, {
      userId: input.userId,
      notebookId: input.notebookId,
      expiresAt,
      consumed: false,
    });
    return { ticket, expiresAt: new Date(expiresAt).toISOString() };
  }

  /**
   * 兑换 ticket：返回绑定的主体与 Notebook，并将该 ticket 标记为已消费
   * （单次使用）。过期、未知或已消费统一返回 null。
   */
  redeem(ticket: string): { userId: string; notebookId: string } | null {
    this.expireStale();
    const record = this.tickets.get(ticket);
    if (record === undefined) return null;
    // 单次使用：已消费（防御纵深；正常路径下 redeem 后记录即被删除）
    // 或过期都拒绝。delete 放在 guard 之后，让 consumed 分支真正可达。
    if (record.consumed || record.expiresAt <= this.now()) {
      this.tickets.delete(ticket);
      this.log({
        label: 'ticket_rejected',
        code: record.consumed ? 'consumed' : 'expired',
      });
      return null;
    }
    record.consumed = true;
    this.tickets.delete(ticket);
    return { userId: record.userId, notebookId: record.notebookId };
  }

  /** 惰性清理过期项；不清理已消费项之外的有效项。 */
  private expireStale(): void {
    const now = this.now();
    for (const [ticket, record] of this.tickets) {
      if (record.expiresAt <= now) this.tickets.delete(ticket);
    }
  }

  /** 仅测试用：当前持有（未消费且未过期）的 ticket 数量。 */
  size(): number {
    this.expireStale();
    let count = 0;
    for (const record of this.tickets.values()) {
      if (!record.consumed) count += 1;
    }
    return count;
  }

  /** 仅测试用：稳定 id，供审计日志区分（不输出 ticket 本身）。 */
  static logId(): string {
    return randomUUID();
  }
}
