import { describe, expect, it } from 'vitest';
import {
  turnApplicationCommandSchema,
  turnApplicationEventSchema,
  turnApplicationProtocolVersion,
  validateTurnApplicationEventSequence,
  type TurnApplicationEvent,
} from './turn-application-contracts';

const command = () => ({
  protocol: turnApplicationProtocolVersion,
  operationId: 'operation:1',
  traceId: 'trace:1',
  actor: { actorId: 'actor:1', agentId: 'agent:1' },
  notebook: { notebookId: 'notebook:1', conversationId: 'conversation:1' },
  profile: { profileId: 'education.default' },
  entrypoint: 'web',
  input: {
    clientMessageId: 'message:client:1',
    parts: [{ type: 'text', text: '请解释勾股定理' }],
  },
  capabilities: ['input.text', 'output.stream'],
});

const event = <T extends TurnApplicationEvent>(value: T): T => value;
const eventBase = {
  protocol: turnApplicationProtocolVersion,
  operationId: 'operation:1',
} as const;
const started = event({
  ...eventBase,
  type: 'turn.started',
  userMessageId: 'message:user:1',
  assistantMessageId: 'message:assistant:1',
  replayed: false,
});

describe('Turn Application contracts', () => {
  it('accepts one bounded server-routed command', () => {
    expect(turnApplicationCommandSchema.parse(command())).toEqual(command());
  });

  it('rejects client authority fields, duplicate capabilities and oversized input', () => {
    expect(() =>
      turnApplicationCommandSchema.parse({
        ...command(),
        principal: { userId: 'forged' },
      }),
    ).toThrow();
    expect(() =>
      turnApplicationCommandSchema.parse({
        ...command(),
        capabilities: ['input.text', 'input.text'],
      }),
    ).toThrow();
    expect(() =>
      turnApplicationCommandSchema.parse({
        ...command(),
        input: {
          clientMessageId: 'message:client:1',
          parts: Array.from({ length: 33 }, () => ({
            type: 'text',
            text: 'x',
          })),
        },
      }),
    ).toThrow();
  });

  it('keeps known events strict and prevents raw tool output fields', () => {
    expect(
      turnApplicationEventSchema.parse({
        ...eventBase,
        type: 'tool.completed',
        toolCallId: 'call:1',
        summary: '已读取受控资料',
      }),
    ).toBeTruthy();
    expect(() =>
      turnApplicationEventSchema.parse({
        ...eventBase,
        type: 'tool.completed',
        toolCallId: 'call:1',
        output: { secret: 'student-answer' },
      }),
    ).toThrow();
  });

  it('requires one started event and forbids events after the unique terminal', () => {
    const delta = event({
      protocol: turnApplicationProtocolVersion,
      operationId: 'operation:1',
      type: 'message.delta',
      messageId: 'message:assistant:1',
      delta: '直角三角形中，',
    });
    const completed = event({
      protocol: turnApplicationProtocolVersion,
      operationId: 'operation:1',
      type: 'turn.completed',
      messageId: 'message:assistant:1',
    });

    expect(validateTurnApplicationEventSequence([])).toBe(true);
    expect(validateTurnApplicationEventSequence([started, delta])).toBe(true);
    expect(
      validateTurnApplicationEventSequence([started, delta, completed]),
    ).toBe(true);
    expect(validateTurnApplicationEventSequence([delta, completed])).toBe(
      false,
    );
    expect(
      validateTurnApplicationEventSequence([started, completed, delta]),
    ).toBe(false);
    expect(
      validateTurnApplicationEventSequence([
        started,
        { ...started, replayed: true },
      ]),
    ).toBe(false);
    expect(
      validateTurnApplicationEventSequence([
        started,
        { ...delta, operationId: 'operation:other' },
      ]),
    ).toBe(false);
  });

  it('accepts bounded knowledge and public web citations only', () => {
    expect(
      turnApplicationEventSchema.parse({
        protocol: turnApplicationProtocolVersion,
        operationId: 'operation:1',
        type: 'message.citation',
        messageId: 'message:assistant:1',
        citationId: 'citation:1',
        marker: 1,
        label: '教材第 12 页',
        target: {
          kind: 'knowledge',
          sourceId: 'source:1',
          documentId: 'document:1',
          chunkId: 'chunk:1',
          pageStart: 12,
          pageEnd: 12,
        },
      }),
    ).toBeTruthy();
    expect(() =>
      turnApplicationEventSchema.parse({
        protocol: turnApplicationProtocolVersion,
        operationId: 'operation:1',
        type: 'message.citation',
        messageId: 'message:assistant:1',
        citationId: 'citation:2',
        label: '私有地址',
        target: {
          kind: 'web',
          assetId: 'asset:1',
          assetVersionId: 'version:1',
          url: 'https://user:secret@example.com/private',
        },
      }),
    ).toThrow();
    expect(() =>
      turnApplicationEventSchema.parse({
        protocol: turnApplicationProtocolVersion,
        operationId: 'operation:1',
        type: 'message.citation',
        messageId: 'message:assistant:1',
        citationId: 'citation:3',
        label: '非网页协议',
        target: {
          kind: 'web',
          assetId: 'asset:1',
          assetVersionId: 'version:1',
          url: 'ftp://example.com/private',
        },
      }),
    ).toThrow();
  });
});
