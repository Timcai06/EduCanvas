import {
  parseTeachingTurnEvent,
  TurnStreamProtocolError,
  type TeachingTurnEvent,
} from './turn-events';

const MAX_RECOVERY_EVENTS = 4_096;
const MAX_TURN_ID_LENGTH = 256;

export interface TurnEventsRecoveryResponse {
  readonly events: readonly TeachingTurnEvent[];
  readonly nextSequence: number;
  readonly terminal: boolean;
  readonly research?: TurnResearchSnapshot;
}

export type TurnResearchPhase =
  'planning' | 'searching' | 'reading' | 'synthesizing';
export type TurnResearchOperationStatus =
  'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
export interface TurnResearchSnapshot {
  readonly phase: TurnResearchPhase;
  readonly completedQueryCount: number;
  readonly candidateCount: number;
  readonly sourceCount: number;
  readonly citationOrdinals: readonly number[];
  readonly operationStatus: TurnResearchOperationStatus;
  readonly terminal: boolean;
}

export class TurnRecoveryProtocolError extends TurnStreamProtocolError {
  constructor(message: string) {
    super(message);
    this.name = 'TurnRecoveryProtocolError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSafeSequence(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isBoundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= minimum &&
    value <= maximum
  );
}

function parseResearchSnapshot(value: unknown): TurnResearchSnapshot {
  if (!isRecord(value)) {
    throw new TurnRecoveryProtocolError('turn recovery research is invalid');
  }
  const phases: readonly TurnResearchPhase[] = [
    'planning',
    'searching',
    'reading',
    'synthesizing',
  ];
  const statuses: readonly TurnResearchOperationStatus[] = [
    'pending',
    'running',
    'completed',
    'failed',
    'cancelled',
    'interrupted',
  ];
  if (!phases.includes(value.phase as TurnResearchPhase)) {
    throw new TurnRecoveryProtocolError(
      'turn recovery research phase is invalid',
    );
  }
  if (!isBoundedInteger(value.completedQueryCount, 0, 5)) {
    throw new TurnRecoveryProtocolError(
      'turn recovery completedQueryCount is invalid',
    );
  }
  if (!isBoundedInteger(value.candidateCount, 0, 15)) {
    throw new TurnRecoveryProtocolError(
      'turn recovery candidateCount is invalid',
    );
  }
  if (!isBoundedInteger(value.sourceCount, 0, 8)) {
    throw new TurnRecoveryProtocolError('turn recovery sourceCount is invalid');
  }
  if (
    !Array.isArray(value.citationOrdinals) ||
    value.citationOrdinals.length > 15 ||
    value.citationOrdinals.some((ordinal) => !isBoundedInteger(ordinal, 1, 15))
  ) {
    throw new TurnRecoveryProtocolError(
      'turn recovery citationOrdinals is invalid',
    );
  }
  if (new Set(value.citationOrdinals).size !== value.citationOrdinals.length) {
    throw new TurnRecoveryProtocolError(
      'turn recovery citationOrdinals are duplicated',
    );
  }
  if (
    !statuses.includes(value.operationStatus as TurnResearchOperationStatus)
  ) {
    throw new TurnRecoveryProtocolError(
      'turn recovery operationStatus is invalid',
    );
  }
  if (typeof value.terminal !== 'boolean') {
    throw new TurnRecoveryProtocolError(
      'turn recovery research terminal is invalid',
    );
  }
  return {
    phase: value.phase as TurnResearchPhase,
    completedQueryCount: value.completedQueryCount,
    candidateCount: value.candidateCount,
    sourceCount: value.sourceCount,
    citationOrdinals: [...value.citationOrdinals] as number[],
    operationStatus: value.operationStatus as TurnResearchOperationStatus,
    terminal: value.terminal,
  };
}

/** Parse the deliberately small JSON envelope used by turn recovery. */
export function parseTurnEventsRecoveryResponse(
  value: unknown,
): TurnEventsRecoveryResponse {
  if (!isRecord(value)) {
    throw new TurnRecoveryProtocolError(
      'turn recovery response is not an object',
    );
  }
  if (
    !Array.isArray(value.events) ||
    value.events.length > MAX_RECOVERY_EVENTS
  ) {
    throw new TurnRecoveryProtocolError('turn recovery events are invalid');
  }
  if (!isSafeSequence(value.nextSequence)) {
    throw new TurnRecoveryProtocolError(
      'turn recovery nextSequence is invalid',
    );
  }
  if (typeof value.terminal !== 'boolean') {
    throw new TurnRecoveryProtocolError('turn recovery terminal is invalid');
  }

  const events = value.events.map((candidate, index) => {
    if (!isRecord(candidate) || typeof candidate.type !== 'string') {
      throw new TurnRecoveryProtocolError(
        `turn recovery events[${index}] is invalid`,
      );
    }
    const event = parseTeachingTurnEvent(
      candidate.type,
      JSON.stringify(candidate),
    );
    if (!event) {
      throw new TurnRecoveryProtocolError(
        `turn recovery events[${index}] is unsupported`,
      );
    }
    return event;
  });

  return {
    events,
    nextSequence: value.nextSequence,
    terminal: value.terminal,
    ...(value.research === undefined
      ? {}
      : { research: parseResearchSnapshot(value.research) }),
  };
}

