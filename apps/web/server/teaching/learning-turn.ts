import 'server-only';

import {
  extractAgentMessageText,
  type ModelAbortSignal,
  type TurnApplicationCommand,
  type TurnApplicationEvent,
  type TurnModelGateway,
} from '@educanvas/agent-core';
import {
  ToolKernel,
  TurnApplicationService,
  type BuiltAssetContext,
  type TurnApplicationCancellationPort,
  type TurnApplicationLifecyclePort,
  type TurnApplicationLifecycleSnapshot,
  type TurnApplicationOutputGuardPort,
  type TurnApplicationProfileEvent,
  type TurnApplicationProfilePort,
} from '@educanvas/agent-runtime';
import {
  DEFAULT_ASSISTANT_LEASE_MS,
  DrizzleAgentModelRunRepository,
  DrizzleAgentToolCallRepository,
  DrizzleAgentTurnContextRepository,
  DrizzleChatRepository,
  DrizzleKnowledgeRetrievalRepository,
  DrizzleTeachingTurnLedger,
  DrizzleToolEffectRepository,
  DrizzleTurnLeaseRepository,
  DrizzleTurnSafetyDecisionRepository,
  type ChatMessageSnapshot,
  type MessageCitationSnapshot,
  type TeachingApplicationTurnLedgerSnapshot,
} from '@educanvas/db';
import {
  evaluateTeachingInput,
  type LessonSessionSnapshot,
  type TeachingSafetyDecision,
} from '@educanvas/teaching-core';
import {
  TEACHING_TURN_ANSWER_PROMPT_VERSION,
  TEACHING_TURN_SYNTHESIS_PROMPT_VERSION,
  TeachingOutputSafetyGate,
  createTeachingTurnPromptMessages,
  recordTeachingMetric,
} from '@educanvas/teaching-runtime';
import { getWebTelemetryRuntime } from '../telemetry/telemetry-runtime';
import { materializeAssetContextPlan } from '../assets/asset-materialization';
import type { TeachingTurnRequestBody } from '../http/turn-request';
import type { AnonymousIdentity } from '../identity/anonymous-identity';
import { resolveTurnModelRuntime } from '../model/model-runtime';
import { extractCitationMarkers } from './citation-markers';
import {
  createTeachingToolKernelAdapters,
  teachingToolCapabilitiesForState,
} from './teaching-tools';
import { webTeachingObservability } from './teaching-observability';

const HEARTBEAT_INTERVAL_MS = 10_000;
const CANCELLATION_POLL_MS = 250;
const CONTEXT_PROFILE_VERSION = 'web-teaching-v2';

const ledger = new DrizzleTeachingTurnLedger();
const chat = new DrizzleChatRepository();
const leases = new DrizzleTurnLeaseRepository();
const safetyDecisions = new DrizzleTurnSafetyDecisionRepository();
const knowledge = new DrizzleKnowledgeRetrievalRepository();

const unavailableModelGateway: TurnModelGateway = {
  async *streamTurnText(request) {
    yield {
      type: 'failed',
      phase: request.phase,
      error: { code: 'unavailable', retryable: true },
    };
  },
};

type BlockedTeachingSafetyDecision = TeachingSafetyDecision & {
  action: 'block' | 'escalate';
  policyCode: Exclude<TeachingSafetyDecision['policyCode'], 'k12_allowed'>;
};

function citationEvent(
  operationId: string,
  citation: MessageCitationSnapshot,
): TurnApplicationProfileEvent {
  const pageLabel = citation.pageStart
    ? citation.pageEnd && citation.pageEnd !== citation.pageStart
      ? ` · 第${citation.pageStart}-${citation.pageEnd}页`
      : ` · 第${citation.pageStart}页`
    : '';
  return {
    protocol: 'educanvas.turn.v2',
    operationId,
    type: 'message.citation',
    messageId: citation.assistantMessageId,
    citationId: citation.id,
    marker: citation.ordinal,
    label: [...`${citation.sourceTitle}${pageLabel}`].slice(0, 160).join(''),
    target: {
      kind: 'knowledge',
      sourceId: citation.sourceId,
      documentId: citation.documentId,
      chunkId: citation.chunkId,
      pageStart: citation.pageStart,
      pageEnd: citation.pageEnd,
    },
  };
}

