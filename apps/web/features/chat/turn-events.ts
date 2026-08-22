const TURN_EVENT_SCHEMA_VERSION = '1' as const;
const MAX_ID_LENGTH = 256;
const MAX_CODE_LENGTH = 128;
const MAX_LABEL_LENGTH = 160;
const MAX_MESSAGE_LENGTH = 1_000;
const MAX_DELTA_LENGTH = 32_768;

interface TurnEventBase {
  schemaVersion: typeof TURN_EVENT_SCHEMA_VERSION;
  turnId: string;
  /** Gateway sequence when available; old compatibility streams may omit it. */
  sequence?: number;
}

export interface TurnAcceptedEvent extends TurnEventBase {
  type: 'turn.accepted';
  studentMessageId: string;
  assistantMessageId: string;
  replayed: boolean;
}

export interface MessageDeltaEvent extends TurnEventBase {
  type: 'message.delta';
  messageId: string;
  delta: string;
}

interface MessageCitationEventBase extends TurnEventBase {
  type: 'message.citation';
  messageId: string;
  citationId: string;
  /** 文中标记号(即 [n]);旧流可能缺省,缺省时 UI 退化为无编号来源徽章。 */
  marker?: number;
  label: string;
  pageStart: number | null;
  pageEnd: number | null;
}

export interface KnowledgeMessageCitationEvent extends MessageCitationEventBase {
  kind?: 'knowledge';
  sourceId: string;
  documentId: string;
  chunkId: string;
}

export interface WebMessageCitationEvent extends MessageCitationEventBase {
  kind: 'web';
  assetId: string;
  assetVersionId: string;
  url: string;
}

export type MessageCitationEvent =
  KnowledgeMessageCitationEvent | WebMessageCitationEvent;

export interface TurnCompletedEvent extends TurnEventBase {
  type: 'turn.completed';
  messageId: string;
}

export interface TurnFailedEvent extends TurnEventBase {
  type: 'turn.failed';
  messageId: string;
  code: string;
  message: string;
  retryable: boolean;
}

export interface TurnCancelledEvent extends TurnEventBase {
  type: 'turn.cancelled';
  messageId: string;
}

export interface ToolLifecycleEvent extends TurnEventBase {
  type: 'tool.started' | 'tool.completed' | 'tool.failed';
  toolCallId: string;
  label?: string;
  code?: string;
  activity?: 'web_search' | 'web_fetch' | 'other';
}

/**
 * Artifact 生命周期事件(ADR-0005)。additive 加入 schemaVersion=1:
 * 旧浏览器按未知事件忽略,不需要整体协议升版。生产者随 M1 PR-J5 接线,
 * 断连恢复走 GET /api/v1/chat/artifacts,不依赖流的连续性。
 */
export interface ArtifactProposedEvent extends TurnEventBase {
  type: 'artifact.proposed' | 'artifact.created';
  artifactId: string;
  kind: string;
  trustTier: 'tier1' | 'tier2';
  title: string;
}

export interface ArtifactVersionAddedEvent extends TurnEventBase {
  type: 'artifact.version_added';
  artifactId: string;
  version: number;
}

export interface ArtifactGenerationProgressEvent extends TurnEventBase {
  type: 'artifact.generation_progress';
  artifactId: string;
  jobId: string;
  progress: number;
}

export interface ArtifactFailedEvent extends TurnEventBase {
  type: 'artifact.failed';
  artifactId: string;
  jobId?: string;
  code: string;
}

export type ArtifactLifecycleEvent =
  | ArtifactProposedEvent
  | ArtifactVersionAddedEvent
  | ArtifactGenerationProgressEvent
  | ArtifactFailedEvent;

export type TeachingTurnEvent =
  | ArtifactLifecycleEvent
  | TurnAcceptedEvent
  | MessageDeltaEvent
  | MessageCitationEvent
  | TurnCompletedEvent
  | TurnFailedEvent
  | TurnCancelledEvent
  | ToolLifecycleEvent;

export class TurnStreamProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TurnStreamProtocolError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(
  data: Record<string, unknown>,
  key: string,
  eventName: string,
  maxLength = MAX_ID_LENGTH,
): string {
  const value = data[key];
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maxLength
  ) {
    throw new TurnStreamProtocolError(`${eventName}.${key} is invalid`);
  }
  return value;
}

function readBoolean(
  data: Record<string, unknown>,
  key: string,
  eventName: string,
): boolean {
  const value = data[key];
  if (typeof value !== 'boolean') {
    throw new TurnStreamProtocolError(`${eventName}.${key} is invalid`);
  }
  return value;
}

