import { createHash } from 'node:crypto';
import { isUuid } from './internal/identifiers';

export interface TurnContextMaterial {
  builderVersion: string;
  includedMessageIds: readonly string[];
  selectedAssetVersionIds: readonly string[];
  omittedMessageCount: number;
  characterCount: number;
}

export interface PreparedTurnContextMaterial extends TurnContextMaterial {
  includedMessageIds: string[];
  selectedAssetVersionIds: string[];
  contextHash: string;
}

export class TurnContextConflictError extends Error {
  readonly code = 'turn_context_conflict';

  constructor() {
    super('同一 Turn 已绑定不同的上下文快照');
    this.name = 'TurnContextConflictError';
  }
}

function validateIds(values: readonly string[]): string[] {
  if (values.length > 100 || values.some((value) => !isUuid(value))) {
    throw new TurnContextConflictError();
  }
  return [...values];
}

export function prepareTurnContextMaterial(
  input: TurnContextMaterial,
): PreparedTurnContextMaterial {
  if (
    !input.builderVersion ||
    input.builderVersion.length > 128 ||
    !Number.isInteger(input.omittedMessageCount) ||
    input.omittedMessageCount < 0 ||
    !Number.isInteger(input.characterCount) ||
    input.characterCount < 0 ||
    input.characterCount > 128_000
  ) {
    throw new TurnContextConflictError();
  }
  const includedMessageIds = validateIds(input.includedMessageIds);
  const selectedAssetVersionIds = validateIds(input.selectedAssetVersionIds);
  const contextHash = createHash('sha256')
    .update(
      JSON.stringify({
        builderVersion: input.builderVersion,
        includedMessageIds,
        selectedAssetVersionIds,
        omittedMessageCount: input.omittedMessageCount,
        characterCount: input.characterCount,
      }),
    )
    .digest('hex');
  return {
    ...input,
    includedMessageIds,
    selectedAssetVersionIds,
    contextHash,
  };
}
