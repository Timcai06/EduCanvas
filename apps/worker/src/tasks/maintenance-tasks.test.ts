import { parseCrontab } from 'graphile-worker';
import { describe, expect, it, vi } from 'vitest';
import { workerCrontab } from '../worker-config.js';
import { createIngestKnowledgeDocumentTask } from './ingest-knowledge-document.js';
import { createPurgeAnonymousSubjectsTask } from './purge-anonymous-subjects.js';

const helpers = {
  logger: { info: vi.fn() },
} as never;

describe('受控后台任务边界', () => {
  it('匿名清理计划可被Graphile解析且只注册一个周期项', () => {
    const items = parseCrontab(workerCrontab);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      task: 'maintenance:purge_anonymous_subjects',
      identifier: 'anonymous-retention-daily',
      payload: { limit: 100 },
    });
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
