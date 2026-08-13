import { describe, expect, it } from 'vitest';
import {
  buildK12ParityAuditResult,
  countInvalidK12Provenance,
  isK12ProjectionCandidateId,
  type K12ProvenanceAuditRow,
  summarizeK12ParityPage,
} from './k12-conversation-parity';
import { deterministicConversationMessageId } from './k12-conversation-message-identity';

const conversationId = '10000000-0000-4000-8000-000000000001';
const sessionId = '20000000-0000-4000-8000-000000000001';
const sourceId = '30000000-0000-4000-8000-000000000001';
const operationId = '40000000-0000-4000-8000-000000000001';
const createdAt = new Date('2026-08-13T00:00:00.000Z');
const secret = 'provider-secret-sk-do-not-return';

const source = {
  id: sourceId,
  sessionId,
  role: 'student',
  status: 'completed',
  content: secret,
  failureCode: null,
  createdAt,
  completedAt: createdAt,
  operationId,
};

const projection = {
  sourceChatMessageId: sourceId,
  conversationMessageId: deterministicConversationMessageId(sourceId),
  sessionId,
  conversationId,
};

const platform = {
  id: projection.conversationMessageId,
  conversationId,
  operationId,
  role: 'user',
  status: 'completed',
  content: secret,
  parts: [{ type: 'text' as const, text: secret }],
  failureCode: null,
  createdAt,
  completedAt: createdAt,
};

const provenance: K12ProvenanceAuditRow = {
  sourceChatMessageId: sourceId,
  conversationMessageId: projection.conversationMessageId,
  projectionSessionId: sessionId,
  projectionConversationId: conversationId,
  sourceId,
  sourceSessionId: sessionId,
  sourceConversationId: conversationId,
  platformId: projection.conversationMessageId,
  platformConversationId: conversationId,
};

function summarize(input?: {
  sourceRows?: readonly (typeof source)[];
  projectionRows?: readonly (typeof projection)[];
  platformRows?: readonly (typeof platform)[];
}) {
  return summarizeK12ParityPage({
    conversationId,
    sourceRows: input?.sourceRows ?? [source],
    sourceParts: new Map(),
    projectionRows: input?.projectionRows ?? [projection],
    platformRows: input?.platformRows ?? [platform],
  });
}

describe('K12 conversation parity readiness', () => {
  it('返回 available 数字孤儿计数，不再出现 unavailable', () => {
    const result = buildK12ParityAuditResult({
      conversationId,
      sessionCount: 1,
      scannedMessageCount: 1,
      summary: summarize(),
      orphanCount: 0,
      nextCursor: null,
      startedAtBeginning: true,
    });

    expect(result).toMatchObject({
      orphanedConversationMessages: 0,
      orphanDetection: { status: 'available', count: 0 },
      readCutoverEligible: true,
    });
    expect(JSON.stringify(result)).not.toContain('unavailable');
  });

  it('忽略没有 K12 provenance mapping 的原生平台消息', () => {
    const nativePlatform = {
      ...platform,
      id: '50000000-0000-4000-8000-000000000001',
    };
    const summary = summarizeK12ParityPage({
      conversationId,
      sourceRows: [],
      sourceParts: new Map(),
      projectionRows: [],
      platformRows: [nativePlatform],
    });

    expect(summary).toEqual({
      dualWrittenCount: 0,
      missingInConversation: 0,
      mismatchedInConversation: 0,
    });
    expect(isK12ProjectionCandidateId(nativePlatform.id)).toBe(false);
    expect(isK12ProjectionCandidateId(projection.conversationMessageId)).toBe(
      true,
    );
  });

  it('sidecar 为空时未知 v8 平台消息必须作为 orphan fail-closed', () => {
    const result = buildK12ParityAuditResult({
      conversationId,
      sessionCount: 1,
      scannedMessageCount: 0,
      summary: summarize({
        sourceRows: [],
        projectionRows: [],
        platformRows: [],
      }),
      orphanCount: isK12ProjectionCandidateId(projection.conversationMessageId)
        ? 1
        : 0,
      nextCursor: null,
      startedAtBeginning: true,
    });

    expect(result.orphanDetection.count).toBe(1);
    expect(result.readCutoverEligible).toBe(false);
  });

  it.each([
    ['source 缺失', { sourceId: null }],
    ['source session 漂移', { sourceSessionId: sourceId }],
    ['source lesson conversation 漂移', { sourceConversationId: sessionId }],
    ['platform 缺失', { platformId: null }],
    ['platform conversation 漂移', { platformConversationId: sessionId }],
    ['platform/deterministic ID 漂移', { conversationMessageId: sourceId }],
  ] satisfies readonly [string, Partial<K12ProvenanceAuditRow>][])(
    '%s 计入 invalid provenance',
    (_label, drift) => {
      expect(countInvalidK12Provenance([{ ...provenance, ...drift }])).toBe(1);
    },
  );

  it('完整一致的 sidecar provenance 不计 orphan', () => {
    expect(countInvalidK12Provenance([provenance])).toBe(0);
  });

  it('mapping 指向已不存在的源消息时阻断 readiness', () => {
    const result = buildK12ParityAuditResult({
      conversationId,
      sessionCount: 1,
      scannedMessageCount: 0,
      summary: summarize({
        sourceRows: [],
        projectionRows: [],
        platformRows: [],
      }),
      orphanCount: 1,
      nextCursor: null,
      startedAtBeginning: true,
    });

    expect(result.orphanDetection).toEqual({ status: 'available', count: 1 });
    expect(result.orphanedConversationMessages).toBe(1);
    expect(result.readCutoverEligible).toBe(false);
  });

  it('即使当前页零差异，非末页也不能 ready', () => {
    const result = buildK12ParityAuditResult({
      conversationId,
      sessionCount: 1,
      scannedMessageCount: 1,
      summary: summarize(),
      orphanCount: 0,
      nextCursor: { createdAt: createdAt.toISOString(), messageId: sourceId },
      startedAtBeginning: true,
    });

    expect(result.readCutoverEligible).toBe(false);
  });

  it('没有 K12 session 的空 conversation 不能 ready', () => {
    const result = buildK12ParityAuditResult({
      conversationId,
      sessionCount: 0,
      scannedMessageCount: 0,
      summary: summarize({
        sourceRows: [],
        projectionRows: [],
        platformRows: [],
      }),
      orphanCount: 0,
      nextCursor: null,
      startedAtBeginning: true,
    });

    expect(result.readCutoverEligible).toBe(false);
  });

  it('缺 mapping 或缺 platform 都计 missing，mapping 作用域漂移计 mismatch', () => {
    expect(summarize({ projectionRows: [], platformRows: [] })).toMatchObject({
      missingInConversation: 1,
      mismatchedInConversation: 0,
    });
    expect(summarize({ platformRows: [] })).toMatchObject({
      missingInConversation: 1,
      mismatchedInConversation: 0,
    });
    expect(
      summarize({
        projectionRows: [{ ...projection, sessionId: sourceId }],
      }),
    ).toMatchObject({
      missingInConversation: 0,
      mismatchedInConversation: 1,
    });
  });

  it('响应只保留计数，不泄露正文、secret 或 stack', () => {
    const result = buildK12ParityAuditResult({
      conversationId,
      sessionCount: 1,
      scannedMessageCount: 1,
      summary: summarize(),
      orphanCount: 0,
      nextCursor: null,
      startedAtBeginning: true,
    });
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain('stack');
    expect(serialized).not.toContain('content');
    expect(serialized).not.toContain('parts');
  });
});