async function recordSafetyDecision(input: {
  identity: AnonymousIdentity;
  sessionId: string;
  turnId: string;
  decision: TeachingSafetyDecision;
}): Promise<void> {
  await safetyDecisions.record({
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

function terminalReplayEvent(
  operationId: string,
  message: ChatMessageSnapshot,
): TurnApplicationEvent {
  if (message.status === 'completed') {
    return {
      protocol: 'educanvas.turn.v2',
      operationId,
      type: 'turn.completed',
      messageId: message.id,
    };
  }
  if (message.status === 'cancelled') {
    return {
      protocol: 'educanvas.turn.v2',
      operationId,
      type: 'turn.cancelled',
      messageId: message.id,
    };
  }
  return {
    protocol: 'educanvas.turn.v2',
    operationId,
    type: 'turn.failed',
    messageId: message.id,
    code:
      message.failureCode === 'POLICY_BLOCKED'
        ? 'POLICY_BLOCKED'
        : 'RUNTIME_FAILED',
    retryable: message.failureCode !== 'POLICY_BLOCKED',
  };
}

class WebTeachingLifecycle implements TurnApplicationLifecyclePort {
  private snapshot: TeachingApplicationTurnLedgerSnapshot | null = null;

  constructor(
    private readonly identity: AnonymousIdentity,
    private readonly sessionId: string,
  ) {}

  async begin(
    command: TurnApplicationCommand,
  ): Promise<TurnApplicationLifecycleSnapshot> {
    const snapshot = await ledger.beginApplicationTurn({
      sessionId: this.sessionId,
      trustedStudentId: this.identity.studentId,
      clientMessageId: command.input.clientMessageId,
      parts: command.input.parts,
      traceId: command.traceId,
      turnId: command.operationId,
      leaseDurationMs: DEFAULT_ASSISTANT_LEASE_MS,
    });
    this.snapshot = snapshot;
    return {
      operationId: snapshot.turn.turnId,
      traceId: command.traceId,
      userMessageId: snapshot.turn.studentMessage.id,
      assistantMessageId: snapshot.turn.assistantMessage.id,
      replayed: snapshot.replayed,
    };
  }

  async replay(): Promise<readonly TurnApplicationEvent[]> {
    const snapshot = this.snapshot;
    if (!snapshot) throw new Error('web_teaching_turn_snapshot_missing');
    const assistant = snapshot.turn.assistantMessage;
    if (['pending', 'streaming'].includes(assistant.status)) {
      throw new Error('teaching_replay_requires_gateway_event_resume');
    }
    const events: TurnApplicationEvent[] = [];
    if (assistant.content) {
      events.push({
        protocol: 'educanvas.turn.v2',
        operationId: snapshot.turn.turnId,
        type: 'message.delta',
        messageId: assistant.id,
        delta: assistant.content,
      });
    }
    if (assistant.status === 'completed') {
      const citations = await knowledge.listOwnedMessageCitations({
        trustedStudentId: this.identity.studentId,
        sessionId: this.sessionId,
        turnId: snapshot.turn.turnId,
        assistantMessageId: assistant.id,
      });
      events.push(
        ...citations.map((citation) =>
          citationEvent(snapshot.turn.turnId, citation),
        ),
      );
    }
    events.push(terminalReplayEvent(snapshot.turn.turnId, assistant));
    return events;
  }

  async settle(
    input: Parameters<TurnApplicationLifecyclePort['settle']>[0],
  ): ReturnType<TurnApplicationLifecyclePort['settle']> {
    const snapshot = this.snapshot;
    const leaseId = snapshot?.leaseId;
    if (!snapshot || !leaseId) {
      throw new Error('web_teaching_turn_lease_missing');
    }
    if (input.content) {
      await chat.markAssistantStreaming({
        sessionId: this.sessionId,
        trustedStudentId: this.identity.studentId,
        assistantMessageId: input.turn.assistantMessageId,
        leaseId,
      });
      await chat.appendAssistantDelta({
        sessionId: this.sessionId,
        trustedStudentId: this.identity.studentId,
        assistantMessageId: input.turn.assistantMessageId,
        leaseId,
        delta: input.content,
      });
    }
    await chat.settleAssistantMessage({
      sessionId: this.sessionId,
      trustedStudentId: this.identity.studentId,
      assistantMessageId: input.turn.assistantMessageId,
      leaseId,
      status: input.status,
      failureCode: input.failureCode,
    });
    return [];
  }
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
    if (result.kind === 'closed')
      throw new Error('teaching_output_gate_closed');
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
    if (result.kind === 'closed')
      throw new Error('teaching_output_gate_closed');
    await recordSafetyDecision({
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
    await recordSafetyDecision({
      identity: this.identity,
      sessionId: this.sessionId,
      turnId: this.turnId,
      decision,
    });
  }
}

class WebTeachingProfile implements TurnApplicationProfilePort {
  private readonly retrievalCandidateIds: string[] = [];

  constructor(
    private readonly identity: AnonymousIdentity,
    private readonly session: LessonSessionSnapshot,
    private readonly assetContext: BuiltAssetContext,
  ) {}

  collectKnowledgeEvidence(candidateIds: readonly string[]): void {
    for (const candidateId of candidateIds) {
      if (!this.retrievalCandidateIds.includes(candidateId)) {
        this.retrievalCandidateIds.push(candidateId);
      }
    }
  }

  async preflight(
    input: Parameters<NonNullable<TurnApplicationProfilePort['preflight']>>[0],
  ) {
    const evaluation = evaluateTeachingInput(
      extractAgentMessageText(input.command.input.parts),
    );
    await recordSafetyDecision({
      identity: this.identity,
      sessionId: this.session.id,
      turnId: input.command.operationId,
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

  async prepare(input: Parameters<TurnApplicationProfilePort['prepare']>[0]) {
    const history = await chat.listRecentHistory({
      sessionId: this.session.id,
      trustedStudentId: this.identity.studentId,
      limit: 40,
    });
    const completedTurnIds = new Set(
      history
        .filter(
          (message) =>
            message.role === 'assistant' && message.status === 'completed',
        )
        .map((message) => message.turnId),
    );
    const selected = history
      .filter(
        (message) =>
          message.id === input.turn.userMessageId ||
          completedTurnIds.has(message.turnId),
      )
      .slice(-24);
    const currentText =
      extractAgentMessageText(input.command.input.parts).trim() ||
      '请分析我提供的资料。';
    const prompts = createTeachingTurnPromptMessages({
      session: this.session,
      studentMessage: currentText,
    });
    const answerSystem = prompts.answer[0];
    const synthesisSystem = prompts.synthesis[0];
    if (answerSystem?.role !== 'system' || synthesisSystem?.role !== 'system') {
      throw new Error('teaching_system_prompt_missing');
    }
    const grantedTools = teachingToolCapabilitiesForState(
      this.session.state,
    ).filter((capability) => input.command.capabilities.includes(capability));
    const capabilities = {
      actor: grantedTools,
      notebook: grantedTools,
      profile: grantedTools,
      channel: grantedTools,
      environment: grantedTools,
    };
    return {
      context: {
        profileVersion: CONTEXT_PROFILE_VERSION,
        profile: [
          {
            segment: {
              id: `profile:${CONTEXT_PROFILE_VERSION}`,
              kind: 'profile' as const,
              content: answerSystem.content,
              priority: 100,
              required: true,
            },
            message: answerSystem,
            synthesisMessage: synthesisSystem,
          },
        ],
        conversation: selected.map((message, index) => {
          const content =
            message.id === input.turn.userMessageId
              ? currentText
              : message.content;
          return {
            segment: {
              id: `message:${message.id}`,
              kind: 'conversation' as const,
              content,
              priority:
                message.id === input.turn.userMessageId ? 100 : 50 + index,
              required: message.id === input.turn.userMessageId,
              messageId: message.id,
            },
            message: {
              role:
                message.role === 'student'
                  ? ('user' as const)
                  : ('assistant' as const),
              content,
            },
          };
        }),
        sourcesAndAssets: this.assetContext.textSegments.map(
          (segment, index) => {
            const content = `<untrusted_user_material>\n${segment.text}\n</untrusted_user_material>`;
            return {
              segment: {
                id: `asset:${segment.reference.versionId}`,
                kind: 'asset' as const,
                content,
                priority: 90 - index,
                required: true,
                assetVersionId: segment.reference.versionId,
              },
              message: { role: 'user' as const, content },
            };
          },
        ),
        memory: {
          status: 'unavailable' as const,
          reason: 'not_implemented' as const,
        },
        maxSegments: 100,
        maxCharacters: 128_000,
      },
      model: {
        taskAlias: 'teaching.turn' as const,
        modelAlias: 'primary' as const,
        promptVersion: TEACHING_TURN_ANSWER_PROMPT_VERSION,
        synthesisPromptVersion: TEACHING_TURN_SYNTHESIS_PROMPT_VERSION,
        maxToolRounds: 1,
      },
      toolPolicy: {
        capabilities,
        approvedCapabilities: [],
        channel: 'web',
        environment:
          process.env.EDUCANVAS_DEPLOYMENT_ENV?.trim() || 'development',
        profileContext: {
          studentId: this.identity.studentId,
          sessionId: this.session.id,
          knowledgeNodeId: this.session.knowledgeNodeId,
          state: this.session.state,
        },
      },
    };
  }

  createOutputGuard(
    input: Parameters<
      NonNullable<TurnApplicationProfilePort['createOutputGuard']>
    >[0],
  ): TurnApplicationOutputGuardPort {
    return new WebTeachingOutputGuard(
      this.identity,
      this.session.id,
      input.command.operationId,
    );
  }

  async finalize(
    input: Parameters<NonNullable<TurnApplicationProfilePort['finalize']>>[0],
  ) {
    if (this.retrievalCandidateIds.length === 0) return {};
    const markers = extractCitationMarkers(
      input.content,
      this.retrievalCandidateIds.length,
    );
    const result = await knowledge.persistMessageCitations({
      trustedStudentId: this.identity.studentId,
      sessionId: this.session.id,
      turnId: input.command.operationId,
      assistantMessageId: input.turn.assistantMessageId,
      ...(markers.length > 0
        ? {
            candidateIds: markers.map(
              (marker) => this.retrievalCandidateIds[marker - 1]!,
            ),
            markers,
          }
        : { candidateIds: this.retrievalCandidateIds }),
    });
    return {
      events: result.citations.map((citation) =>
        citationEvent(input.command.operationId, citation),
      ),
    };
  }
}

class WebTeachingCancellation implements TurnApplicationCancellationPort {
  constructor(private readonly upstream: ModelAbortSignal) {}

  async open(input: { operationId: string; actorId: string }) {
    const snapshot = await chat.getOwnedTurnByTurnId({
      trustedStudentId: input.actorId,
      turnId: input.operationId,
    });
    const leaseId = snapshot?.assistantMessage.leaseId;
    if (!snapshot || !leaseId) throw new Error('teaching_turn_lease_missing');
    const controller = new AbortController();
    let heartbeatRunning = false;
    let cancellationRunning = false;
    const abort = () => {
      if (!controller.signal.aborted) controller.abort('turn_cancelled');
    };
    if (this.upstream.aborted) abort();
    else this.upstream.addEventListener('abort', abort, { once: true });
    const heartbeat = setInterval(() => {
      if (heartbeatRunning || controller.signal.aborted) return;
      heartbeatRunning = true;
      void leases
        .heartbeat({
          trustedStudentId: input.actorId,
          turnId: input.operationId,
          leaseId,
          leaseDurationMs: DEFAULT_ASSISTANT_LEASE_MS,
        })
        .then((renewed) => {
          if (!renewed) abort();
        })
        .catch(() => undefined)
        .finally(() => {
          heartbeatRunning = false;
        });
    }, HEARTBEAT_INTERVAL_MS);
    const cancellation = setInterval(() => {
      if (cancellationRunning || controller.signal.aborted) return;
      cancellationRunning = true;
      void chat
        .isTurnCancellationRequested({
          trustedStudentId: input.actorId,
          turnId: input.operationId,
        })
        .then((requested) => {
          if (requested) abort();
        })
        .catch(() => undefined)
        .finally(() => {
          cancellationRunning = false;
        });
    }, CANCELLATION_POLL_MS);
    return {
      signal: controller.signal,
      isCancellationRequested: async () =>
        (await chat.isTurnCancellationRequested({
          trustedStudentId: input.actorId,
          turnId: input.operationId,
        })) || this.upstream.aborted,
      close: () => {
        clearInterval(heartbeat);
        clearInterval(cancellation);
        this.upstream.removeEventListener('abort', abort);
      },
    };
  }
}

/** Web 教学入口的统一 Turn Application 组合根；教学 Profile 不再创建私有模型循环。 */
export function beginGatewayTeachingTurnApplication(input: {
  operationId: string;
  traceId: string;
  actorId: string;
  agentId: string;
  identity: AnonymousIdentity;
  session: LessonSessionSnapshot;
  conversationId: string;
  notebookId: string;
  request: TeachingTurnRequestBody;
  assetContext: BuiltAssetContext;
  signal: ModelAbortSignal;
  capabilities: readonly string[];
}): { events: AsyncIterable<TurnApplicationEvent> } {
  if (
    input.actorId !== input.identity.studentId ||
    input.session.studentId !== input.actorId
  ) {
    throw new Error('web_teaching_actor_scope_mismatch');
  }
  const profile = new WebTeachingProfile(
    input.identity,
    input.session,
    input.assetContext,
  );
  const adapters = createTeachingToolKernelAdapters((candidateIds) =>
    profile.collectKnowledgeEvidence(candidateIds),
  );
  const runtime = resolveTurnModelRuntime();
  const service = new TurnApplicationService({
    lifecycle: new WebTeachingLifecycle(input.identity, input.session.id),
    profile,
    contextLedger: new DrizzleAgentTurnContextRepository(),
    modelRunLedger: new DrizzleAgentModelRunRepository(),
    modelGateway: runtime?.gateway ?? unavailableModelGateway,
    toolKernel: new ToolKernel(
      adapters,
      new DrizzleAgentToolCallRepository(),
      new DrizzleToolEffectRepository(),
    ),
    cancellation: new WebTeachingCancellation(input.signal),
    trace: getWebTelemetryRuntime().turnTrace,
  });
  const command: TurnApplicationCommand = {
    protocol: 'educanvas.turn.v2',
    operationId: input.operationId,
    traceId: input.traceId,
    actor: { actorId: input.actorId, agentId: input.agentId },
    notebook: {
      notebookId: input.notebookId,
      conversationId: input.conversationId,
    },
    profile: { profileId: 'k12.teacher' },
    entrypoint: 'web',
    input: {
      clientMessageId: input.request.clientMessageId,
      parts: [...input.request.parts],
    },
    capabilities: [...new Set(input.capabilities)],
  };
  return { events: service.run(command) };
}

/** 在创建 Gateway Operation 前完成资产归属与模态验证，错误仍由 Web 路由清晰呈现。 */
export async function prepareGatewayTeachingTurnContext(input: {
  identity: AnonymousIdentity;
  notebookId: string;
  request: TeachingTurnRequestBody;
}): Promise<BuiltAssetContext> {
  return materializeAssetContextPlan({
    identity: input.identity,
    spaceId: input.notebookId,
    parts: input.request.parts,
  });
}
