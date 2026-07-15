import { prepareArtifact } from '@educanvas/canvas-protocol/server';
import type {
  DomainLearningEvent,
  MasterySnapshot,
  TeachingTransaction,
  TeachingUnitOfWork,
} from '@educanvas/teaching-core';
import { describe, expect, it } from 'vitest';
import { GradeCanvasSubmissionService } from './grade-submission';

const sessionId = '22222222-2222-4222-8222-222222222222';
const clientEvent = {
  schemaVersion: '1',
  eventId: '11111111-1111-4111-8111-111111111111',
  artifactId: 'quiz-1',
  occurredAt: '2026-07-14T06:00:00.000Z',
  type: 'quiz_answer_submitted',
  payload: { questionId: 'q1', selectedOptionId: 'a' },
} as const;

const { gradingKey } = prepareArtifact({
  schemaVersion: '1',
  artifactId: 'quiz-1',
  type: 'quiz',
  title: '机器学习小测',
  params: {
    questions: [
      {
        id: 'q1',
        question: '训练数据的作用是什么？',
        options: [
          { id: 'a', text: '提供学习样例' },
          { id: 'b', text: '保证永远正确' },
        ],
        correctOptionId: 'a',
      },
    ],
  },
});

function createHarness() {
  const events: DomainLearningEvent[] = [];
  let mastery: MasterySnapshot | null = null;
  let sequence = 0;
  let saveCount = 0;

  const transaction: TeachingTransaction = {
    sessions: {
      async getById(id) {
        return id === sessionId
          ? {
              id: sessionId,
              studentId: 'student-1',
              knowledgeNodeId: 'node-1',
              state: 'PRACTICE',
              interruptedState: null,
              version: 1,
            }
          : null;
      },
      async updateState() {
        throw new Error('本测试不应更新教学状态');
      },
    },
    mastery: {
      async get() {
        return mastery;
      },
      async save(input) {
        saveCount += 1;
        mastery = {
          ...input.snapshot,
          version: input.expectedVersion + 1,
        };
        return mastery;
      },
    },
    events: {
      async lockIdempotencyKey() {},
      async getByIdempotencyKey(key) {
        return events.find((event) => event.idempotencyKey === key) ?? null;
      },
      async allocateSequence() {
        sequence += 1;
        return sequence;
      },
      async append(event) {
        events.push(event);
        return event;
      },
      async listBySession() {
        return events;
      },
    },
  };
  const unitOfWork: TeachingUnitOfWork = {
    async run(operation) {
      return operation(transaction);
    },
  };
  const service = new GradeCanvasSubmissionService(
    {
      async getGradingKey(_sessionId, artifactId) {
        return artifactId === gradingKey.artifactId ? gradingKey : null;
      },
    },
    unitOfWork,
    () => new Date('2026-07-14T06:00:01.000Z'),
  );

  return {
    service,
    getState: () => ({ events, mastery, sequence, saveCount }),
  };
}

describe('GradeCanvasSubmissionService', () => {
  it('在一个事务内生成可信事件并更新掌握度', async () => {
    const harness = createHarness();
    const outcome = await harness.service.execute({
      trustedStudentId: 'student-1',
      sessionId,
      clientEvent,
      prerequisiteScores: [],
    });

    expect(outcome).toMatchObject({
      ok: true,
      replayed: false,
      grading: { attemptedItems: 1, correctItems: 1 },
      event: {
        sequence: 1,
        eventType: 'assessment_graded',
        source: 'grading_service',
      },
      mastery: { attemptCount: 1, correctCount: 1, version: 1 },
    });
    expect(harness.getState()).toMatchObject({
      sequence: 1,
      saveCount: 1,
    });
  });

  it('相同客户端事件重试时返回原事实且不重复计数', async () => {
    const harness = createHarness();
    const command = {
      trustedStudentId: 'student-1',
      sessionId,
      clientEvent,
      prerequisiteScores: [],
    };
    await harness.service.execute(command);
    const replay = await harness.service.execute(command);

    expect(replay).toMatchObject({ ok: true, replayed: true });
    expect(harness.getState()).toMatchObject({
      sequence: 1,
      saveCount: 1,
    });
  });

  it('相同事件ID对应不同判分结果时拒绝幂等冲突', async () => {
    const harness = createHarness();
    await harness.service.execute({
      trustedStudentId: 'student-1',
      sessionId,
      clientEvent,
      prerequisiteScores: [],
    });
    const conflict = await harness.service.execute({
      trustedStudentId: 'student-1',
      sessionId,
      clientEvent: {
        ...clientEvent,
        payload: { questionId: 'q1', selectedOptionId: 'b' },
      },
      prerequisiteScores: [],
    });

    expect(conflict).toEqual({ ok: false, code: 'IDEMPOTENCY_CONFLICT' });
    expect(harness.getState()).toMatchObject({
      sequence: 1,
      saveCount: 1,
    });
  });

  it('拒绝伪造选项且不打开写事务', async () => {
    const harness = createHarness();
    const outcome = await harness.service.execute({
      trustedStudentId: 'student-1',
      sessionId,
      clientEvent: {
        ...clientEvent,
        payload: { questionId: 'q1', selectedOptionId: 'missing' },
      },
      prerequisiteScores: [],
    });

    expect(outcome).toEqual({ ok: false, code: 'UNKNOWN_CHOICE' });
    expect(harness.getState()).toMatchObject({
      sequence: 0,
      saveCount: 0,
    });
  });

  it('拒绝不属于可信学生的会话且不进入判分写路径', async () => {
    const harness = createHarness();
    const outcome = await harness.service.execute({
      trustedStudentId: 'student-forged',
      sessionId,
      clientEvent,
      prerequisiteScores: [],
    });

    expect(outcome).toEqual({ ok: false, code: 'SESSION_NOT_FOUND' });
    expect(harness.getState()).toMatchObject({
      sequence: 0,
      saveCount: 0,
    });
  });
});
