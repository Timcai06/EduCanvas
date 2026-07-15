import { z } from 'zod';

/** 教学脊柱唯一允许持久化的五个状态。 */
export const teachingStates = [
  'DIAGNOSE',
  'EXPLAIN',
  'DEMONSTRATE',
  'PRACTICE',
  'ASSESS',
] as const;

/** 状态机运行时使用的严格状态Schema。 */
export const teachingStateSchema = z.enum(teachingStates);

/** 教学脊柱状态；REMEDIATE和ADVANCE不属于此类型。 */
export type TeachingState = z.infer<typeof teachingStateSchema>;

/**
 * Orchestrator可以提出的候选教学信号闭集。信号只表达“某阶段可能完成”，
 * 不携带目标状态、模型原文或客户端自报分数；最终转移仍由runtime guard决定。
 */
export const teachingTransitionCandidateSignals = [
  'DIAGNOSIS_COMPLETED',
  'EXPLANATION_COMPLETED',
  'DEMONSTRATION_COMPLETED',
  'PRACTICE_COMPLETED',
  'ASSESSMENT_COMPLETED',
] as const;

/** 候选教学信号的严格运行时Schema。 */
export const teachingTransitionCandidateSignalSchema = z.enum(
  teachingTransitionCandidateSignals,
);

/** 模型或受控工具只能提出此闭集中的候选信号。 */
export type TeachingTransitionCandidateSignal = z.infer<
  typeof teachingTransitionCandidateSignalSchema
>;

/** 静态候选信号解析结果；ASSESS出口必须另由可信掌握度决定。 */
export type CandidateTransitionResolution =
  | {
      ok: true;
      kind: 'STATE_TARGET';
      from: TeachingState;
      to: TeachingState;
    }
  | { ok: true; kind: 'ASSESSMENT_EXIT'; from: 'ASSESS' }
  | {
      ok: false;
      code: 'CANDIDATE_NOT_APPLICABLE';
      state: TeachingState;
      signal: TeachingTransitionCandidateSignal;
    };

/**
 * 把封闭候选信号映射到当前状态的唯一下一步。
 * 该函数故意不接受`targetState`，从协议层消除模型请求跳级的通道。
 */
export function resolveTransitionCandidate(
  state: TeachingState,
  rawSignal: TeachingTransitionCandidateSignal,
): CandidateTransitionResolution {
  const parsedState = teachingStateSchema.parse(state);
  const signal = teachingTransitionCandidateSignalSchema.parse(rawSignal);
  if (parsedState === 'DIAGNOSE' && signal === 'DIAGNOSIS_COMPLETED') {
    return { ok: true, kind: 'STATE_TARGET', from: parsedState, to: 'EXPLAIN' };
  }
  if (parsedState === 'EXPLAIN' && signal === 'EXPLANATION_COMPLETED') {
    return {
      ok: true,
      kind: 'STATE_TARGET',
      from: parsedState,
      to: 'DEMONSTRATE',
    };
  }
  if (parsedState === 'DEMONSTRATE' && signal === 'DEMONSTRATION_COMPLETED') {
    return {
      ok: true,
      kind: 'STATE_TARGET',
      from: parsedState,
      to: 'PRACTICE',
    };
  }
  if (parsedState === 'PRACTICE' && signal === 'PRACTICE_COMPLETED') {
    return { ok: true, kind: 'STATE_TARGET', from: parsedState, to: 'ASSESS' };
  }
  if (parsedState === 'ASSESS' && signal === 'ASSESSMENT_COMPLETED') {
    return { ok: true, kind: 'ASSESSMENT_EXIT', from: parsedState };
  }
  return {
    ok: false,
    code: 'CANDIDATE_NOT_APPLICABLE',
    state: parsedState,
    signal,
  };
}

/** ASSESS完成后的两个出口决策，不得写入lesson_sessions.state。 */
export const assessmentExitDecisions = ['REMEDIATE', 'ADVANCE'] as const;
export const assessmentExitDecisionSchema = z.enum(assessmentExitDecisions);
/** ASSESS出口决策类型；它控制后续动作但不进入持久化状态字段。 */
export type AssessmentExitDecision = z.infer<
  typeof assessmentExitDecisionSchema
>;

