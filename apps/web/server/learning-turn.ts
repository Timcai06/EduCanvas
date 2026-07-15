import 'server-only';

import { randomUUID } from 'node:crypto';
import {
  DEFAULT_ASSISTANT_LEASE_MS,
  DrizzleChatRepository,
  DrizzleModelRunRepository,
  DrizzleTeachingTurnLedger,
  DrizzleToolCallRepository,
  DrizzleTurnSafetyDecisionRepository,
  DrizzleTurnLeaseRepository,
  LearningSessionOwnershipError,
  normalizeStudentMessageContent,
  type ChatMessageSnapshot,
  type TeachingTurnLedgerSnapshot,
  type ToolCallSnapshot,
} from '@educanvas/db';
import {
  evaluateTeachingInput,
  type TeachingSafetyDecision,
  type TurnModelEvent,
} from '@educanvas/teaching-core';
import {
  TeachingOutputSafetyGate,
  TeachingTurnOrchestrator,
  createTeachingTurnAnswerPromptMaterial,
  recordTeachingMetric,
  type TeachingTurnRejectionCode,
  type TeachingTurnToolFailure,
} from '@educanvas/teaching-runtime';
import type { TeachingTurnEvent } from '@/features/chat/turn-events';
import type { AnonymousIdentity } from './anonymous-identity';
import { AuditedTurnModelGateway } from './audited-model-gateway';
import { loadOwnedTeachingSession } from './learning-session';
import { resolveTurnModelRuntime } from './model-runtime';
import { hashPromptMaterial } from './prompt-hash';
import { createTeachingToolExecutor } from './teaching-tools';
import { webTeachingObservability } from './teaching-observability';
import { registerTurnAbortController } from './turn-abort-registry';

const ledger = new DrizzleTeachingTurnLedger();
const chat = new DrizzleChatRepository();
const modelRuns = new DrizzleModelRunRepository();
const leases = new DrizzleTurnLeaseRepository();
const toolCalls = new DrizzleToolCallRepository();
const safetyDecisions = new DrizzleTurnSafetyDecisionRepository();

const HEARTBEAT_INTERVAL_MS = 10_000;
const CANCELLATION_POLL_MS = 500;
const REPLAY_POLL_MS = 150;

export interface StartedOwnedTeachingTurn {
  turnId: string;
  replayed: boolean;
  events: AsyncIterable<TeachingTurnEvent>;
}

interface PreparedTurn {
  identity: AnonymousIdentity;
  ledger: TeachingTurnLedgerSnapshot;
  session: NonNullable<Awaited<ReturnType<typeof loadOwnedTeachingSession>>>;
  studentMessage: string;
  toolExecutor: ReturnType<typeof createTeachingToolExecutor>;
  modelRuntime: ReturnType<typeof resolveTurnModelRuntime>;
}

interface ToolAuditState {
  providerCallId: string;
  tool: string;
  argumentsJson: string;
  finalized: boolean;
  canRun: boolean;
  record: ToolCallSnapshot | null;
  startedAt: number | null;
}

const delay = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

const failurePresentation = (
  code: string,
): { message: string; retryable: boolean } => {
  switch (code) {
    case 'rate_limit':
    case 'turn_rate_limited':
      return { message: '现在提问的人有点多，请稍后再试。', retryable: true };
    case 'timeout':
      return { message: 'AI 老师这次思考超时了，请再试一次。', retryable: true };
    case 'content_filtered':
      return {
        message: '这个问题暂时不能这样回答，我们可以换一种安全的问法。',
        retryable: false,
      };
    case 'interrupted':
    case 'lease_expired':
    case 'stream_interrupted':
      return { message: '回答已中断，可以重新发送。', retryable: true };
    case 'model_not_configured':
      return { message: 'AI 老师暂时无法连接，请稍后重试。', retryable: true };
    case 'aborted':
      return { message: '回答已停止。', retryable: false };
    default:
      return { message: 'AI 老师暂时无法回答，请稍后重试。', retryable: true };
  }
};

