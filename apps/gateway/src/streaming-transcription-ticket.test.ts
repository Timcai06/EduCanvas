/**
 * V12 WebSocket ticket store 单元测试：签发、单次使用、过期、惰性清理。
 */

import { describe, expect, it } from 'vitest';
import {
  STREAMING_TICKET_TTL_MS,
  StreamingTranscriptionTicketStore,
} from './streaming-transcription-ticket';

function fixedNowStore(nowMs: number): {
  store: StreamingTranscriptionTicketStore;
  advance: (ms: number) => void;
} {
  let now = nowMs;
  const store = new StreamingTranscriptionTicketStore({
    createRandom: () => `t-${now}-${Math.random().toString(36).slice(2)}`,
    now: () => now,
  });
  return {
    store,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('StreamingTranscriptionTicketStore', () => {
  it('签发返回不透明 ticket 与过期时间', () => {
    const { store } = fixedNowStore(1_000_000);
    const grant = store.issue({ userId: 'user:A', notebookId: 'notebook:A' });
    expect(grant.ticket.length).toBeGreaterThan(16);
    expect(grant.expiresAt).toBe(
      new Date(1_000_000 + STREAMING_TICKET_TTL_MS).toISOString(),
    );
    expect(store.size()).toBe(1);
  });

  it('redeem 返回绑定信息并标记单次使用', () => {
    const { store } = fixedNowStore(1_000_000);
    const grant = store.issue({ userId: 'user:A', notebookId: 'notebook:A' });
    expect(store.redeem(grant.ticket)).toEqual({
      userId: 'user:A',
      notebookId: 'notebook:A',
    });
    // 单次使用：第二次兑换失败，且不区分原因（与未知 ticket 同返回 null）。
    expect(store.redeem(grant.ticket)).toBeNull();
    expect(store.redeem('never-issued')).toBeNull();
  });

  it('过期 ticket 兑换失败', () => {
    const { store, advance } = fixedNowStore(1_000_000);
    const grant = store.issue({ userId: 'user:A', notebookId: 'notebook:A' });
    advance(STREAMING_TICKET_TTL_MS + 1);
    expect(store.redeem(grant.ticket)).toBeNull();
  });

  it('惰性清理过期项', () => {
    const { store, advance } = fixedNowStore(1_000_000);
    store.issue({ userId: 'user:A', notebookId: 'notebook:A' });
    expect(store.size()).toBe(1);
    advance(STREAMING_TICKET_TTL_MS + 1);
    // issue/redeem 会触发 expireStale 惰性清理。
    store.issue({ userId: 'user:B', notebookId: 'notebook:B' });
    expect(store.size()).toBe(1);
  });

  it('非法 TTL 拒绝构造', () => {
    expect(() => new StreamingTranscriptionTicketStore({ ttlMs: 0 })).toThrow();
    expect(
      () => new StreamingTranscriptionTicketStore({ ttlMs: 600_001 }),
    ).toThrow();
  });
});