/** 状态转移被确定性guard拒绝时的稳定原因码。 */
export type TransitionRejectionCode =
  | 'ILLEGAL_TRANSITION'
  | 'INSUFFICIENT_PRACTICE'
  | 'ASSESSMENT_DECISION_REQUIRED'
  | 'ADVANCE_HAS_NO_TARGET_STATE';

/** 状态转移评估结果，调用方必须显式处理拒绝分支。 */
export type TransitionEvaluation =
  | { ok: true; from: TeachingState; to: TeachingState }
  | {
      ok: false;
      from: TeachingState;
      to: TeachingState;
      code: TransitionRejectionCode;
    };

/** 状态转移请求的运行时边界，拒绝负数证据和未知字段。 */
export const transitionRequestSchema = z
  .object({
    from: teachingStateSchema,
    to: teachingStateSchema,
    practiceEventCount: z.number().int().nonnegative(),
    minimumPracticeEvents: z.number().int().nonnegative(),
    assessmentDecision: assessmentExitDecisionSchema.optional(),
  })
  .strict();

/** 通过运行时Schema约束的状态转移请求。 */
export type TransitionRequest = z.infer<typeof transitionRequestSchema>;

/** 根据是否已有掌握记录显式选择初始状态，数据库不得自行填默认值。 */
export function selectInitialState(hasMasteryRecord: boolean): TeachingState {
  return hasMasteryRecord ? 'EXPLAIN' : 'DIAGNOSE';
}

/**
 * 评估一次教学脊柱转移；调用方只有在ok为true时才能持久化并生成state_transition事件。
 * PRACTICE到ASSESS的最少证据量由课程配置传入，避免在领域函数中写死学段参数。
 */
export function evaluateTransition(
  rawRequest: TransitionRequest,
): TransitionEvaluation {
  const request = transitionRequestSchema.parse(rawRequest);
  const { from, to } = request;

  if (from === 'DIAGNOSE' && to === 'EXPLAIN') return { ok: true, from, to };
  if (from === 'EXPLAIN' && to === 'DEMONSTRATE') return { ok: true, from, to };
  if (from === 'DEMONSTRATE' && to === 'PRACTICE')
    return { ok: true, from, to };

  if (from === 'PRACTICE' && to === 'ASSESS') {
    if (request.practiceEventCount < request.minimumPracticeEvents) {
      return { ok: false, from, to, code: 'INSUFFICIENT_PRACTICE' };
    }
    return { ok: true, from, to };
  }

  if (from === 'ASSESS' && (to === 'EXPLAIN' || to === 'PRACTICE')) {
    if (!request.assessmentDecision) {
      return { ok: false, from, to, code: 'ASSESSMENT_DECISION_REQUIRED' };
    }
    if (request.assessmentDecision === 'ADVANCE') {
      return { ok: false, from, to, code: 'ADVANCE_HAS_NO_TARGET_STATE' };
    }
    return { ok: true, from, to };
  }

  return { ok: false, from, to, code: 'ILLEGAL_TRANSITION' };
}

/** 会话游标只允许保存一层被打断状态，避免形成隐式分层状态机。 */
export interface TeachingSessionCursor {
  state: TeachingState;
  interruptedState: TeachingState | null;
}

/** 单层中断栈操作结果，拒绝嵌套中断和无中断恢复。 */
export type InterruptionResult =
  | { ok: true; cursor: TeachingSessionCursor }
  | {
      ok: false;
      code: 'INTERRUPTION_ALREADY_ACTIVE' | 'NO_ACTIVE_INTERRUPTION';
    };

/** 开始一次跳题中断；已有中断时拒绝继续压栈。 */
export function beginInterruption(
  cursor: TeachingSessionCursor,
): InterruptionResult {
  if (cursor.interruptedState)
    return { ok: false, code: 'INTERRUPTION_ALREADY_ACTIVE' };
  return { ok: true, cursor: { ...cursor, interruptedState: cursor.state } };
}

/** 结束跳题并恢复原脊柱状态。 */
export function resumeInterruption(
  cursor: TeachingSessionCursor,
): InterruptionResult {
  if (!cursor.interruptedState)
    return { ok: false, code: 'NO_ACTIVE_INTERRUPTION' };
  return {
    ok: true,
    cursor: { state: cursor.interruptedState, interruptedState: null },
  };
}
