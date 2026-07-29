import { z } from 'zod';

/** Versioned, host-mediated messages for an untrusted persistent web runtime. */
export const WEB_RUNTIME_PROTOCOL_VERSION = 'educanvas.web-runtime.v1' as const;

const opaqueIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

const sequenceSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const webRuntimeFailureCodes = [
  'runtime_timeout',
  'runtime_crashed',
  'resource_quota_exceeded',
  'execution_failed',
  'cancel_race_rejected',
] as const;
export const webRuntimeFailureCodeSchema = z.enum(webRuntimeFailureCodes);
export type WebRuntimeFailureCode = z.infer<typeof webRuntimeFailureCodeSchema>;

/** Admission is host-side and deliberately not a persisted sandbox terminal state. */
export const webRuntimePreflightStatusSchema = z.enum([
  'available',
  'unavailable',
  'rejected',
]);
export const webRuntimePreflightFailureCodes = [
  'runtime_unavailable',
  'runtime_rejected',
] as const;
export const webRuntimePreflightFailureCodeSchema = z.enum(
  webRuntimePreflightFailureCodes,
);
export type WebRuntimePreflightFailureCode = z.infer<
  typeof webRuntimePreflightFailureCodeSchema
>;
export type WebRuntimePreflightStatus = z.infer<
  typeof webRuntimePreflightStatusSchema
>;
export const webRuntimePreflightResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('available') }).strict(),
  z
    .object({
      status: z.literal('unavailable'),
      failureCode: z.literal('runtime_unavailable'),
    })
    .strict(),
  z
    .object({
      status: z.literal('rejected'),
      failureCode: z.literal('runtime_rejected'),
    })
    .strict(),
]);
export type WebRuntimePreflightResult = z.infer<
  typeof webRuntimePreflightResultSchema
>;

const envelope = {
  protocolVersion: z.literal(WEB_RUNTIME_PROTOCOL_VERSION),
  channelId: opaqueIdSchema,
  runtimeId: opaqueIdSchema,
  notebookId: opaqueIdSchema,
  artifactVersionId: opaqueIdSchema,
  artifactContentHash: sha256Schema,
  sequence: sequenceSchema,
};

const startMessageSchema = z
  .object({
    ...envelope,
    type: z.literal('start'),
    payload: z.object({}).strict(),
  })
  .strict();
const cancelMessageSchema = z
  .object({
    ...envelope,
    type: z.literal('cancel'),
    payload: z.object({}).strict(),
  })
  .strict();
const readyMessageSchema = z
  .object({
    ...envelope,
    type: z.literal('ready'),
    payload: z.object({}).strict(),
  })
  .strict();
const outputMessageSchema = z
  .object({
    ...envelope,
    type: z.literal('output'),
    payload: z
      .object({
        kind: z.enum(['text', 'json']),
        value: z.string().max(16_384),
      })
      .strict(),
  })
  .strict();
const succeededMessageSchema = z
  .object({
    ...envelope,
    type: z.literal('succeeded'),
    payload: z.object({}).strict(),
  })
  .strict();
const failedMessageSchema = z
  .object({
    ...envelope,
    type: z.literal('failed'),
    payload: z
      .object({
        failureCode: webRuntimeFailureCodeSchema,
      })
      .strict(),
  })
  .strict();
const cancelledMessageSchema = z
  .object({
    ...envelope,
    type: z.literal('cancelled'),
    payload: z.object({}).strict(),
  })
  .strict();

export const hostToSandboxMessageSchema = z.discriminatedUnion('type', [
  startMessageSchema,
  cancelMessageSchema,
]);
export const sandboxToHostMessageSchema = z.discriminatedUnion('type', [
  readyMessageSchema,
  outputMessageSchema,
  succeededMessageSchema,
  failedMessageSchema,
  cancelledMessageSchema,
]);
export const webRuntimeMessageSchema = z.union([
  hostToSandboxMessageSchema,
  sandboxToHostMessageSchema,
]);
export type HostToSandboxMessage = z.infer<typeof hostToSandboxMessageSchema>;
export type SandboxToHostMessage = z.infer<typeof sandboxToHostMessageSchema>;
export type WebRuntimeMessage = z.infer<typeof webRuntimeMessageSchema>;
export type WebRuntimeTerminalType = Extract<
  WebRuntimeMessage['type'],
  'succeeded' | 'failed' | 'cancelled'