export async function readTurnEventsRecoveryResponse(
  response: Response,
): Promise<TurnEventsRecoveryResponse> {
  if (!response.ok) {
    throw new TurnRecoveryProtocolError(
      `turn recovery request failed with ${response.status}`,
    );
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new TurnRecoveryProtocolError('turn recovery response is not JSON');
  }
  return parseTurnEventsRecoveryResponse(body);
}

export function buildTurnEventsEndpoint(
  turnEndpoint: string,
  turnId: string,
): string {
  if (!turnId || turnId.length > MAX_TURN_ID_LENGTH) {
    throw new TurnRecoveryProtocolError('turn recovery turnId is invalid');
  }
  const encodedTurnId = encodeURIComponent(turnId);
  if (/\/turn\/?$/.test(turnEndpoint)) {
    return `${turnEndpoint.replace(/\/$/, '')}/${encodedTurnId}/events`;
  }
  return `${turnEndpoint.replace(/\/$/, '')}/${encodedTurnId}/events`;
}

export interface TurnRecoveryResult {
  readonly nextSequence: number;
  readonly terminal: boolean;
  readonly attempts: number;
}

export interface TurnRecoveryControllerOptions {
  readonly eventsEndpoint: (turnId: string) => string;
  readonly fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>;
  readonly maxAttempts?: number;
  readonly retryDelaysMs?: readonly number[];
  readonly sleep?: (delayMs: number, signal: AbortSignal) => Promise<void>;
  readonly onResearchSnapshot?: (snapshot: TurnResearchSnapshot) => void;
}

export type TurnRecoveryEventHandler = (event: TeachingTurnEvent) => void;

const defaultSleep = (delayMs: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('The operation was aborted.', 'AbortError'));
      return;
    }
    const timer = setTimeout(resolve, delayMs);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new DOMException('The operation was aborted.', 'AbortError'));
      },
      { once: true },
    );
  });

/** Poll one existing operation; this never creates or cancels a turn. */
export class TurnRecoveryController {
  private readonly fetchImpl: NonNullable<
    TurnRecoveryControllerOptions['fetchImpl']
  >;
  private readonly maxAttempts: number;
  private readonly retryDelaysMs: readonly number[];
  private readonly sleep: NonNullable<TurnRecoveryControllerOptions['sleep']>;

  constructor(private readonly options: TurnRecoveryControllerOptions) {
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.maxAttempts = Math.max(1, Math.min(180, options.maxAttempts ?? 120));
    this.retryDelaysMs = options.retryDelaysMs ?? [1_000];
    this.sleep = options.sleep ?? defaultSleep;
  }

  async recover(
    turnId: string,
    afterSequence: number,
    onEvent: TurnRecoveryEventHandler,
    signal: AbortSignal,
  ): Promise<TurnRecoveryResult> {
    if (!isSafeSequence(afterSequence)) {
      throw new TurnRecoveryProtocolError('turn recovery after is invalid');
    }
    let nextSequence = afterSequence;
    let lastError: unknown;
    for (let attempts = 1; attempts <= this.maxAttempts; attempts += 1) {
      if (signal.aborted)
        throw new DOMException('The operation was aborted.', 'AbortError');
      try {
        const url = `${this.options.eventsEndpoint(turnId)}?after=${nextSequence}`;
        const response = await this.fetchImpl(url, {
          method: 'GET',
          headers: { accept: 'application/json' },
          signal,
        });
        const recovery = await readTurnEventsRecoveryResponse(response);
        if (recovery.nextSequence < nextSequence) {
          throw new TurnRecoveryProtocolError(
            'turn recovery sequence moved backwards',
          );
        }
        if (recovery.research) {
          this.options.onResearchSnapshot?.(recovery.research);
        }
        let batchSequence = nextSequence;
        for (const event of recovery.events) {
          if (event.sequence === undefined || event.sequence <= batchSequence) {
            throw new TurnRecoveryProtocolError(
              'turn recovery event sequence did not advance',
            );
          }
          batchSequence = event.sequence;
          onEvent(event);
        }
        if (recovery.nextSequence < batchSequence) {
          throw new TurnRecoveryProtocolError(
            'turn recovery cursor trails its events',
          );
        }
        nextSequence = recovery.nextSequence;
        if (recovery.terminal) {
          return { nextSequence, terminal: true, attempts };
        }
        lastError = undefined;
      } catch (error) {
        if (signal.aborted) throw error;
        if (error instanceof TurnStreamProtocolError) throw error;
        lastError = error;
      }
      if (attempts < this.maxAttempts) {
        await this.sleep(
          this.retryDelaysMs[
            Math.min(attempts - 1, this.retryDelaysMs.length - 1)
          ] ?? 0,
          signal,
        );
      }
    }
    if (lastError) throw lastError;
    return { nextSequence, terminal: false, attempts: this.maxAttempts };
  }
}
