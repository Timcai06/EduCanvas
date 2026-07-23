import 'server-only';

import { extractAgentMessageText } from '@educanvas/agent-core';
import type {
  BuiltAssetContext,
  TurnApplicationOutputGuardPort,
  TurnApplicationProfilePort,
} from '@educanvas/agent-runtime';
import type { NotebookMembershipRole } from '@educanvas/gateway-core';
import type { LessonSessionSnapshot } from '@educanvas/teaching-core';
import {
  TEACHING_TURN_ANSWER_PROMPT_VERSION,
  TEACHING_TURN_SYNTHESIS_PROMPT_VERSION,
  createTeachingTurnPromptMessages,
} from '@educanvas/teaching-runtime';
import type { AnonymousIdentity } from '../../identity/anonymous-identity';
import { extractCitationMarkers } from '../citation-markers';
import { createWebTeachingCitationEvent } from './citations';
import { webTeachingPersistence } from './persistence';
import {
  createWebTeachingOutputGuard,
  evaluateWebTeachingPreflight,
} from './safety';
import { resolveWebTeachingToolPolicy } from './tool-policy';

const CONTEXT_PROFILE_VERSION = 'web-teaching-v2';

/** Web 教学 Profile；只装配既有上下文、Prompt、五维策略、安全门与引用结算。 */
export class WebTeachingProfile implements TurnApplicationProfilePort {
  private readonly retrievalCandidateIds: string[] = [];

  constructor(
    private readonly identity: AnonymousIdentity,
    private readonly session: LessonSessionSnapshot,
    private readonly assetContext: BuiltAssetContext,
    private readonly availableToolCapabilities: readonly string[],
    private readonly membershipRole: NotebookMembershipRole,
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
    return evaluateWebTeachingPreflight({
      identity: this.identity,
      sessionId: this.session.id,
      turnId: input.command.operationId,
      parts: input.command.input.parts,
    });
  }

  async prepare(input: Parameters<TurnApplicationProfilePort['prepare']>[0]) {
    const history = await webTeachingPersistence.chat.listRecentHistory({
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
    const environment =
      process.env.EDUCANVAS_DEPLOYMENT_ENV?.trim() || 'development';
    const profileContext = {
      studentId: this.identity.studentId,
      sessionId: this.session.id,
      knowledgeNodeId: this.session.knowledgeNodeId,
      state: this.session.state,
    };
    const toolPolicy = resolveWebTeachingToolPolicy({
      availableCapabilities: this.availableToolCapabilities,
      actorCapabilities: this.availableToolCapabilities,
      membershipRole: this.membershipRole,
      profileId: input.command.profile.profileId,
      state: this.session.state,
      channel: input.command.entrypoint,
      environment,
      environmentCapabilities: this.availableToolCapabilities,
      profileContext,
    });
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
      // command.capabilities 是传输/渲染协商，不是 Teaching Tool grant。
      toolPolicy,
    };
  }

  createOutputGuard(
    input: Parameters<
      NonNullable<TurnApplicationProfilePort['createOutputGuard']>
    >[0],
  ): TurnApplicationOutputGuardPort {
    return createWebTeachingOutputGuard({
      identity: this.identity,
      sessionId: this.session.id,
      turnId: input.command.operationId,
    });
  }

  async finalize(
    input: Parameters<NonNullable<TurnApplicationProfilePort['finalize']>>[0],
  ) {
    if (this.retrievalCandidateIds.length === 0) return {};
    const markers = extractCitationMarkers(
      input.content,
      this.retrievalCandidateIds.length,
    );
    const result =
      await webTeachingPersistence.knowledge.persistMessageCitations({
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
        createWebTeachingCitationEvent(input.command.operationId, citation),
      ),
    };
  }
}