function acceptedEvent(snapshot: TeachingTurnLedgerSnapshot): TeachingTurnEvent {
  return {
    type: 'turn.accepted',
    schemaVersion: '1',
    turnId: snapshot.turn.turnId,
    studentMessageId: snapshot.turn.studentMessage.id,
    assistantMessageId: snapshot.turn.assistantMessage.id,
    replayed: snapshot.replayed,
  };
}

function terminalEventForMessage(
  message: ChatMessageSnapshot,
  fallbackCode = 'model_gateway_failed',
): TeachingTurnEvent {
  if (message.status === 'completed') {
    return {
      type: 'turn.completed',
      schemaVersion: '1',
      turnId: message.turnId,
      messageId: message.id,
    };
  }
  if (message.status === 'cancelled') {
    return {
      type: 'turn.cancelled',
      schemaVersion: '1',
      turnId: message.turnId,
      messageId: message.id,
    };
  }
  const code =
    message.status === 'interrupted'
      ? 'interrupted'
      : (message.failureCode ?? fallbackCode);
  const presentation =
    code.startsWith('k12_') && message.content.trim()
      ? { message: message.content, retryable: false }
      : failurePresentation(code);
  return {
    type: 'turn.failed',
    schemaVersion: '1',
    turnId: message.turnId,
    messageId: message.id,
    code,
    message: presentation.message,
    retryable: presentation.retryable,
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

async function* replayTurn(
  identity: AnonymousIdentity,
  snapshot: TeachingTurnLedgerSnapshot,
): AsyncIterable<TeachingTurnEvent> {
  yield acceptedEvent(snapshot);
  let current = snapshot.turn.assistantMessage;
  let emittedText = '';
  let lastConvergence = 0;

  while (true) {
    if (!current.content.startsWith(emittedText)) {
      yield terminalEventForMessage(current, 'invalid_persisted_stream');
      return;
    }
    const delta = current.content.slice(emittedText.length);
    if (delta) {
      emittedText = current.content;
      yield {
        type: 'message.delta',
        schemaVersion: '1',
        turnId: current.turnId,
        messageId: current.id,
        delta,
      };
    }
    if (!['pending', 'streaming'].includes(current.status)) {
      yield terminalEventForMessage(current);
      return;
    }

    await delay(REPLAY_POLL_MS);
    if (Date.now() - lastConvergence >= 2_000) {
      lastConvergence = Date.now();
      await leases.convergeExpired({ limit: 25 }).catch(() => undefined);
    }
    const refreshed = await chat.getOwnedTurnByTurnId({
      trustedStudentId: identity.studentId,
      turnId: snapshot.turn.turnId,
    });
    if (!refreshed) {
      yield {
        type: 'turn.failed',
        schemaVersion: '1',
        turnId: current.turnId,
        messageId: current.id,
        code: 'turn_not_found',
        message: '这次回答已经不可用，请重新发送。',
        retryable: true,
      };
      return;
    }
    current = refreshed.assistantMessage;
  }
}

function stableToolExecutionId(input: {
  sessionId: string;
  turnId: string;
  providerCallId: string;
}): string {
  return `${input.sessionId}:${input.turnId}:${input.providerCallId}`;
}

function toolLabel(tool: string): string | undefined {
  if (tool === 'getStudentState') return '正在查看学习进度';
  return undefined;
}

async function settleUnfinishedToolAudits(
  identity: AnonymousIdentity,
  audits: Map<string, ToolAuditState>,
  failures: readonly TeachingTurnToolFailure[] | undefined,
  fallbackCode: TeachingTurnRejectionCode,
): Promise<void> {
  const failureByExecution = new Map(
    (failures ?? []).map((failure) => [failure.executionId, failure]),
  );
  for (const audit of audits.values()) {
    if (
      !audit.record ||
      !['pending', 'running'].includes(audit.record.status)
    ) {
      continue;
    }
    const failure = failureByExecution.get(audit.record.executionId);
    await toolCalls
      .settle({
        trustedStudentId: identity.studentId,
        toolCallId: audit.record.id,
        status: audit.record.status === 'running' ? 'failed' : 'rejected',
        code: failure?.code ?? fallbackCode,
        retryable: failure?.retryable ?? false,
        durationMs: Math.max(0, Date.now() - (audit.startedAt ?? Date.now())),
      })
      .catch(() => undefined);
  }
}

function startKeepAlive(input: {
  identity: AnonymousIdentity;
  turnId: string;
  leaseId: string;
  controller: AbortController;
}): () => void {
  let heartbeatRunning = false;
  let cancellationRunning = false;
  const heartbeat = setInterval(() => {
    if (heartbeatRunning || input.controller.signal.aborted) return;
    heartbeatRunning = true;
    void leases
      .heartbeat({
        trustedStudentId: input.identity.studentId,
        turnId: input.turnId,
        leaseId: input.leaseId,
        leaseDurationMs: DEFAULT_ASSISTANT_LEASE_MS,
      })
      .then((renewed) => {
        if (!renewed && !input.controller.signal.aborted) {
          input.controller.abort('lease_lost');
        }
      })
      .catch(() => undefined)
      .finally(() => {
        heartbeatRunning = false;
      });
  }, HEARTBEAT_INTERVAL_MS);
  const cancellation = setInterval(() => {
    if (cancellationRunning || input.controller.signal.aborted) return;
    cancellationRunning = true;
    void chat
      .isTurnCancellationRequested({
        trustedStudentId: input.identity.studentId,
        turnId: input.turnId,
      })
      .then((requested) => {
        if (requested && !input.controller.signal.aborted) {
          input.controller.abort('explicit_student_stop');
        }
      })
      .catch(() => undefined)
      .finally(() => {
        cancellationRunning = false;
      });
  }, CANCELLATION_POLL_MS);
  return () => {
    clearInterval(heartbeat);
    clearInterval(cancellation);
  };
}

async function* runFreshTurn(
  prepared: PreparedTurn,
): AsyncIterable<TeachingTurnEvent> {
  const snapshot = prepared.ledger;
  const assistant = snapshot.turn.assistantMessage;
  const leaseId = snapshot.leaseId;
  if (!leaseId) throw new Error('fresh_turn_missing_lease');
  yield acceptedEvent(snapshot);

  const inputSafety = evaluateTeachingInput(prepared.studentMessage);
  await recordSafetyDecision({
    identity: prepared.identity,
    sessionId: assistant.sessionId,
    turnId: snapshot.turn.turnId,
    decision: inputSafety.decision,
  });
  if (!inputSafety.allowed) {
    if (inputSafety.decision.policyCode !== 'k12_allowed') {
      recordTeachingMetric(webTeachingObservability, {
        name: 'policy_blocks',
        value: 1,
        phase: inputSafety.decision.phase,
        category: inputSafety.decision.category,
        action: inputSafety.decision.action,
        policyCode: inputSafety.decision.policyCode,
      });
    }
    await modelRuns.settle({
      sessionId: assistant.sessionId,
      trustedStudentId: prepared.identity.studentId,
      runId: snapshot.answerRun.id,
      status: 'failed',
      errorCode: inputSafety.decision.policyCode,
    });
    await chat.markAssistantStreaming({
      sessionId: assistant.sessionId,
      trustedStudentId: prepared.identity.studentId,
      assistantMessageId: assistant.id,
      leaseId,
    });
    await chat.appendAssistantDelta({
      sessionId: assistant.sessionId,
      trustedStudentId: prepared.identity.studentId,
      assistantMessageId: assistant.id,
      leaseId,
      delta: inputSafety.publicResponse.text,
    });
    const settled = await chat.settleAssistantMessage({
      sessionId: assistant.sessionId,
      trustedStudentId: prepared.identity.studentId,
      assistantMessageId: assistant.id,
      leaseId,
      status: 'failed',
      failureCode: inputSafety.decision.policyCode,
    });
    yield {
      type: 'message.delta',
      schemaVersion: '1',
      turnId: snapshot.turn.turnId,
      messageId: assistant.id,
      delta: inputSafety.publicResponse.text,
    };
    yield terminalEventForMessage(
      settled.message,
      inputSafety.decision.policyCode,
    );
    return;
  }

  if (!prepared.modelRuntime) {
    await modelRuns.settle({
      sessionId: assistant.sessionId,
      trustedStudentId: prepared.identity.studentId,
      runId: snapshot.answerRun.id,
      status: 'failed',
      errorCode: 'model_not_configured',
    });
    const settled = await chat.settleAssistantMessage({
      sessionId: assistant.sessionId,
      trustedStudentId: prepared.identity.studentId,
      assistantMessageId: assistant.id,
      leaseId,
      status: 'failed',
      failureCode: 'model_not_configured',
    });
    yield terminalEventForMessage(settled.message, 'model_not_configured');
    return;
  }

  const controller = new AbortController();
  const unregisterAbort = registerTurnAbortController(
    snapshot.turn.turnId,
    controller,
  );
  const stopKeepAlive = startKeepAlive({
    identity: prepared.identity,
    turnId: snapshot.turn.turnId,
    leaseId,
    controller,
  });
  const gateway = new AuditedTurnModelGateway(prepared.modelRuntime.gateway, {
    trustedStudentId: prepared.identity.studentId,
    sessionId: assistant.sessionId,
    turnId: snapshot.turn.turnId,
    assistantMessageId: assistant.id,
    traceId: snapshot.answerRun.traceId,
    provider: prepared.modelRuntime.provider,
    answerRun: snapshot.answerRun,
  });
  const orchestrator = new TeachingTurnOrchestrator(
    gateway,
    prepared.toolExecutor,
  );
  const toolAudits = new Map<string, ToolAuditState>();
  const modelTools = prepared.toolExecutor.listModelTools(
    prepared.session.state,
  );
  const descriptors = new Map<string, (typeof modelTools)[number]>(
    modelTools.map((descriptor) => [descriptor.name, descriptor]),
  );
  const outputSafety = new TeachingOutputSafetyGate();
  let assistantStreaming = false;

  try {
    for await (const event of orchestrator.streamTurn(
      prepared.identity.studentId,
      {
        traceId: snapshot.answerRun.traceId,
        turnId: snapshot.turn.turnId,
        session: prepared.session,
        studentMessage: prepared.studentMessage,
      },
      { signal: controller.signal },
    )) {
      if (event.type === 'model') {
        const modelEvent: TurnModelEvent = event.event;
        if (modelEvent.type === 'text_delta') {
          const safetyResult = outputSafety.push(modelEvent.delta);
          if (safetyResult.kind === 'hold') continue;
          if (safetyResult.kind === 'closed') {
            throw new Error('output_safety_gate_closed');
          }
          if (safetyResult.kind === 'blocked') {
            if (safetyResult.decision.policyCode !== 'k12_allowed') {
              recordTeachingMetric(webTeachingObservability, {
                name: 'policy_blocks',
                value: 1,
                phase: safetyResult.decision.phase,
                category: safetyResult.decision.category,
                action: safetyResult.decision.action,
                policyCode: safetyResult.decision.policyCode,
              });
            }
            await recordSafetyDecision({
              identity: prepared.identity,
              sessionId: assistant.sessionId,
              turnId: snapshot.turn.turnId,
              decision: safetyResult.decision,
            });
            const hadVisibleContent = assistantStreaming;
            if (!hadVisibleContent) {
              await chat.markAssistantStreaming({
                sessionId: assistant.sessionId,
                trustedStudentId: prepared.identity.studentId,
                assistantMessageId: assistant.id,
                leaseId,
              });
              assistantStreaming = true;
            }
            const prefix = hadVisibleContent ? '\n\n' : '';
            const publicDelta = `${prefix}${safetyResult.publicResponse.text}`;
            await chat.appendAssistantDelta({
              sessionId: assistant.sessionId,
              trustedStudentId: prepared.identity.studentId,
              assistantMessageId: assistant.id,
              leaseId,
              delta: publicDelta,
            });
            controller.abort('safety_output_blocked');
            await modelRuns
              .settle({
                sessionId: assistant.sessionId,
                trustedStudentId: prepared.identity.studentId,
                runId: snapshot.answerRun.id,
                status: 'failed',
                errorCode: safetyResult.decision.policyCode,
              })
              .catch(() => undefined);
            const settled = await chat.settleAssistantMessage({
              sessionId: assistant.sessionId,
              trustedStudentId: prepared.identity.studentId,
              assistantMessageId: assistant.id,
              leaseId,
              status: 'failed',
              failureCode: safetyResult.decision.policyCode,
            });
            yield {
              type: 'message.delta',
              schemaVersion: '1',
              turnId: snapshot.turn.turnId,
              messageId: assistant.id,
              delta: publicDelta,
            };
            yield terminalEventForMessage(
              settled.message,
              safetyResult.decision.policyCode,
            );
            return;
          }
          if (!assistantStreaming) {
            const marked = await chat.markAssistantStreaming({
              sessionId: assistant.sessionId,
              trustedStudentId: prepared.identity.studentId,
              assistantMessageId: assistant.id,
              leaseId,
            });
            if (!['streaming'].includes(marked.message.status)) {
              throw new Error('assistant_stream_not_available');
            }
            assistantStreaming = true;
          }
          for (const safeDelta of safetyResult.safeDeltas) {
            await chat.appendAssistantDelta({
              sessionId: assistant.sessionId,
              trustedStudentId: prepared.identity.studentId,
              assistantMessageId: assistant.id,
              leaseId,
              delta: safeDelta,
            });
            yield {
              type: 'message.delta',
              schemaVersion: '1',
              turnId: snapshot.turn.turnId,
              messageId: assistant.id,
              delta: safeDelta,
            };
          }
          continue;
        }

        if (modelEvent.type === 'tool_call') {
          const existing = toolAudits.get(modelEvent.callId) ?? {
            providerCallId: modelEvent.callId,
            tool: modelEvent.tool,
            argumentsJson: '',
            finalized: false,
            canRun: false,
            record: null,
            startedAt: null,
          };
          if (existing.tool !== modelEvent.tool || existing.finalized) {
            throw new Error('invalid_tool_fragment_order');
          }
          existing.argumentsJson += modelEvent.argumentsDelta;
          toolAudits.set(modelEvent.callId, existing);
          if (modelEvent.done) {
            existing.finalized = true;
            let parsedArguments: unknown = existing.argumentsJson;
            try {
              parsedArguments = JSON.parse(existing.argumentsJson) as unknown;
            } catch {
              // 原始字符串也只会进入不可逆结构摘要，不会持久化正文。
            }
            const descriptor = descriptors.get(modelEvent.tool);
            existing.canRun = Boolean(
              descriptor?.inputSchema.safeParse(parsedArguments).success,
            );
            const created = await toolCalls.createOrGet({
              trustedStudentId: prepared.identity.studentId,
              answerModelRunId: snapshot.answerRun.id,
              providerToolCallId: modelEvent.callId,
              executionId: stableToolExecutionId({
                sessionId: assistant.sessionId,
                turnId: snapshot.turn.turnId,
                providerCallId: modelEvent.callId,
              }),
              toolName: modelEvent.tool,
              teachingState: prepared.session.state,
              exposure: descriptor ? 'model' : null,
              effect: descriptor ? 'read' : null,
              arguments: parsedArguments,
            });
            existing.record = created.call;
          }
          continue;
        }

        if (
          modelEvent.type === 'completed' &&
          modelEvent.phase === 'answer' &&
          toolAudits.size > 0
        ) {
          const audits = [...toolAudits.values()];
          if (audits.every((audit) => audit.finalized && audit.canRun)) {
            for (const audit of audits) {
              if (!audit.record) throw new Error('tool_audit_missing');
              const running = await toolCalls.markRunning({
                trustedStudentId: prepared.identity.studentId,
                toolCallId: audit.record.id,
              });
              audit.record = running.call;
              audit.startedAt = Date.now();
              yield {
                type: 'tool.started',
                schemaVersion: '1',
                turnId: snapshot.turn.turnId,
                toolCallId: running.call.id,
                ...(toolLabel(audit.tool)
                  ? { label: toolLabel(audit.tool) }
                  : {}),
              };
            }
          }
        }
        continue;
      }

      if (event.type === 'tool_result') {
        const audit = toolAudits.get(event.callId);
        if (!audit?.record) throw new Error('tool_result_without_audit');
        const durationMs = Math.max(
          0,
          Math.round(event.result.audit.durationMs),
        );
        if (event.result.ok) {
          const settled = await toolCalls.settle({
            trustedStudentId: prepared.identity.studentId,
            toolCallId: audit.record.id,
            status: 'succeeded',
            durationMs,
            result: event.result.output,
          });
          audit.record = settled.call;
          yield {
            type: 'tool.completed',
            schemaVersion: '1',
            turnId: snapshot.turn.turnId,
            toolCallId: audit.record.id,
            ...(toolLabel(audit.tool) ? { label: toolLabel(audit.tool) } : {}),
          };
        } else {
          const status =
            event.result.code === 'WRITE_TIMEOUT_OUTCOME_UNKNOWN'
              ? 'outcome_unknown'
              : event.result.audit.status === 'rejected'
                ? 'rejected'
                : 'failed';
          const settled = await toolCalls.settle({
            trustedStudentId: prepared.identity.studentId,
            toolCallId: audit.record.id,
            status,
            code: event.result.code,
            retryable: event.result.retryable,
            durationMs,
          });
          audit.record = settled.call;
          yield {
            type: 'tool.failed',
            schemaVersion: '1',
            turnId: snapshot.turn.turnId,
            toolCallId: audit.record.id,
            code: event.result.code,
          };
        }
        continue;
      }

      if (event.type === 'completed') {
        const safetyResult = outputSafety.finish();
        if (safetyResult.kind !== 'complete') {
          throw new Error('output_safety_gate_incomplete');
        }
        for (const safeDelta of safetyResult.safeDeltas) {
          if (!assistantStreaming) {
            await chat.markAssistantStreaming({
              sessionId: assistant.sessionId,
              trustedStudentId: prepared.identity.studentId,
              assistantMessageId: assistant.id,
              leaseId,
            });
            assistantStreaming = true;
          }
          await chat.appendAssistantDelta({
            sessionId: assistant.sessionId,
            trustedStudentId: prepared.identity.studentId,
            assistantMessageId: assistant.id,
            leaseId,
            delta: safeDelta,
          });
          yield {
            type: 'message.delta',
            schemaVersion: '1',
            turnId: snapshot.turn.turnId,
            messageId: assistant.id,
            delta: safeDelta,
          };
        }
        await recordSafetyDecision({
          identity: prepared.identity,
          sessionId: assistant.sessionId,
          turnId: snapshot.turn.turnId,
          decision: safetyResult.decision,
        });
        const settled = await chat.settleAssistantMessage({
          sessionId: assistant.sessionId,
          trustedStudentId: prepared.identity.studentId,
          assistantMessageId: assistant.id,
          leaseId,
          status: 'completed',
        });
        recordTeachingMetric(webTeachingObservability, {
          name: 'provider_calls_per_completed_turn',
          value: event.modelRunCount,
          taskAlias: 'teaching.turn',
          modelAlias: 'primary',
        });
        yield terminalEventForMessage(settled.message);
        return;
      }

      const cancellationRequested =
        event.code === 'MODEL_ABORTED' &&
        (await chat.isTurnCancellationRequested({
          trustedStudentId: prepared.identity.studentId,
          turnId: snapshot.turn.turnId,
        }));
      const status = cancellationRequested
        ? 'cancelled'
        : event.code === 'MODEL_ABORTED'
          ? 'interrupted'
          : 'failed';
      const failureCode = event.error?.code ?? event.code.toLowerCase();
      await settleUnfinishedToolAudits(
        prepared.identity,
        toolAudits,
        event.failures,
        event.code,
      );
      const settled = await chat.settleAssistantMessage({
        sessionId: assistant.sessionId,
        trustedStudentId: prepared.identity.studentId,
        assistantMessageId: assistant.id,
        leaseId,
        status,
        failureCode,
      });
      yield terminalEventForMessage(settled.message, failureCode);
      return;
    }
  } catch {
    const cancellationRequested = await chat
      .isTurnCancellationRequested({
        trustedStudentId: prepared.identity.studentId,
        turnId: snapshot.turn.turnId,
      })
      .catch(() => false);
    const status = cancellationRequested
      ? 'cancelled'
      : controller.signal.aborted
        ? 'interrupted'
        : 'failed';
    const failureCode =
      status === 'cancelled'
        ? 'aborted'
        : status === 'interrupted'
          ? 'stream_interrupted'
          : 'turn_runtime_failed';
    await modelRuns
      .settle({
        sessionId: assistant.sessionId,
        trustedStudentId: prepared.identity.studentId,
        runId: snapshot.answerRun.id,
        status,
        errorCode: failureCode,
      })
      .catch(() => undefined);
    const settled = await chat
      .settleAssistantMessage({
        sessionId: assistant.sessionId,
        trustedStudentId: prepared.identity.studentId,
        assistantMessageId: assistant.id,
        leaseId,
        status,
        failureCode,
      })
      .catch(() => null);
    yield terminalEventForMessage(settled?.message ?? assistant, failureCode);
  } finally {
    stopKeepAlive();
    unregisterAbort();
  }
}

export async function beginOwnedTeachingTurn(
  identity: AnonymousIdentity,
  input: { clientMessageId: string; text: string },
): Promise<StartedOwnedTeachingTurn> {
  await leases.convergeExpired({ limit: 25 });
  const session = await loadOwnedTeachingSession(identity);
  if (!session) throw new LearningSessionOwnershipError();
  const studentMessage = normalizeStudentMessageContent(input.text);
  const toolExecutor = createTeachingToolExecutor();
  const promptMaterial = createTeachingTurnAnswerPromptMaterial(
    { session, studentMessage },
    toolExecutor.listModelTools(session.state),
  );
  const modelRuntime = resolveTurnModelRuntime();
  const traceId = randomUUID();
  const turnLedger = await ledger.beginOrReplay({
    sessionId: session.id,
    trustedStudentId: identity.studentId,
    clientMessageId: input.clientMessageId,
    text: studentMessage,
    traceId,
    modelAlias: promptMaterial.modelAlias,
    promptVersion: promptMaterial.promptVersion,
    promptHash: hashPromptMaterial(promptMaterial),
    provider: modelRuntime?.provider ?? null,
    leaseDurationMs: DEFAULT_ASSISTANT_LEASE_MS,
  });
  const prepared: PreparedTurn = {
    identity,
    ledger: turnLedger,
    session,
    studentMessage,
    toolExecutor,
    modelRuntime,
  };
  return {
    turnId: turnLedger.turn.turnId,
    replayed: turnLedger.replayed,
    events: turnLedger.replayed
      ? replayTurn(identity, turnLedger)
      : runFreshTurn(prepared),
  };
}