>;
export const webRuntimeMessageDirections = [
  'host_to_sandbox',
  'sandbox_to_host',
] as const;
export const webRuntimeMessageDirectionSchema = z.enum(
  webRuntimeMessageDirections,
);
export type WebRuntimeMessageDirection = z.infer<
  typeof webRuntimeMessageDirectionSchema
>;

export const webRuntimeBindingSchema = z
  .object({
    protocolVersion: z.literal(WEB_RUNTIME_PROTOCOL_VERSION),
    channelId: opaqueIdSchema,
    runtimeId: opaqueIdSchema,
    notebookId: opaqueIdSchema,
    artifactVersionId: opaqueIdSchema,
    artifactContentHash: sha256Schema,
  })
  .strict();
export type WebRuntimeBinding = z.infer<typeof webRuntimeBindingSchema>;

export interface WebRuntimeSessionState {
  readonly binding: WebRuntimeBinding;
  readonly nextSequence: number;
  readonly started: boolean;
  readonly cancelRequested: boolean;
  readonly terminal: WebRuntimeTerminalType | null;
}

export type WebRuntimeValidationResult =
  | { readonly ok: true; readonly state: WebRuntimeSessionState }
  | {
      readonly ok: false;
      readonly code:
        | 'invalid_message'
        | 'direction_mismatch'
        | 'binding_mismatch'
        | 'sequence_invalid'
        | 'transition_invalid'
        | 'cancel_race_rejected';
    };

export function createWebRuntimeSession(
  binding: WebRuntimeBinding,
): WebRuntimeSessionState {
  return freezeState({
    binding: Object.freeze(webRuntimeBindingSchema.parse(binding)),
    nextSequence: 0,
    started: false,
    cancelRequested: false,
    terminal: null,
  });
}

/** Rejects rather than repairs protocol violations: a compromised sandbox has no recovery authority. */
export function reduceWebRuntimeMessage(
  state: WebRuntimeSessionState,
  direction: WebRuntimeMessageDirection,
  candidate: unknown,
): WebRuntimeValidationResult {
  const expectedSchema =
    direction === 'host_to_sandbox'
      ? hostToSandboxMessageSchema
      : sandboxToHostMessageSchema;
  const parsed = expectedSchema.safeParse(candidate);
  if (!parsed.success) {
    return webRuntimeMessageSchema.safeParse(candidate).success
      ? { ok: false, code: 'direction_mismatch' }
      : { ok: false, code: 'invalid_message' };
  }
  const message = parsed.data;
  const binding = state.binding;
  if (
    message.protocolVersion !== binding.protocolVersion ||
    message.channelId !== binding.channelId ||
    message.runtimeId !== binding.runtimeId ||
    message.notebookId !== binding.notebookId ||
    message.artifactVersionId !== binding.artifactVersionId ||
    message.artifactContentHash !== binding.artifactContentHash
  )
    return { ok: false, code: 'binding_mismatch' };
  if (message.sequence !== state.nextSequence)
    return { ok: false, code: 'sequence_invalid' };
  if (state.nextSequence >= Number.MAX_SAFE_INTEGER)
    return { ok: false, code: 'sequence_invalid' };
  if (state.terminal) return { ok: false, code: 'transition_invalid' };
  if (message.type === 'start') {
    if (state.started || state.cancelRequested)
      return { ok: false, code: 'transition_invalid' };
    return {
      ok: true,
      state: freezeState({
        ...state,
        started: true,
        nextSequence: state.nextSequence + 1,
      }),
    };
  }
  if (message.type === 'cancel') {
    if (!state.started || state.cancelRequested)
      return { ok: false, code: 'transition_invalid' };
    return {
      ok: true,
      state: freezeState({
        ...state,
        cancelRequested: true,
        nextSequence: state.nextSequence + 1,
      }),
    };
  }
  if (!state.started) return { ok: false, code: 'transition_invalid' };
  if (state.cancelRequested && message.type !== 'cancelled')
    return { ok: false, code: 'cancel_race_rejected' };
  if (message.type === 'ready' || message.type === 'output')
    return {
      ok: true,
      state: freezeState({
        ...state,
        nextSequence: state.nextSequence + 1,
      }),
    };
  return {
    ok: true,
    state: freezeState({
      ...state,
      nextSequence: state.nextSequence + 1,
      terminal: message.type,
    }),
  };
}

function freezeState(state: WebRuntimeSessionState): WebRuntimeSessionState {
  return Object.freeze(state);
}
