/**
 * V13 配额协调器单元测试 — 双租约（socket / session）的原子申请/拒绝/释放、
 * 幂等、维度隔离与生命周期解耦。全部使用真实同步调用 + 注入的小配额，
 * 不依赖 sleep。
 */

import { describe, expect, it } from 'vitest';
import { StreamingTranscriptionQuotaManager } from './streaming-transcription-quota-manager';
import type { StreamingTranscriptionQuotas } from './streaming-transcription-quotas';

function quotas(
  overrides: Partial<StreamingTranscriptionQuotas> = {},
): StreamingTranscriptionQuotas {
  return {
    maxConnectionsPerUser: 2,
    maxConnectionsPerNotebook: 2,
    maxConnectionsGlobal: 4,
    maxActiveSessionsGlobal: 3,
    maxSessionDurationMs: 600_000,
    maxSessionIdleMs: 60_000,
    maxPcmBytesPerConnection: 1_920_000,
    maxChunksPerConnection: 4_096,
    maxQueuedInputMessages: 64,
    maxOutputBufferedBytes: 256 * 1024,
    ...overrides,
  };
}

describe('StreamingTranscriptionQuotaManager（V13 双租约）', () => {
  it('上限前 acquireSocket 正常，三个维度同时占用', () => {
    const manager = new StreamingTranscriptionQuotaManager(quotas());
    const lease = manager.acquireSocket({
      userId: 'user:A',
      notebookId: 'notebook:A',
    });
    expect(lease).not.toBeNull();
    const stats = manager.stats();
    expect(stats.socketGlobalActive).toBe(1);
    expect(stats.socketUserActive.get('user:A')).toBe(1);
    expect(stats.socketNotebookActive.get('user:A\u0000notebook:A')).toBe(1);
    lease!.release();
  });

  it('达到单用户连接上限时拒绝，且不影响其他用户', () => {
    const manager = new StreamingTranscriptionQuotaManager(quotas());
    expect(
      manager.acquireSocket({ userId: 'user:A', notebookId: 'notebook:A' }),
    ).not.toBeNull();
    expect(
      manager.acquireSocket({ userId: 'user:A', notebookId: 'notebook:B' }),
    ).not.toBeNull();
    // user:A 已达 2 条上限：第三个连接拒绝。
    expect(
      manager.acquireSocket({ userId: 'user:A', notebookId: 'notebook:C' }),
    ).toBeNull();
    // 其他用户不受影响。
    expect(
      manager.acquireSocket({ userId: 'user:B', notebookId: 'notebook:A' }),
    ).not.toBeNull();
  });

  it('达到用户+Notebook 组合上限时拒绝', () => {
    const manager = new StreamingTranscriptionQuotaManager(quotas());
    expect(
      manager.acquireSocket({ userId: 'user:A', notebookId: 'notebook:A' }),
    ).not.toBeNull();
    expect(
      manager.acquireSocket({ userId: 'user:A', notebookId: 'notebook:A' }),
    ).not.toBeNull();
    expect(
      manager.acquireSocket({ userId: 'user:A', notebookId: 'notebook:A' }),
    ).toBeNull();
  });

  it('达到全局连接上限时拒绝不同用户', () => {
    const manager = new StreamingTranscriptionQuotaManager(
      quotas({ maxConnectionsGlobal: 2 }),
    );
    expect(
      manager.acquireSocket({ userId: 'user:A', notebookId: 'notebook:A' }),
    ).not.toBeNull();
    expect(
      manager.acquireSocket({ userId: 'user:B', notebookId: 'notebook:B' }),
    ).not.toBeNull();
    expect(
      manager.acquireSocket({ userId: 'user:C', notebookId: 'notebook:C' }),
    ).toBeNull();
  });

  it('连接释放后可立即重新申请', () => {
    const manager = new StreamingTranscriptionQuotaManager(quotas());
    const first = manager.acquireSocket({
      userId: 'user:A',
      notebookId: 'notebook:A',
    })!;
    const second = manager.acquireSocket({
      userId: 'user:A',
      notebookId: 'notebook:A',
    })!;
    expect(
      manager.acquireSocket({ userId: 'user:A', notebookId: 'notebook:A' }),
    ).toBeNull();
    first.release();
    const third = manager.acquireSocket({
      userId: 'user:A',
      notebookId: 'notebook:A',
    });
    expect(third).not.toBeNull();
    second.release();
    third!.release();
  });

  it('socket lease 幂等：重复释放只生效一次', () => {
    const manager = new StreamingTranscriptionQuotaManager(quotas());
    const lease = manager.acquireSocket({
      userId: 'user:A',
      notebookId: 'notebook:A',
    })!;
    lease.release();
    lease.release();
    lease.release();
    expect(lease.released).toBe(true);
    const stats = manager.stats();
    expect(stats.socketGlobalActive).toBe(0);
    expect(stats.socketUserActive.size).toBe(0);
    expect(stats.socketNotebookActive.size).toBe(0);
  });

  it('acquireSession 受全局 recognizer 上限约束，与 socket 独立', () => {
    const manager = new StreamingTranscriptionQuotaManager(quotas());
    expect(manager.acquireSession()).not.toBeNull();
    expect(manager.acquireSession()).not.toBeNull();
    expect(manager.acquireSession()).not.toBeNull();
    // 全局 recognizer 上限 3：第 4 个拒绝。
    expect(manager.acquireSession()).toBeNull();
    expect(manager.stats().sessionGlobalActive).toBe(3);
    // socket 维度不受影响（连接与 recognizer 独立计数）。
    expect(
      manager.acquireSocket({ userId: 'user:A', notebookId: 'notebook:A' }),
    ).not.toBeNull();
    expect(manager.stats().socketGlobalActive).toBe(1);
  });

  it('session lease 幂等释放；终态释放后新 Session 可立即申请', () => {
    const manager = new StreamingTranscriptionQuotaManager(
      quotas({ maxActiveSessionsGlobal: 1 }),
    );
    const session = manager.acquireSession()!;
    expect(manager.acquireSession()).toBeNull();
    session.release();
    session.release();
    expect(manager.stats().sessionGlobalActive).toBe(0);
    expect(manager.acquireSession()).not.toBeNull();
  });

  it('socket 与 session 生命周期解耦：socket 未释放时 session 可独立释放', () => {
    const manager = new StreamingTranscriptionQuotaManager(quotas());
    const socketLease = manager.acquireSocket({
      userId: 'user:A',
      notebookId: 'notebook:A',
    })!;
    const sessionLease = manager.acquireSession()!;
    // 终态形成：recognizer 槽释放，连接仍存在（socket 槽保留）。
    sessionLease.release();
    expect(manager.stats().sessionGlobalActive).toBe(0);
    expect(manager.stats().socketGlobalActive).toBe(1);
    // 连接实际关闭：socket 槽释放。
    socketLease.release();
    expect(manager.stats().socketGlobalActive).toBe(0);
  });

  it('acquire 为空时返回 null 且不改变任何计数', () => {
    const manager = new StreamingTranscriptionQuotaManager(
      quotas({ maxConnectionsGlobal: 1 }),
    );
    manager.acquireSocket({ userId: 'user:A', notebookId: 'notebook:A' });
    expect(
      manager.acquireSocket({ userId: 'user:B', notebookId: 'notebook:B' }),
    ).toBeNull();
    expect(manager.stats().socketGlobalActive).toBe(1);
    expect(manager.stats().socketUserActive.get('user:B')).toBeUndefined();
  });
});
