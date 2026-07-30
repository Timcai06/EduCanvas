export const MAX_RUNTIME_MESSAGE_BYTES = 64 * 1024;
export const MAX_RUNTIME_MESSAGES_PER_SECOND = 30;
export const MAX_RUNTIME_OUTPUT_BYTES = 1024 * 1024;

export interface RuntimeMessageBudgetState {
  readonly rateWindowStarted: number;
  readonly rateWindowMessages: number;
  readonly outputBytes: number;
}

export type RuntimeMessageBudgetResult =
  | { readonly ok: true; readonly state: RuntimeMessageBudgetState }
  | { readonly ok: false; readonly code: 'resource_quota_exceeded' };

export function consumeRuntimeMessageBudget(
  state: RuntimeMessageBudgetState,
  input: {
    readonly now: number;
    readonly messageBytes: number;
    readonly outputBytes: number;
  },
): RuntimeMessageBudgetResult {
  if (
    !Number.isSafeInteger(input.messageBytes) ||
    !Number.isSafeInteger(input.outputBytes) ||
    input.messageBytes < 0 ||
    input.outputBytes < 0 ||
    input.messageBytes > MAX_RUNTIME_MESSAGE_BYTES
  ) {
    return { ok: false, code: 'resource_quota_exceeded' };
  }
  const newWindow = input.now - state.rateWindowStarted >= 1_000;
  const rateWindowMessages = newWindow ? 1 : state.rateWindowMessages + 1;
  const outputBytes = state.outputBytes + input.outputBytes;
  if (
    rateWindowMessages > MAX_RUNTIME_MESSAGES_PER_SECOND ||
    outputBytes > MAX_RUNTIME_OUTPUT_BYTES
  ) {
    return { ok: false, code: 'resource_quota_exceeded' };
  }
  return {
    ok: true,
    state: {
      rateWindowStarted: newWindow ? input.now : state.rateWindowStarted,
      rateWindowMessages,
      outputBytes,
    },
  };
}
