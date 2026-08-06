import { describe, expect, it, vi } from 'vitest';
import { K12ConversationDualWriteInvariantError } from '@educanvas/db';
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
  it('已注册但不加入 crontab，空 payload 默认 dry-run', async () => {
    const previewPage = vi.fn().mockResolvedValue(emptyResult);
    const applyPage = vi.fn();
    const log = vi.fn();
    const task = createBackfillK12ConversationTask(
      { previewPage, applyPage },
      log,
    );

    await task({}, {} as never);

    expect(previewPage).toHaveBeenCalledWith({ limit: 100, after: null });
    expect(applyPage).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('"mode":"dry-run"'),
    );
    expect(createTaskList({ continuationTrace: {} as never })).toHaveProperty(
      K12_CONVERSATION_BACKFILL_TASK,
    );
  });

  it('只有显式 apply 才写入，并原样转发受控游标与批次', async () => {
    const cursor = {
      createdAt: '2026-08-06T00:00:00.000Z',
      messageId: '60000000-0000-4000-8000-000000000001',
    };
    const applyPage = vi.fn().mockResolvedValue({
      ...emptyResult,
      mode: 'apply',
    });
    const task = createBackfillK12ConversationTask({
      previewPage: vi.fn(),
      applyPage,
    });

    await task({ mode: 'apply', limit: 25, after: cursor }, {} as never);

    expect(applyPage).toHaveBeenCalledWith({ limit: 25, after: cursor });
  });

  it('拒绝未知字段、越界批次与副本不一致', async () => {
    const mismatchRepository = {
      previewPage: vi.fn(),
      applyPage: vi.fn().mockResolvedValue({
        ...emptyResult,
        mode: 'apply' as const,
        mismatchedBeforeCount: 1,
      }),
    };
    const task = createBackfillK12ConversationTask(mismatchRepository);

    await expect(
      task({ mode: 'apply', limit: 0 }, {} as never),
    ).rejects.toBeInstanceOf(K12ConversationDualWriteInvariantError);
    await expect(
      task({ mode: 'dry-run', limit: 10, message: 'secret' }, {} as never),
    ).rejects.toBeInstanceOf(K12ConversationDualWriteInvariantError);
    await expect(
      task({ mode: 'apply', limit: 10 }, {} as never),
    ).rejects.toBeInstanceOf(K12ConversationDualWriteInvariantError);
  });
});
