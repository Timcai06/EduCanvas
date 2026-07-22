import { parseCrontab } from 'graphile-worker';
import { describe, expect, it, vi } from 'vitest';
import { workerCrontab } from '../worker-config.js';
import { createIngestKnowledgeDocumentTask } from './ingest-knowledge-document.js';
import { createPurgeAnonymousSubjectsTask } from './purge-anonymous-subjects.js';
import { createRecoverOperationContinuationsTask } from './recover-operation-continuations.js';
import { createReconcileToolApprovalIntentsTask } from './reconcile-tool-approval-intents.js';

const helpers = {
  logger: { info: vi.fn() },
} as never;

describe('受控后台任务边界', () => {
  it('维护计划可被Graphile解析且任务身份与批次固定', () => {
    const items = parseCrontab(workerCrontab);
    expect(items).toHaveLength(3);
    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          task: 'maintenance:recover_operation_continuations',
          identifier: 'operation-continuation-recovery',
          payload: { limit: 100 },
        }),
        expect.objectContaining({
          task: 'maintenance:reconcile_tool_approval_intents',
          identifier: 'tool-approval-intent-reconciliation',
          payload: { limit: 500 },
        }),
        expect.objectContaining({
          task: 'maintenance:purge_anonymous_subjects',
          identifier: 'anonymous-retention-daily',
          payload: { limit: 100 },
        }),
      ]),
    );
  });

  it('continuation恢复只转发受控批次并记录低基数健康状态', async () => {
    const requeueExpiredForExecution = vi.fn().mockResolvedValue({
      examined: 2,
      requeued: 2,
      generationExhausted: 1,
    });
    const inspectRecoveryHealth = vi.fn().mockResolvedValue({
      ready: 2,
      runningActive: 1,
      runningExpired: 0,
      generationExhausted: 1,
      terminalOperationStale: 0,
      oldestExpiredAt: null,
    });
    const logger = { info: vi.fn() };
    const task = createRecoverOperationContinuationsTask({
      requeueExpiredForExecution,
      inspectRecoveryHealth,
    });

    await task({ limit: 25 }, { logger } as never);

    expect(requeueExpiredForExecution).toHaveBeenCalledWith({ limit: 25 });
    expect(inspectRecoveryHealth).toHaveBeenCalledOnce();
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('examined=2,requeued=2,generationExhausted=1'),
    );
    expect(logger.info).not.toHaveBeenCalledWith(
      expect.stringContaining('continuationId'),
    );
    await expect(task({ limit: 501 }, { logger } as never)).rejects.toThrow();
  });

  it('匿名清理只转发经过约束的批次大小', async () => {
    const purgeExpiredSubjects = vi.fn().mockResolvedValue({
      evaluatedSubjects: 2,
      deletedSubjects: 1,
      skippedSubjects: 1,
    });
    const task = createPurgeAnonymousSubjectsTask({ purgeExpiredSubjects });

    await task({ limit: 25 }, helpers);

    expect(purgeExpiredSubjects).toHaveBeenCalledWith({ limit: 25 });
    await expect(task({ limit: 0 }, helpers)).rejects.toThrow();
  });

  it('审批意图收敛只转发经过约束的批次大小', async () => {
    const abandonExpiredPrepared = vi.fn().mockResolvedValue(3);
    const abandonExpiredMcp = vi.fn().mockResolvedValue(2);
    const task = createReconcileToolApprovalIntentsTask(
      { abandonExpiredPrepared },
      { abandonExpiredPrepared: abandonExpiredMcp },
    );

    await task({ limit: 25 }, helpers);

    expect(abandonExpiredPrepared).toHaveBeenCalledWith({ limit: 25 });
    expect(abandonExpiredMcp).toHaveBeenCalledWith({ limit: 25 });
    await expect(task({ limit: 501 }, helpers)).rejects.toThrow();
  });

  it('课程资料任务创建受控Source后再摄取版本', async () => {
    const createOrGetSource = vi.fn().mockResolvedValue({
      source: { id: '04fb1704-5192-4ac1-b866-f1ad31243df0' },
    });
    const ingestDocument = vi.fn().mockResolvedValue({
      replayed: false,
      document: { id: '104fb170-5192-4ac1-b866-f1ad31243df0', version: 1 },
    });
    const task = createIngestKnowledgeDocumentTask({
      createOrGetSource,
      ingestDocument,
    });
    const payload = {
      source: {
        gradeBand: 'grade-7',
        courseSlug: 'biology',
        sourceKey: 'lesson-1',
        title: '第一课',
        sourceType: 'text' as const,
      },
      document: {
        contentHash: 'a'.repeat(64),
        objectKey: 'knowledge/lesson-1.txt',
        parserVersion: 'plain-text-v1',
        outcome: {
          status: 'ready' as const,
          chunks: [{ content: '细胞是生命活动的基本单位。' }],
        },
      },
    };

    await task(payload, helpers);

    expect(createOrGetSource).toHaveBeenCalledWith(payload.source);
    expect(ingestDocument).toHaveBeenCalledWith({
      sourceId: '04fb1704-5192-4ac1-b866-f1ad31243df0',
      ...payload.document,
    });
  });

  it('拒绝公开URL和未声明字段', async () => {
    const task = createIngestKnowledgeDocumentTask({
      createOrGetSource: vi.fn(),
      ingestDocument: vi.fn(),
    });
    await expect(
      task(
        {
          source: {
            gradeBand: 'grade-7',
            courseSlug: 'biology',
            sourceKey: 'lesson-1',
            title: '第一课',
            sourceType: 'text',
            url: 'https://example.com/prompt-injection.txt',
          },
          document: {
            contentHash: 'a'.repeat(64),
            objectKey: 'https://example.com/file.txt',
            parserVersion: 'v1',
            outcome: { status: 'ready', chunks: [{ content: '正文' }] },
          },
        },
        helpers,
      ),
    ).rejects.toThrow();

    await expect(
      task(
        {
          source: {
            gradeBand: 'grade-7',
            courseSlug: 'biology',
            sourceKey: 'lesson-1',
            title: '第一课',
            sourceType: 'text',
          },
          document: {
            contentHash: 'a'.repeat(64),
            objectKey: 'https://example.com/file.txt',
            parserVersion: 'v1',
            outcome: { status: 'ready', chunks: [{ content: '正文' }] },
          },
        },
        helpers,
      ),
    ).rejects.toThrow('objectKey不能是公开URL');
  });
});
