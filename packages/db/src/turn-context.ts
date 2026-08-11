import { createHash } from 'node:crypto';
import type {
  AgentTurnContextMaterial,
  AssetVersionRepresentationIdentity,
} from '@educanvas/agent-core';
import {
  assetRepresentationKindSchema,
  representationQualitySchema,
} from '@educanvas/agent-core';
import { isUuid } from './internal/identifiers';

export type TurnContextMaterial = AgentTurnContextMaterial;

export interface PreparedTurnContextMaterial extends TurnContextMaterial {
  includedMessageIds: string[];
  selectedAssetVersionIds: string[];
  selectedAssetRepresentations: (AssetVersionRepresentationIdentity | null)[];
  contextHash: string;
}

/** 表示身份开放扩展 Vocabulary 约束（与 asset-contracts 一致）。 */
const representationVariantPattern = /^[a-z][a-z0-9_]{0,63}$/;
const representationProducerPattern = /^[a-z][a-z0-9._-]{0,63}$/;
const representationProducerVersionPattern = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export class TurnContextConflictError extends Error {
  readonly code = 'turn_context_conflict';

  constructor() {
    super('同一 Turn 已绑定不同的上下文快照');
    this.name = 'TurnContextConflictError';
  }
}

function validateIds(values: readonly string[]): string[] {
  if (
    values.length > 100 ||
    new Set(values).size !== values.length ||
    values.some((value) => !isUuid(value))
  ) {
    throw new TurnContextConflictError();
  }
  return [...values];
}

function validateRepresentationIdentity(
  identity: AssetVersionRepresentationIdentity,
): boolean {
  return (
    assetRepresentationKindSchema.safeParse(identity.kind).success &&
    representationQualitySchema.safeParse(identity.quality).success &&
    representationVariantPattern.test(identity.variant) &&
    representationProducerPattern.test(identity.producer) &&
    representationProducerVersionPattern.test(identity.producerVersion)
  );
}

/** ADR-0026 第 5 节：与版本 ID 同序同数；null=无派生表示；身份字段格式合法。 */
function validateRepresentations(
  values: readonly (AssetVersionRepresentationIdentity | null)[],
  versionCount: number,
): (AssetVersionRepresentationIdentity | null)[] {
  if (
    values.length !== versionCount ||
    values.some(
      (identity) =>
        identity !== null && !validateRepresentationIdentity(identity),
    )
  ) {
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
  /* ADR-0026 第 5 节：表示身份纳入上下文事实（同序同数），
     重新处理不能改变历史 Turn 已冻结的表示身份。 */
  const selectedAssetRepresentations = validateRepresentations(
    input.selectedAssetRepresentations,
    selectedAssetVersionIds.length,
  );
  const contextHash = createHash('sha256')
    .update(
      JSON.stringify({
        builderVersion: input.builderVersion,
        includedMessageIds,
        selectedAssetVersionIds,
        selectedAssetRepresentations,
        omittedMessageCount: input.omittedMessageCount,
        characterCount: input.characterCount,
      }),
    )
    .digest('hex');
  return {
    ...input,
    includedMessageIds,
    selectedAssetVersionIds,
    selectedAssetRepresentations,
    contextHash,
  };
}
