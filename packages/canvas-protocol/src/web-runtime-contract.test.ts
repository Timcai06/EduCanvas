import { describe, expect, it } from 'vitest';
import {
  WEB_RUNTIME_PROTOCOL_VERSION,
  createWebRuntimeSession,
  hostToSandboxMessageSchema,
  reduceWebRuntimeMessage,
  sandboxToHostMessageSchema,
  webRuntimeMessageSchema,
  webRuntimePreflightResultSchema,
  type WebRuntimeMessageDirection,
} from './web-runtime-contract';

const binding = {
  protocolVersion: WEB_RUNTIME_PROTOCOL_VERSION,
  channelId: 'host-capability-1',
  runtimeId: 'runtime-1',
  notebookId: 'notebook-1',
  artifactVersionId: 'artifact-version-1',
  artifactContentHash: 'a'.repeat(64),
} as const;

function message(type: string, sequence: number, payload: object = {}) {
  return { ...binding, type, sequence, payload };
}

function accepted(
  state: ReturnType<typeof createWebRuntimeSession>,
  direction: WebRuntimeMessageDirection,
  candidate: unknown,
) {
  const result = reduceWebRuntimeMessage(state, direction, candidate);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.code);
  return result.state;
}

function rejected(
  state: ReturnType<typeof createWebRuntimeSession>,
  direction: WebRuntimeMessageDirection,
  candidate: unknown,
  code: string,
) {
  expect(reduceWebRuntimeMessage(state, direction, candidate)).toEqual({
    ok: false,
    code,
  });
}

function startedSession() {
  return accepted(
    createWebRuntimeSession(binding),
    'host_to_sandbox',
    message('start', 0),
  );
}

describe('web runtime v1 security matrix', () => {
  it('R07 rejects unknown host-to-sandbox message types', () => {
    rejected(
      createWebRuntimeSession(binding),
      'host_to_sandbox',
      message('evaluate', 0),
      'invalid_message',
    );
  });

  it('R08 rejects missing, unknown, and downgraded protocol versions', () => {
    const state = createWebRuntimeSession(binding);
    const { protocolVersion: _removed, ...missingVersion } = message(
      'start',
      0,
    );
    rejected(state, 'host_to_sandbox', missingVersion, 'invalid_message');
    rejected(
      state,
      'host_to_sandbox',
      { ...message('start', 0), protocolVersion: 'educanvas.web-runtime.v0' },
      'invalid_message',
    );
  });

  it('R09 rejects unauthorized learning-fact operations from the sandbox', () => {
    rejected(
      startedSession(),
      'sandbox_to_host',
      message('write_mastery', 1, { score: 1 }),
      'invalid_message',
    );
  });

  it('R10 rejects replayed flood messages at the protocol layer', () => {
    let state = startedSession();
    state = accepted(state, 'sandbox_to_host', message('ready', 1));
    rejected(
      state,
      'sandbox_to_host',
      message('output', 1, { kind: 'text', value: 'replayed' }),
      'sequence_invalid',
    );
  });

  it('R10 rejects oversized output before it can consume the host bridge', () => {
    rejected(
      startedSession(),
      'sandbox_to_host',
      message('output', 1, {
        kind: 'text',
        value: 'x'.repeat(16_385),
      }),
      'invalid_message',
    );
  });

  it('R11 rejects missing identity fields and non-contiguous sequences', () => {
    const state = createWebRuntimeSession(binding);
    const { runtimeId: _removed, ...missingRuntime } = message('start', 0);
    rejected(state, 'host_to_sandbox', missingRuntime, 'invalid_message');
    rejected(state, 'host_to_sandbox', message('start', 1), 'sequence_invalid');
  });

  it('R12 keeps the first terminal and rejects duplicate terminal messages', () => {
    let state = startedSession();
    state = accepted(state, 'sandbox_to_host', message('succeeded', 1));
    rejected(
      state,
      'sandbox_to_host',
      message('failed', 2, { failureCode: 'execution_failed' }),
      'transition_invalid',
    );
    expect(state.terminal).toBe('succeeded');
  });

  it.each(['runtime_timeout', 'runtime_crashed'] as const)(
    'R16 converges %s to the single failed terminal',
    (failureCode) => {
      const state = accepted(
        startedSession(),
        'sandbox_to_host',
        message('failed', 1, { failureCode }),
      );
      expect(state.terminal).toBe('failed');
    },
  );

  it('R18 binds Notebook, immutable version, and SHA-256 hash', () => {
    const state = createWebRuntimeSession(binding);
    for (const candidate of [
      { ...message('start', 0), notebookId: 'notebook-2' },
      { ...message('start', 0), artifactVersionId: 'artifact-version-2' },
      { ...message('start', 0), artifactContentHash: 'b'.repeat(64) },
    ]) {
      rejected(state, 'host_to_sandbox', candidate, 'binding_mismatch');
    }
    rejected(
      state,
      'host_to_sandbox',
      { ...message('start', 0), artifactContentHash: 'A'.repeat(64) },
      'invalid_message',
    );
  });

  it('R19 rejects direct learning-event writes', () => {
    rejected(
      startedSession(),
      'sandbox_to_host',
      message('learning_events', 1, { events: [] }),
      'invalid_message',
    );
  });

  it('R20 rejects grade-like payloads hidden in allowed output messages', () => {
    rejected(
      startedSession(),
      'sandbox_to_host',
      message('output', 1, {
        kind: 'json',
        value: '{}',
        awardGrade: { score: 100 },
      }),
      'invalid_message',
    );
  });

  it('R23 does not admit prompt, source, object key, or stack fields', () => {
    for (const sensitiveField of [
      'prompt',
      'privateSource',
      'objectKey',
      'stack',
    ]) {
      rejected(
        startedSession(),
        'sandbox_to_host',
        message('failed', 1, {
          failureCode: 'execution_failed',
          [sensitiveField]: 'secret',
        }),
        'invalid_message',
      );
    }
  });

  it('R24 exposes only stable failure codes, not free-form error text', () => {
    rejected(
      startedSession(),
      'sandbox_to_host',
      message('failed', 1, {
        failureCode: 'runtime_timeout',
        reason: 'Error at /private/host/source.ts',
      }),
      'invalid_message',
    );
    rejected(
      startedSession(),
      'sandbox_to_host',
      message('failed', 1, { failureCode: 'provider_raw_error' }),
      'invalid_message',
    );
  });

  it('R25 rejects a sibling instance with a different channel capability', () => {
    rejected(
      createWebRuntimeSession(binding),
      'host_to_sandbox',
      { ...message('start', 0), channelId: 'sibling-channel' },
      'binding_mismatch',
    );
  });

  it('R25 rejects every mismatched sandbox identity and immutable version field', () => {
    const state = startedSession();
    for (const candidate of [
      { ...message('ready', 1), channelId: 'other-channel' },
      { ...message('ready', 1), runtimeId: 'other-runtime' },
      { ...message('ready', 1), notebookId: 'other-notebook' },
      { ...message('ready', 1), artifactVersionId: 'other-version' },
      { ...message('ready', 1), artifactContentHash: 'b'.repeat(64) },
    ]) {
      rejected(state, 'sandbox_to_host', candidate, 'binding_mismatch');
    }
  });

  it('R26 rejects messages replayed from a pre-reload runtime instance', () => {
    const reloaded = createWebRuntimeSession({
      ...binding,
      channelId: 'host-capability-2',
      runtimeId: 'runtime-2',
    });
    rejected(
      reloaded,
      'host_to_sandbox',
      message('start', 0),
      'binding_mismatch',
    );
  });
});

