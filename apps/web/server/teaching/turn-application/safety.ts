import 'server-only';

import {
  extractAgentMessageText,
  type TurnApplicationCommand,
} from '@educanvas/agent-core';
import type { TurnApplicationOutputGuardPort } from '@educanvas/agent-runtime';
import {
  evaluateTeachingInput,
  type TeachingSafetyDecision,
} from '@educanvas/teaching-core';
import {
  TeachingOutputSafetyGate,
  recordTeachingMetric,
} from '@educanvas/teaching-runtime';
import type { AnonymousIdentity } from '../../identity/anonymous-identity';
import { webTeachingObservability } from '../teaching-observability';
import { webTeachingPersistence } from './persistence';

type BlockedTeachingSafetyDecision = TeachingSafetyDecision & {
  action: 'block' | 'escalate';
  policyCode: Exclude<TeachingSafetyDecision['policyCode'], 'k12_allowed'>;
};

/** 写入 Web 教学安全决策；可信学生与会话边界由调用方显式提供。 */
export async function recordWebTeachingSafetyDecision(input: {
  identity: AnonymousIdentity;
  sessionId: string;
  turnId: string;
  decision: TeachingSafetyDecision;
}): Promise<void> {
  await webTeachingPersistence.safetyDecisions.record({
    trustedStudentId: input.identity.studentId,
    sessionId: input.sessionId,
    turnId: input.turnId,
    phase: input.decision.phase,
    policyVersion: input.decision.policyVersion,
    category: input.decision.category,
    action: input.decision.action,
    detectorVersion: input.decision.detectorVersion,
  });
}

/** 执行教学输入 preflight；拒绝结果保持原有公开文案与五维策略指标。 */
export async function evaluateWebTeachingPreflight(input: {
  identity: AnonymousIdentity;
  sessionId: string;
  turnId: string;
  parts: TurnApplicationCommand['input']['parts'];
}) {
  const evaluation = evaluateTeachingInput(
    extractAgentMessageText(input.parts),
  );
  await recordWebTeachingSafetyDecision({
    identity: input.identity,
    sessionId: input.sessionId,
    turnId: input.turnId,
    decision: evaluation.decision,
  });
  if (evaluation.allowed) return { kind: 'allow' as const };
  const blockedDecision: BlockedTeachingSafetyDecision = {
    ...evaluation.decision,
    policyCode: evaluation.decision.policyCode as Exclude<
      TeachingSafetyDecision['policyCode'],
      'k12_allowed'
    >,
  };
  recordTeachingMetric(webTeachingObservability, {
    name: 'policy_blocks',
    value: 1,
    phase: blockedDecision.phase,
    category: blockedDecision.category,
    action: blockedDecision.action,
    policyCode: blockedDecision.policyCode,
  });
  return {
    kind: 'reject' as const,
    publicContent: evaluation.publicResponse.text,
    failureCode: 'POLICY_BLOCKED' as const,
  };
}

class WebTeachingOutputGuard implements TurnApplicationOutputGuardPort {
  private readonly gate = new TeachingOutputSafetyGate();

  constructor(
    private readonly identity: AnonymousIdentity,
    private readonly sessionId: string,
    private readonly turnId: string,
  ) {}

  async push(delta: string) {
    const result = this.gate.push(delta);
    if (result.kind === 'blocked') {
      await this.record(result.decision);
      return {
        kind: 'block' as const,
        publicContent: result.publicResponse.text,
        failureCode: 'POLICY_BLOCKED' as const,
      };
    }
    if (result.kind === 'closed') {
      throw new Error('teaching_output_gate_closed');
    }
    return result;
  }

  async finish() {
    const result = this.gate.finish();
    if (result.kind === 'blocked') {
      await this.record(result.decision);
      return {
        kind: 'block' as const,
        publicContent: result.publicResponse.text,
        failureCode: 'POLICY_BLOCKED' as const,
      };
    }
    if (result.kind === 'closed') {
      throw new Error('teaching_output_gate_closed');
    }
    await recordWebTeachingSafetyDecision({
      identity: this.identity,
      sessionId: this.sessionId,
      turnId: this.turnId,
      decision: result.decision,
    });
    return { kind: 'emit' as const, safeDeltas: result.safeDeltas };
  }

  private async record(decision: TeachingSafetyDecision): Promise<void> {
    if (decision.action === 'allow' || decision.policyCode === 'k12_allowed') {
      throw new Error('teaching_block_decision_invalid');
    }
    const blockedDecision: BlockedTeachingSafetyDecision = {
      ...decision,
      action: decision.action,
      policyCode: decision.policyCode,
    };
    recordTeachingMetric(webTeachingObservability, {
      name: 'policy_blocks',
      value: 1,
      phase: blockedDecision.phase,
      category: blockedDecision.category,
      action: blockedDecision.action,
      policyCode: blockedDecision.policyCode,
    });
    await recordWebTeachingSafetyDecision({
      identity: this.identity,
      sessionId: this.sessionId,
      turnId: this.turnId,
      decision,
    });
  }
}

/** 创建每个教学 Turn 独享的增量输出安全门。 */
export function createWebTeachingOutputGuard(input: {
  identity: AnonymousIdentity;
  sessionId: string;
  turnId: string;
}): TurnApplicationOutputGuardPort {
  return new WebTeachingOutputGuard(
    input.identity,
    input.sessionId,
    input.turnId,
  );
}
