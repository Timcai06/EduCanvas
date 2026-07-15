import { z } from 'zod';
import {
  domainLearningEventSchema,
  type DomainLearningEvent,
} from './domain-events';
import {
  calculateMastery,
  defaultMasteryConfig,
  getReviewIntervalDays,
  masteryConfigSchema,
  misconceptionTagSchema,
  misconceptionTags,
  type MasteryConfig,
  type MisconceptionTag,
} from './mastery';
import type { MasterySnapshot } from './ports';
import {
  evaluateTransition,
  teachingStateSchema,
  type TeachingState,
} from './state-machine';

/** 回放语义错误的稳定代码；日志只记录代码，不拼接事件原文。 */
export type LearningProjectionErrorCode =
  | 'EVENT_SESSION_MISMATCH'
  | 'EVENT_STUDENT_MISMATCH'
  | 'INVALID_EVENT_SEQUENCE'
  | 'STATE_HISTORY_MISMATCH'
  | 'TRANSITION_EVIDENCE_MISMATCH'
  | 'TRANSITION_GUARD_REJECTED'
  | 'KNOWLEDGE_NODE_REQUIRED'
  | 'MASTERY_IDENTITY_MISMATCH';

/** 可信事件流不能确定性回放时抛出的领域错误。 */
export class LearningProjectionError extends Error {
  constructor(readonly code: LearningProjectionErrorCode) {
    super(code);
    this.name = 'LearningProjectionError';
  }
}

/** 创建会话回放投影所需的可信起点。 */
export const learningProjectionSeedSchema = z
  .object({
    sessionId: z.uuid(),
    studentId: z.string().min(1).max(128),
    initialState: teachingStateSchema,
  })
  .strict();

export type LearningProjectionSeed = z.infer<
  typeof learningProjectionSeedSchema
>;

/**
 * 旧事件回放所需的兼容策略。新版事件自带状态门槛与掌握度参数快照；
 * 只有缺少快照的历史事件才会读取这里的当前配置。
 */
export const learningProjectionConfigSchema = z
  .object({
    minimumPracticeEvents: z.number().int().nonnegative(),
    masteryConfig: masteryConfigSchema.default(defaultMasteryConfig),
    prerequisiteScoresByKnowledgeNode: z
      .record(z.string().min(1).max(128), z.array(z.number().min(0).max(1)))
      .default({}),
  })
  .strict();

export type LearningProjectionConfig = z.infer<
  typeof learningProjectionConfigSchema
>;

/** 从可信事件流导出的完整当前投影；任何模型文本都不在该结构中。 */
export interface LearningProjection {
  sessionId: string;
  studentId: string;
  state: TeachingState;
  lastSequence: number;
  /** 只统计当前PRACTICE阶段内的服务端判分事件。 */
  practiceEventCount: number;
  masteryByKnowledgeNode: Readonly<Record<string, MasterySnapshot>>;
}