function readPublicHttpUrl(
  data: Record<string, unknown>,
  key: string,
  eventName: string,
): string {
  const value = readString(data, key, eventName, 2_048);
  try {
    const url = new URL(value);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password
    ) {
      throw new Error('invalid');
    }
    return url.toString();
  } catch {
    throw new TurnStreamProtocolError(`${eventName}.${key} is invalid`);
  }
}

function readNullablePositiveInteger(
  data: Record<string, unknown>,
  key: string,
  eventName: string,
  maxValue = Number.MAX_SAFE_INTEGER,
): number | null {
  const value = data[key];
  if (value === null) return null;
  if (
    !Number.isInteger(value) ||
    (value as number) < 1 ||
    (value as number) > maxValue
  ) {
    throw new TurnStreamProtocolError(`${eventName}.${key} is invalid`);
  }
  return value as number;
}

/**
 * Parses one named SSE event. Unknown event names are ignored so later
 * additive protocol events do not break an older browser; known events remain
 * strict and versioned.
 */
function parseTeachingTurnEventWithoutSequence(
  eventName: string,
  jsonData: string,
): TeachingTurnEvent | null {
  const knownEvents = new Set([
    'turn.accepted',
    'message.delta',
    'message.citation',
    'turn.completed',
    'turn.failed',
    'turn.cancelled',
    'tool.started',
    'tool.completed',
    'tool.failed',
    'artifact.proposed',
    'artifact.created',
    'artifact.version_added',
    'artifact.generation_progress',
    'artifact.failed',
  ]);
  if (!knownEvents.has(eventName)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonData);
  } catch {
    throw new TurnStreamProtocolError(`${eventName} data is not valid JSON`);
  }
  if (!isRecord(parsed)) {
    throw new TurnStreamProtocolError(`${eventName} data is not an object`);
  }
  if (parsed.schemaVersion !== TURN_EVENT_SCHEMA_VERSION) {
    throw new TurnStreamProtocolError(
      `${eventName} schema version is unsupported`,
    );
  }
  if (parsed.type !== eventName) {
    throw new TurnStreamProtocolError(
      `${eventName} payload type does not match`,
    );
  }

  const turnId = readString(parsed, 'turnId', eventName);
  if (eventName === 'turn.accepted') {
    return {
      type: eventName,
      schemaVersion: TURN_EVENT_SCHEMA_VERSION,
      turnId,
      studentMessageId: readString(parsed, 'studentMessageId', eventName),
      assistantMessageId: readString(parsed, 'assistantMessageId', eventName),
      replayed: readBoolean(parsed, 'replayed', eventName),
    };
  }
  if (eventName === 'message.delta') {
    return {
      type: eventName,
      schemaVersion: TURN_EVENT_SCHEMA_VERSION,
      turnId,
      messageId: readString(parsed, 'messageId', eventName),
      delta: readString(parsed, 'delta', eventName, MAX_DELTA_LENGTH),
    };
  }
  if (eventName === 'message.citation') {
    const common = {
      type: 'message.citation' as const,
      schemaVersion: TURN_EVENT_SCHEMA_VERSION,
      turnId,
      messageId: readString(parsed, 'messageId', eventName),
      citationId: readString(parsed, 'citationId', eventName),
      ...(parsed.marker === undefined
        ? {}
        : {
            marker:
              readNullablePositiveInteger(parsed, 'marker', eventName, 99) ??
              undefined,
          }),
      label: readString(parsed, 'label', eventName, 400),
      pageStart: readNullablePositiveInteger(parsed, 'pageStart', eventName),
      pageEnd: readNullablePositiveInteger(parsed, 'pageEnd', eventName),
    };
    if (parsed.kind === 'web') {
      if (common.pageStart !== null || common.pageEnd !== null) {
        throw new TurnStreamProtocolError(
          `${eventName} web page fields are invalid`,
        );
      }
      return {
        ...common,
        kind: 'web',
        assetId: readString(parsed, 'assetId', eventName),
        assetVersionId: readString(parsed, 'assetVersionId', eventName),
        url: readPublicHttpUrl(parsed, 'url', eventName),
      };
    }
    if (parsed.kind !== undefined && parsed.kind !== 'knowledge') {
      throw new TurnStreamProtocolError(`${eventName}.kind is invalid`);
    }
    return {
      ...common,
      ...(parsed.kind === 'knowledge' ? { kind: 'knowledge' as const } : {}),
      sourceId: readString(parsed, 'sourceId', eventName),
      documentId: readString(parsed, 'documentId', eventName),
      chunkId: readString(parsed, 'chunkId', eventName),
    };
  }
  if (eventName === 'turn.completed') {
    return {
      type: eventName,
      schemaVersion: TURN_EVENT_SCHEMA_VERSION,
      turnId,
      messageId: readString(parsed, 'messageId', eventName),
    };
  }
  if (eventName === 'turn.failed') {
    return {
      type: eventName,
      schemaVersion: TURN_EVENT_SCHEMA_VERSION,
      turnId,
      messageId: readString(parsed, 'messageId', eventName),
      code: readString(parsed, 'code', eventName, MAX_CODE_LENGTH),
      message: readString(parsed, 'message', eventName, MAX_MESSAGE_LENGTH),
      retryable: readBoolean(parsed, 'retryable', eventName),
    };
  }
  if (eventName === 'turn.cancelled') {
    return {
      type: eventName,
      schemaVersion: TURN_EVENT_SCHEMA_VERSION,
      turnId,
      messageId: readString(parsed, 'messageId', eventName),
    };
  }

  if (eventName === 'artifact.proposed' || eventName === 'artifact.created') {
    const trustTier = readString(parsed, 'trustTier', eventName, 8);
    if (trustTier !== 'tier1' && trustTier !== 'tier2') {
      throw new TurnStreamProtocolError(`${eventName}.trustTier is invalid`);
    }
    const kind = readString(parsed, 'kind', eventName, 64);
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(kind)) {
      throw new TurnStreamProtocolError(`${eventName}.kind is invalid`);
    }
    return {
      type: eventName,
      schemaVersion: TURN_EVENT_SCHEMA_VERSION,
      turnId,
      artifactId: readString(parsed, 'artifactId', eventName),
      kind,
      trustTier,
      title: readString(parsed, 'title', eventName, 300),
    };
  }
  if (eventName === 'artifact.version_added') {
    const version = parsed.version;
    if (!Number.isInteger(version) || (version as number) < 1) {
      throw new TurnStreamProtocolError(`${eventName}.version is invalid`);
    }
    return {
      type: eventName,
      schemaVersion: TURN_EVENT_SCHEMA_VERSION,
      turnId,
      artifactId: readString(parsed, 'artifactId', eventName),
      version: version as number,
    };
  }
  if (eventName === 'artifact.generation_progress') {
    const progress = parsed.progress;
    if (
      !Number.isInteger(progress) ||
      (progress as number) < 0 ||
      (progress as number) > 100
    ) {
      throw new TurnStreamProtocolError(`${eventName}.progress is invalid`);
    }
    return {
      type: eventName,
      schemaVersion: TURN_EVENT_SCHEMA_VERSION,
      turnId,
      artifactId: readString(parsed, 'artifactId', eventName),
      jobId: readString(parsed, 'jobId', eventName),
      progress: progress as number,
    };
  }
  if (eventName === 'artifact.failed') {
    const jobId =
      parsed.jobId === undefined
        ? undefined
        : readString(parsed, 'jobId', eventName);
    return {
      type: eventName,
      schemaVersion: TURN_EVENT_SCHEMA_VERSION,
      turnId,
      artifactId: readString(parsed, 'artifactId', eventName),
      ...(jobId ? { jobId } : {}),
      code: readString(parsed, 'code', eventName, MAX_CODE_LENGTH),
    };
  }

  const label =
    parsed.label === undefined
      ? undefined
      : readString(parsed, 'label', eventName, MAX_LABEL_LENGTH);
  const code =
    parsed.code === undefined
      ? undefined
      : readString(parsed, 'code', eventName, MAX_CODE_LENGTH);
  const activity = (() => {
    if (parsed.activity === undefined) return undefined;
    const candidate = readString(parsed, 'activity', eventName, 32);
    if (
      candidate !== 'web_search' &&
      candidate !== 'web_fetch' &&
      candidate !== 'other'
    ) {
      throw new TurnStreamProtocolError(`${eventName}.activity is invalid`);
    }
    return candidate;
  })();
  return {
    type: eventName as ToolLifecycleEvent['type'],
    schemaVersion: TURN_EVENT_SCHEMA_VERSION,
    turnId,
    toolCallId: readString(parsed, 'toolCallId', eventName),
    ...(label ? { label } : {}),
    ...(activity ? { activity } : {}),
    ...(eventName === 'tool.failed' && code ? { code } : {}),
  };
}

export function parseTeachingTurnEvent(
  eventName: string,
  jsonData: string,
): TeachingTurnEvent | null {
  const event = parseTeachingTurnEventWithoutSequence(eventName, jsonData);
  if (!event) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonData);
  } catch {
    throw new TurnStreamProtocolError(`${eventName} data is not valid JSON`);
  }
  if (!isRecord(parsed)) {
    throw new TurnStreamProtocolError(`${eventName} data is not an object`);
  }
  if (parsed.sequence === undefined) return event;
  if (
    typeof parsed.sequence !== 'number' ||
    !Number.isSafeInteger(parsed.sequence) ||
    parsed.sequence < 0
  ) {
    throw new TurnStreamProtocolError(`${eventName}.sequence is invalid`);
  }
  return { ...event, sequence: parsed.sequence };
}
