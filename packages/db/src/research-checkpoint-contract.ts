export const RESEARCH_CHECKPOINT_PROTOCOL_VERSION =
  'educanvas.research-checkpoint.v1' as const;

export const RESEARCH_CHECKPOINT_PHASES = [
  'planning',
  'searching',
  'reading',
  'synthesizing',
] as const;

export type ResearchCheckpointPhase =
  (typeof RESEARCH_CHECKPOINT_PHASES)[number];

export type ResearchOperationStatus =
  'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';

const TERMINAL_OPERATION_STATUSES = new Set<ResearchOperationStatus>([
  'completed',
  'failed',
  'cancelled',
  'interrupted',
]);

export const RESEARCH_CHECKPOINT_PHASE_INDEX = new Map<
  ResearchCheckpointPhase,
  number
>(RESEARCH_CHECKPOINT_PHASES.map((phase, index) => [phase, index]));

export const MAX_RESEARCH_COMPLETED_QUERIES = 5;
export const MAX_RESEARCH_CANDIDATE_URLS = 15;

export interface ResearchCheckpointSnapshot {
  operationId: string;
  protocolVersion: typeof RESEARCH_CHECKPOINT_PROTOCOL_VERSION;
  phase: ResearchCheckpointPhase;
  completedQueries: readonly string[];
  candidateUrls: readonly string[];
  updatedAt: string;
}

export interface ResearchCheckpointPublicSnapshot {
  operationId: string;
  phase: ResearchCheckpointPhase;
  completedQueryCount: number;
  candidateCount: number;
  sourceCount: number;
  citationOrdinals: readonly number[];
  operationStatus: ResearchOperationStatus;
  terminal: boolean;
}

export class ResearchCheckpointOwnershipError extends Error {
  readonly code = 'research_checkpoint_not_found';

  constructor() {
    super('Research checkpoint不存在或不属于当前Actor与Conversation');
    this.name = 'ResearchCheckpointOwnershipError';
  }
}

export class ResearchCheckpointConflictError extends Error {
  readonly code = 'research_checkpoint_conflict';

  constructor(message = 'Research checkpoint协议版本不匹配') {
    super(message);
    this.name = 'ResearchCheckpointConflictError';
  }
}

export class ResearchCheckpointValidationError extends Error {
  readonly code = 'invalid_research_checkpoint';

  constructor(message: string) {
    super(message);
    this.name = 'ResearchCheckpointValidationError';
  }
}

export class ResearchCheckpointLifecycleError extends Error {
  readonly code = 'invalid_research_checkpoint_transition';

  constructor(message: string) {
    super(message);
    this.name = 'ResearchCheckpointLifecycleError';
  }
}

/** Query identity follows the web-search key: NFC, trim, and whitespace folding. */
export function normalizeResearchQuery(value: string): string {
  if (typeof value !== 'string') {
    throw new ResearchCheckpointValidationError('completed query必须是文本');
  }
  const normalized = value
    .normalize('NFC')
    .trim()
    .replace(/\s+/gu, ' ')
    .toLocaleLowerCase();
  if ([...normalized].length < 1 || [...normalized].length > 200) {
    throw new ResearchCheckpointValidationError(
      'completed query长度必须在1到200个字符之间',
    );
  }
  return normalized;
}

function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/gu, '');
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host === '::1' ||
    (host.includes(':') &&
      (host.startsWith('fc') ||
        host.startsWith('fd') ||
        host.startsWith('fe80:')))
  ) {
    return true;
  }
  const octets = host.split('.').map((octet) => Number(octet));
  if (
    octets.length !== 4 ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return false;
  }
  const first = octets[0]!;
  const second = octets[1]!;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

/** Normalize and reject credential-bearing or local candidate URLs. */
export function normalizeResearchCandidateUrl(value: string): string {
  if (typeof value !== 'string') {
    throw new ResearchCheckpointValidationError('candidate URL必须是文本');
  }
  let url: URL;
  try {
    url = new URL(value.normalize('NFC').trim());
  } catch {
    throw new ResearchCheckpointValidationError('candidate URL格式无效');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    !url.hostname ||
    url.username ||
    url.password ||
    isPrivateHost(url.hostname)
  ) {
    throw new ResearchCheckpointValidationError(
      'candidate URL必须是公开的http(s)地址且不得包含凭据',
    );
  }
  url.hash = '';
  const normalized = url.toString();
  if (normalized.length > 2_048) {
    throw new ResearchCheckpointValidationError(
      'candidate URL长度不能超过2048个字符',
    );
  }
  return normalized;
}

export function normalizeResearchQueries(values: readonly string[]): string[] {
  const normalized = [...new Set(values.map(normalizeResearchQuery))];
  if (normalized.length > MAX_RESEARCH_COMPLETED_QUERIES) {
    throw new ResearchCheckpointValidationError('completed query最多保存5项');
  }
  return normalized;
}

export function normalizeResearchCandidateUrls(
  values: readonly string[],
): string[] {
  const normalized = [...new Set(values.map(normalizeResearchCandidateUrl))];
  if (normalized.length > MAX_RESEARCH_CANDIDATE_URLS) {
    throw new ResearchCheckpointValidationError('candidate URL最多保存15项');
  }
  return normalized;
}

export function parseResearchCheckpointPhase(
  phase: string,
): ResearchCheckpointPhase {
  if (!RESEARCH_CHECKPOINT_PHASE_INDEX.has(phase as ResearchCheckpointPhase)) {
    throw new ResearchCheckpointValidationError('Research phase无效');
  }
  return phase as ResearchCheckpointPhase;
}

export function parseResearchOperationStatus(
  value: string,
): ResearchOperationStatus {
  if (
    ![
      'pending',
      'running',
      'completed',
      'failed',
      'cancelled',
      'interrupted',
    ].includes(value)
  ) {
    throw new ResearchCheckpointLifecycleError('Operation状态无效');
  }
  return value as ResearchOperationStatus;
}

export function researchOperationIsTerminal(
  status: ResearchOperationStatus,
): boolean {
  return TERMINAL_OPERATION_STATUSES.has(status);
}
