import { describe, expect, it } from 'vitest';
import {
  gatewayHandoffCredentialSchema,
  gatewayHandoffIssueRequestSchema,
} from './handoffs';

const uuid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

describe('Gateway handoff contracts', () => {
  it('accepts only a bounded opaque credential', () => {
    expect(
      gatewayHandoffCredentialSchema.parse({
        token: 'a'.repeat(43),
        expiresAt: '2026-07-21T08:02:00.000Z',
      }),
    ).toEqual({
      token: 'a'.repeat(43),
      expiresAt: '2026-07-21T08:02:00.000Z',
    });
    expect(() =>
      gatewayHandoffCredentialSchema.parse({
        token: 'conversation:1',
        expiresAt: '2026-07-21T08:02:00.000Z',
      }),
    ).toThrow();
  });

  it('does not accept ownership or expiry claims from the client', () => {
    expect(() =>
      gatewayHandoffIssueRequestSchema.parse({
        conversationId: 'conversation:1',
        userId: 'attacker:chosen',
        expiresAt: '2099-01-01T00:00:00.000Z',
      }),
    ).toThrow();
  });

  it('accepts a conversation-only request without a target (backward compatible)', () => {
    expect(
      gatewayHandoffIssueRequestSchema.parse({
        conversationId: 'conversation:1',
      }),
    ).toEqual({ conversationId: 'conversation:1' });
  });

  it('accepts an explicit conversation target', () => {
    expect(
      gatewayHandoffIssueRequestSchema.parse({
        conversationId: 'conversation:1',
        target: { kind: 'conversation' },
      }),
    ).toEqual({
      conversationId: 'conversation:1',
      target: { kind: 'conversation' },
    });
  });

  it('accepts message, artifact and resource targets', () => {
    expect(
      gatewayHandoffIssueRequestSchema.parse({
        conversationId: 'conversation:1',
        target: { kind: 'message', messageId: uuid },
      }),
    ).toMatchObject({ target: { kind: 'message', messageId: uuid } });
    expect(
      gatewayHandoffIssueRequestSchema.parse({
        conversationId: 'conversation:1',
        target: { kind: 'artifact', artifactId: uuid, versionId: null },
      }),
    ).toMatchObject({ target: { kind: 'artifact', artifactId: uuid } });
    expect(
      gatewayHandoffIssueRequestSchema.parse({
        conversationId: 'conversation:1',
        target: {
          kind: 'artifact',
          artifactId: uuid,
          versionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        },
      }),
    ).toMatchObject({ target: { kind: 'artifact' } });
    expect(
      gatewayHandoffIssueRequestSchema.parse({
        conversationId: 'conversation:1',
        target: {
          kind: 'resource',
          resourceKind: 'source',
          resourceId: uuid,
          versionId: null,
        },
      }),
    ).toMatchObject({
      target: { kind: 'resource', resourceKind: 'source', resourceId: uuid },
    });
    expect(
      gatewayHandoffIssueRequestSchema.parse({
        conversationId: 'conversation:1',
        target: {
          kind: 'resource',
          resourceKind: 'artifact',
          resourceId: uuid,
          versionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        },
      }),
    ).toMatchObject({ target: { kind: 'resource', resourceKind: 'artifact' } });
  });

  it('rejects unknown target kinds and malformed target ids', () => {
    expect(() =>
      gatewayHandoffIssueRequestSchema.parse({
        conversationId: 'conversation:1',
        target: { kind: 'exploit', resourceId: uuid },
      }),
    ).toThrow();
    expect(() =>
      gatewayHandoffIssueRequestSchema.parse({
        conversationId: 'conversation:1',
        target: { kind: 'artifact', artifactId: 'not-a-uuid', versionId: null },
      }),
    ).toThrow();
    expect(() =>
      gatewayHandoffIssueRequestSchema.parse({
        conversationId: 'conversation:1',
        target: { kind: 'message' },
      }),
    ).toThrow();
    expect(() =>
      gatewayHandoffIssueRequestSchema.parse({
        conversationId: 'conversation:1',
        target: {
          kind: 'resource',
          resourceKind: 'source',
          resourceId: uuid,
          versionId: null,
          extra: 'sneak',
        },
      }),
    ).toThrow();
    expect(() =>
      gatewayHandoffIssueRequestSchema.parse({
        conversationId: 'conversation:1',
        target: {
          kind: 'resource',
          resourceKind: 'unknown',
          resourceId: uuid,
          versionId: null,
        },
      }),
    ).toThrow();
  });
});
