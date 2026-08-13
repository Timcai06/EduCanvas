import { describe, expect, it, vi } from 'vitest';
import { K12ConversationDualWriteInvariantError } from '@educanvas/db';
import { NOOP_METRICS } from '@educanvas/telemetry';
import {
  createBackfillK12ConversationTask,
  K12_CONVERSATION_BACKFILL_TASK,
} from './backfill-k12-conversation';
import { createTaskList } from './index';

const emptyResult = {
  mode: 'dry-run' as const,
  scannedMessageCount: 0,
  missingBeforeCount: 0,
  matchedBeforeCount: 0,
  mismatchedBeforeCount: 0,
  insertedCount: 0,
  nextCursor: null,
};

describe('K12 Conversation 历史回填任务', () => {
  it('默认 Worker 不注册回填，直接构造的任务也只能 dry-run', async () => {
    const previewPage = vi.fn().mockResolvedValue(emptyResult);
    const log = vi.fn();
    const task = createBackfillK12ConversationTask({ previewPage }, log);

    await task({}, {} as never);

    expect(previewPage).toHaveBeenCalledWith({ limit: 100, after: null });
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('"mode":"dry-run"'),
    );
    expect(
      createTaskList({
        continuationTrace: {} as never,
        metrics: NOOP_METRICS,
      }),
    ).not.toHaveProperty(K12_CONVERSATION_BACKFILL_TASK);
  });

  it('任意默认 Worker payload 都不能请求全局 apply', async () => {
    const cursor = {
      createdAt: '2026-08-06T00:00:00.000Z',
      messageId: '60000000-0000-4000-8000-000000000001',
    };
    const task = createBackfillK12ConversationTask({
      previewPage: vi.fn(),
    });

    await expect(
      task({ mode: 'apply', limit: 25, after: cursor }, {} as never),
    ).rejects.toBeInstanceOf(K12ConversationDualWriteInvariantError);
  });

  it('拒绝未知字段、越界批次与副本不一致', async () => {
    const mismatchRepository = {
      previewPage: vi.fn().mockResolvedValue({
        ...emptyResult,
        mismatchedBeforeCount: 1,
      }),
    };
    const task = createBackfillK12ConversationTask(mismatchRepository);

    await expect(task({ limit: 0 }, {} as never)).rejects.toBeInstanceOf(
      K12ConversationDualWriteInvariantError,
    );
    await expect(
      task({ limit: 10, message: 'secret' }, {} as never),
    ).rejects.toBeInstanceOf(K12ConversationDualWriteInvariantError);
    await expect(task({ limit: 10 }, {} as never)).rejects.toBeInstanceOf(
      K12ConversationDualWriteInvariantError,
    );
  });
});