describe('web runtime v1 lifecycle', () => {
  it('enforces message direction even when the message shape is otherwise valid', () => {
    rejected(
      createWebRuntimeSession(binding),
      'sandbox_to_host',
      message('start', 0),
      'direction_mismatch',
    );
    rejected(
      createWebRuntimeSession(binding),
      'host_to_sandbox',
      message('ready', 0),
      'direction_mismatch',
    );
  });

  it('requires start before sandbox progress and permits start only once', () => {
    rejected(
      createWebRuntimeSession(binding),
      'sandbox_to_host',
      message('ready', 0),
      'transition_invalid',
    );
    const state = startedSession();
    rejected(
      state,
      'host_to_sandbox',
      message('start', 1),
      'transition_invalid',
    );
  });

  it('fails closed when cancellation races success', () => {
    let state = startedSession();
    state = accepted(state, 'host_to_sandbox', message('cancel', 1));
    rejected(
      state,
      'sandbox_to_host',
      message('succeeded', 2),
      'cancel_race_rejected',
    );
    state = accepted(state, 'sandbox_to_host', message('cancelled', 2));
    expect(state.terminal).toBe('cancelled');
  });

  it('uses closed directional schemas and strict payloads', () => {
    expect(
      hostToSandboxMessageSchema.safeParse(message('start', 0)).success,
    ).toBe(true);
    expect(
      sandboxToHostMessageSchema.safeParse(message('cancel', 0)).success,
    ).toBe(false);
    expect(
      webRuntimeMessageSchema.safeParse({
        ...message('output', 1, { kind: 'text', value: 'safe' }),
        extra: true,
      }).success,
    ).toBe(false);
  });

  it('keeps preflight outcomes outside persisted runtime terminals', () => {
    expect(
      webRuntimePreflightResultSchema.safeParse({ status: 'available' })
        .success,
    ).toBe(true);
    expect(
      webRuntimePreflightResultSchema.safeParse({
        status: 'unavailable',
        failureCode: 'runtime_unavailable',
      }).success,
    ).toBe(true);
    expect(
      webRuntimePreflightResultSchema.safeParse({
        status: 'unavailable',
        failureCode: 'runtime_rejected',
      }).success,
    ).toBe(false);
    expect(
      webRuntimePreflightResultSchema.safeParse({
        status: 'rejected',
        failureCode: 'runtime_rejected',
        terminal: 'failed',
      }).success,
    ).toBe(false);
  });

  it('returns frozen state snapshots and clones the initial binding', () => {
    const mutableBinding = { ...binding, runtimeId: String(binding.runtimeId) };
    const state = createWebRuntimeSession(mutableBinding);
    mutableBinding.runtimeId = 'mutated-runtime';
    expect(state.binding.runtimeId).toBe(binding.runtimeId);
    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state.binding)).toBe(true);
    expect(Object.isFrozen(startedSession())).toBe(true);
  });
});