const masterySnapshotSchema = z
  .object({
    studentId: z.string().min(1).max(128),
    knowledgeNodeId: z.string().min(1).max(128),
    masteryScore: z.number().min(0).max(1),
    attemptCount: z.number().int().nonnegative(),
    correctCount: z.number().int().nonnegative(),
    hintCount: z.number().int().nonnegative(),
    activeMisconceptions: z.array(misconceptionTagSchema),
    lastPracticedAt: z.iso.datetime().nullable(),
    nextReviewAt: z.iso.datetime().nullable(),
    version: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((snapshot, context) => {
    if (snapshot.correctCount > snapshot.attemptCount) {
      context.addIssue({
        code: 'custom',
        path: ['correctCount'],
        message: 'correctCount不能大于attemptCount',
      });
    }
  });

function emptyMastery(
  studentId: string,
  knowledgeNodeId: string,
): MasterySnapshot {
  return {
    studentId,
    knowledgeNodeId,
    masteryScore: 0,
    attemptCount: 0,
    correctCount: 0,
    hintCount: 0,
    activeMisconceptions: [],
    lastPracticedAt: null,
    nextReviewAt: null,
    version: 0,
  };
}

function daysBetween(previousIso: string | null, currentIso: string): number {
  if (!previousIso) return 0;
  return Math.max(
    0,
    (new Date(currentIso).getTime() - new Date(previousIso).getTime()) /
      86_400_000,
  );
}

function sortMisconceptions(
  values: ReadonlySet<MisconceptionTag>,
): readonly MisconceptionTag[] {
  return misconceptionTags.filter((tag) => values.has(tag));
}

/**
 * 使用与全量回放相同的纯函数增量更新一个知识点掌握度。
 * 判分服务调用此函数，避免线上投影与离线回放各维护一套公式。
 */
export function projectMasterySnapshot(
  previousSnapshot: MasterySnapshot | null,
  rawEvent: unknown,
  rawConfig: LearningProjectionConfig,
): MasterySnapshot | null {
  const event = domainLearningEventSchema.parse(rawEvent);
  const config = learningProjectionConfigSchema.parse(rawConfig);
  if (
    event.eventType !== 'assessment_graded' &&
    event.eventType !== 'hint_recorded' &&
    event.eventType !== 'misconception_updated'
  ) {
    return previousSnapshot;
  }
  if (!event.knowledgeNodeId) {
    throw new LearningProjectionError('KNOWLEDGE_NODE_REQUIRED');
  }
  if (
    previousSnapshot &&
    (previousSnapshot.studentId !== event.studentId ||
      previousSnapshot.knowledgeNodeId !== event.knowledgeNodeId)
  ) {
    throw new LearningProjectionError('MASTERY_IDENTITY_MISMATCH');
  }
  const previous =
    previousSnapshot ?? emptyMastery(event.studentId, event.knowledgeNodeId);
  if (event.eventType === 'hint_recorded') {
    return {
      ...previous,
      hintCount: previous.hintCount + 1,
      version: previous.version + 1,
    };
  }

  if (event.eventType === 'misconception_updated') {
    const active = new Set(previous.activeMisconceptions);
    if (event.payload.status === 'active') active.add(event.payload.tag);
    else active.delete(event.payload.tag);
    return {
      ...previous,
      activeMisconceptions: sortMisconceptions(active),
      version: previous.version + 1,
    };
  }

  if (event.eventType !== 'assessment_graded') return previous;

  const attemptCount = previous.attemptCount + event.payload.attemptedItems;
  const correctCount = previous.correctCount + event.payload.correctItems;
  const activeMisconceptionCount = previous.activeMisconceptions.length;
  const recordedAt = event.recordedAt;
  const mastery = calculateMastery(
    {
      previousScore: previous.masteryScore,
      attemptCount,
      correctCount,
      hintCount: previous.hintCount,
      activeMisconceptionCount,
      daysSincePracticed: daysBetween(previous.lastPracticedAt, recordedAt),
      prerequisiteScores:
        event.payload.prerequisiteScores ??
        config.prerequisiteScoresByKnowledgeNode[previous.knowledgeNodeId] ??
        [],
    },
    // 新事件自带完整策略快照；config仅作为旧事件的显式兼容回放参数。
    event.payload.masteryConfig ?? config.masteryConfig,
  );
  const reviewDays = getReviewIntervalDays(
    mastery.score,
    activeMisconceptionCount,
  );
  const nextReviewAt = new Date(
    new Date(recordedAt).getTime() + reviewDays * 86_400_000,
  ).toISOString();
  return {
    ...previous,
    masteryScore: mastery.score,
    attemptCount,
    correctCount,
    lastPracticedAt: recordedAt,
    nextReviewAt,
    version: previous.version + 1,
  };
}

/** 创建还未消费任何领域事件的不可变投影。 */
export function createLearningProjection(
  rawSeed: LearningProjectionSeed,
): LearningProjection {
  const seed = learningProjectionSeedSchema.parse(rawSeed);
  return {
    sessionId: seed.sessionId,
    studentId: seed.studentId,
    state: seed.initialState,
    lastSequence: 0,
    practiceEventCount: 0,
    masteryByKnowledgeNode: {},
  };
}

/**
 * 把一条可信领域事件增量投影到当前状态。该函数与全量回放共用同一路径，
 * 因而不会维护第二套“线上算法”。
 */
export function projectLearningEvent(
  projection: LearningProjection,
  rawEvent: unknown,
  rawConfig: LearningProjectionConfig,
): LearningProjection {
  const event = domainLearningEventSchema.parse(rawEvent);
  const config = learningProjectionConfigSchema.parse(rawConfig);
  if (event.sessionId !== projection.sessionId) {
    throw new LearningProjectionError('EVENT_SESSION_MISMATCH');
  }
  if (event.studentId !== projection.studentId) {
    throw new LearningProjectionError('EVENT_STUDENT_MISMATCH');
  }
  if (event.sequence !== projection.lastSequence + 1) {
    throw new LearningProjectionError('INVALID_EVENT_SEQUENCE');
  }

  let state = projection.state;
  let practiceEventCount = projection.practiceEventCount;
  if (event.eventType === 'assessment_graded' && state === 'PRACTICE') {
    practiceEventCount += 1;
  }

  if (event.eventType === 'state_transition') {
    if (event.payload.from !== state) {
      throw new LearningProjectionError('STATE_HISTORY_MISMATCH');
    }
    if (
      event.payload.practiceEventCount !== undefined &&
      event.payload.practiceEventCount !== practiceEventCount
    ) {
      throw new LearningProjectionError('TRANSITION_EVIDENCE_MISMATCH');
    }
    const guard = evaluateTransition({
      from: event.payload.from,
      to: event.payload.to,
      practiceEventCount,
      // 新事件冻结产生时的门槛；config仅用于回放没有快照的旧事件。
      minimumPracticeEvents:
        event.payload.minimumPracticeEvents ?? config.minimumPracticeEvents,
      assessmentDecision:
        event.payload.from === 'ASSESS'
          ? (event.payload.assessmentExit?.decision ?? 'REMEDIATE')
          : undefined,
    });
    if (!guard.ok) {
      throw new LearningProjectionError('TRANSITION_GUARD_REJECTED');
    }
    state = event.payload.to;
    // 练习证据只属于一次PRACTICE停留；离开或重新进入都从零开始。
    practiceEventCount = 0;
  }

  let masteryByKnowledgeNode = projection.masteryByKnowledgeNode;
  if (
    event.eventType === 'assessment_graded' ||
    event.eventType === 'hint_recorded' ||
    event.eventType === 'misconception_updated'
  ) {
    if (!event.knowledgeNodeId) {
      throw new LearningProjectionError('KNOWLEDGE_NODE_REQUIRED');
    }
    const previous =
      projection.masteryByKnowledgeNode[event.knowledgeNodeId] ??
      emptyMastery(projection.studentId, event.knowledgeNodeId);
    const projected = projectMasterySnapshot(previous, event, config);
    if (!projected) {
      throw new Error('掌握度事件未产生掌握度投影');
    }
    masteryByKnowledgeNode = {
      ...projection.masteryByKnowledgeNode,
      [event.knowledgeNodeId]: projected,
    };
  }

  return {
    ...projection,
    state,
    lastSequence: event.sequence,
    practiceEventCount,
    masteryByKnowledgeNode,
  };
}

/** 从事件事实源完整重建状态、掌握度、提示次数和活跃误区。 */
export function replayLearningEvents(
  seed: LearningProjectionSeed,
  events: readonly unknown[],
  config: LearningProjectionConfig,
): LearningProjection {
  return events.reduce<LearningProjection>(
    (projection, event) => projectLearningEvent(projection, event, config),
    createLearningProjection(seed),
  );
}

const courseNodeSchema = z
  .object({
    knowledgeNodeId: z.string().min(1).max(128),
    prerequisiteNodeIds: z.array(z.string().min(1).max(128)),
  })
  .strict();

/** 下一节点推荐使用的版本化课程图；数组顺序就是稳定课程顺序。 */
export const nextNodeCourseConfigSchema = z
  .object({
    courseVersion: z.string().min(1).max(64),
    nodes: z.array(courseNodeSchema).min(1),
    masteryConfig: masteryConfigSchema.default(defaultMasteryConfig),
  })
  .strict()
  .superRefine((course, context) => {
    const nodeIds = new Set(course.nodes.map((node) => node.knowledgeNodeId));
    if (nodeIds.size !== course.nodes.length) {
      context.addIssue({
        code: 'custom',
        path: ['nodes'],
        message: 'knowledgeNodeId不能重复',
      });
    }
    course.nodes.forEach((node, index) => {
      for (const prerequisite of node.prerequisiteNodeIds) {
        if (
          prerequisite === node.knowledgeNodeId ||
          !nodeIds.has(prerequisite)
        ) {
          context.addIssue({
            code: 'custom',
            path: ['nodes', index, 'prerequisiteNodeIds'],
            message: '先修节点必须存在且不能指向自身',
          });
        }
      }
    });
    const prerequisitesByNode = new Map(
      course.nodes.map((node) => [
        node.knowledgeNodeId,
        node.prerequisiteNodeIds,
      ]),
    );
    const visiting = new Set<string>();
    const visited = new Set<string>();
    let hasCycle = false;
    const visit = (nodeId: string) => {
      if (visiting.has(nodeId)) {
        hasCycle = true;
        return;
      }
      if (visited.has(nodeId) || hasCycle) return;
      visiting.add(nodeId);
      for (const prerequisite of prerequisitesByNode.get(nodeId) ?? []) {
        visit(prerequisite);
      }
      visiting.delete(nodeId);
      visited.add(nodeId);
    };
    for (const nodeId of nodeIds) visit(nodeId);
    if (hasCycle) {
      context.addIssue({
        code: 'custom',
        path: ['nodes'],
        message: '课程先修图不能包含环',
      });
    }
  });

export type NextNodeCourseConfig = z.infer<typeof nextNodeCourseConfigSchema>;

/** 推荐器只接收可信掌握度投影、当前节点、课程图和服务端时钟。 */
export const recommendNextNodeInputSchema = z
  .object({
    trustedStudentId: z.string().min(1).max(128),
    currentKnowledgeNodeId: z.string().min(1).max(128),
    masterySnapshots: z.array(masterySnapshotSchema),
    courseConfig: nextNodeCourseConfigSchema,
    now: z.iso.datetime(),
  })
  .strict()
  .superRefine((input, context) => {
    const seen = new Set<string>();
    const courseNodeIds = new Set(
      input.courseConfig.nodes.map((node) => node.knowledgeNodeId),
    );
    if (!courseNodeIds.has(input.currentKnowledgeNodeId)) {
      context.addIssue({
        code: 'custom',
        path: ['currentKnowledgeNodeId'],
        message: '当前知识点必须存在于课程图',
      });
    }
    input.masterySnapshots.forEach((snapshot, index) => {
      if (snapshot.studentId !== input.trustedStudentId) {
        context.addIssue({
          code: 'custom',
          path: ['masterySnapshots', index, 'studentId'],
          message: '掌握度必须属于可信学生',
        });
      }
      if (!courseNodeIds.has(snapshot.knowledgeNodeId)) {
        context.addIssue({
          code: 'custom',
          path: ['masterySnapshots', index, 'knowledgeNodeId'],
          message: '掌握度知识点必须存在于课程图',
        });
      }
      if (seen.has(snapshot.knowledgeNodeId)) {
        context.addIssue({
          code: 'custom',
          path: ['masterySnapshots', index, 'knowledgeNodeId'],
          message: '同一知识点只能有一个掌握度投影',
        });
      }
      seen.add(snapshot.knowledgeNodeId);
    });
  });

export type RecommendNextNodeInput = z.infer<
  typeof recommendNextNodeInputSchema
>;

/** 确定性推荐结果，不含模型生成解释。 */
export type NextNodeRecommendation =
  | {
      kind: 'CONTINUE_CURRENT';
      knowledgeNodeId: string;
      reason: 'CURRENT_NODE_NOT_MASTERED';
    }
  | {
      kind: 'REVIEW';
      knowledgeNodeId: string;
      reason: 'REVIEW_DUE' | 'REMEDIATION_REQUIRED';
    }
  | {
      kind: 'START_NEW';
      knowledgeNodeId: string;
      reason: 'PREREQUISITES_READY';
    }
  | {
      kind: 'BLOCKED';
      knowledgeNodeId: null;
      reason: 'PREREQUISITES_NOT_READY';
    }
  | {
      kind: 'COURSE_COMPLETE';
      knowledgeNodeId: null;
      reason: 'ALL_NODES_MASTERED';
    };

/**
 * 双队列确定性推荐：先守住当前节点，再处理到期复习，最后选择先修已就绪的新节点。
 * 函数的输入Schema没有消息、Prompt、工具文本或模型评分字段。
 */
export function recommendNextNode(rawInput: unknown): NextNodeRecommendation {
  const input = recommendNextNodeInputSchema.parse(rawInput);
  const masteryByNode = new Map(
    input.masterySnapshots.map((snapshot) => [
      snapshot.knowledgeNodeId,
      snapshot,
    ]),
  );
  const { enterThreshold, prerequisiteGate } = input.courseConfig.masteryConfig;
  const currentMastery = masteryByNode.get(input.currentKnowledgeNodeId);
  if (!currentMastery || currentMastery.masteryScore < enterThreshold) {
    return {
      kind: 'CONTINUE_CURRENT',
      knowledgeNodeId: input.currentKnowledgeNodeId,
      reason: 'CURRENT_NODE_NOT_MASTERED',
    };
  }

  const now = new Date(input.now).getTime();
  const dueReview = input.courseConfig.nodes
    .flatMap((node, order) => {
      const mastery = masteryByNode.get(node.knowledgeNodeId);
      if (
        node.knowledgeNodeId === input.currentKnowledgeNodeId ||
        !mastery?.nextReviewAt ||
        new Date(mastery.nextReviewAt).getTime() > now
      ) {
        return [];
      }
      return [{ node, order, mastery }];
    })
    .sort((left, right) => {
      const byDueDate =
        new Date(left.mastery.nextReviewAt ?? 0).getTime() -
        new Date(right.mastery.nextReviewAt ?? 0).getTime();
      return byDueDate || left.order - right.order;
    })[0];
  if (dueReview) {
    return {
      kind: 'REVIEW',
      knowledgeNodeId: dueReview.node.knowledgeNodeId,
      reason: 'REVIEW_DUE',
    };
  }

  const isReady = (prerequisites: readonly string[]) =>
    prerequisites.every(
      (nodeId) =>
        (masteryByNode.get(nodeId)?.masteryScore ?? 0) >= prerequisiteGate,
    );
  const newNode = input.courseConfig.nodes.find(
    (node) =>
      !masteryByNode.has(node.knowledgeNodeId) &&
      isReady(node.prerequisiteNodeIds),
  );
  if (newNode) {
    return {
      kind: 'START_NEW',
      knowledgeNodeId: newNode.knowledgeNodeId,
      reason: 'PREREQUISITES_READY',
    };
  }

  const remediation = input.courseConfig.nodes.find((node) => {
    const mastery = masteryByNode.get(node.knowledgeNodeId);
    return (
      node.knowledgeNodeId !== input.currentKnowledgeNodeId &&
      mastery !== undefined &&
      mastery.masteryScore < enterThreshold &&
      isReady(node.prerequisiteNodeIds)
    );
  });
  if (remediation) {
    return {
      kind: 'REVIEW',
      knowledgeNodeId: remediation.knowledgeNodeId,
      reason: 'REMEDIATION_REQUIRED',
    };
  }

  const allMastered = input.courseConfig.nodes.every(
    (node) =>
      (masteryByNode.get(node.knowledgeNodeId)?.masteryScore ?? 0) >=
      enterThreshold,
  );
  return allMastered
    ? {
        kind: 'COURSE_COMPLETE',
        knowledgeNodeId: null,
        reason: 'ALL_NODES_MASTERED',
      }
    : {
        kind: 'BLOCKED',
        knowledgeNodeId: null,
        reason: 'PREREQUISITES_NOT_READY',
      };
}

/** 供调用方显式构造默认回放配置，避免散落默认参数。 */
export function createDefaultLearningProjectionConfig(
  minimumPracticeEvents: number,
): LearningProjectionConfig {
  return learningProjectionConfigSchema.parse({ minimumPracticeEvents });
}

/** 类型导出辅助，确保课程配置使用同一MasteryConfig定义。 */
export type { MasteryConfig };
