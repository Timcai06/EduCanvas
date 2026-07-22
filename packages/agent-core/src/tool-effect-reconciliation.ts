export const toolEffectReconciliationSources = ['manual', 'adapter'] as const;
export type ToolEffectReconciliationSource =
  (typeof toolEffectReconciliationSources)[number];

export const toolEffectReconciliationResolutions = [
  'confirmed_committed',
  'confirmed_not_committed',
] as const;
export type ToolEffectReconciliationResolution =
  (typeof toolEffectReconciliationResolutions)[number];

/** outcome_unknown副作用的追加式决议；不包含参数、输出、Credential或证据正文。 */
export interface ToolEffectReconciliationSnapshot {
  effectId: string;
  operationId: string;
  effectKey: string;
  semanticsHash: string;
  resolution: ToolEffectReconciliationResolution;
  source: ToolEffectReconciliationSource;
  resolverId: string;
  evidenceHash: string;
  receiptHash: string | null;
  code: string | null;
  resolvedAt: string;
}

/**
 * 追加式Effect对账仓储。实现必须重验Actor归属，只允许outcome_unknown写副作用，
 * 并以effectId及预期语义执行CAS；不得改写原Effect、Tool Call或Operation终态。
 */
export interface ToolEffectReconciliationPort {
  get(input: {
    operationId: string;
    actorId: string;
    effectId: string;
  }): Promise<ToolEffectReconciliationSnapshot | null>;
  record(input: {
    operationId: string;
    actorId: string;
    effectId: string;
    expectedEffectKey: string;
    expectedSemanticsHash: string;
    resolution: ToolEffectReconciliationResolution;
    source: ToolEffectReconciliationSource;
    resolverId: string;
    /** 受信核验证据的SHA-256；绝不接受证据正文。 */
    evidenceHash: string;
    /** confirmed_committed可携带的外部回执SHA-256。 */
    receiptHash?: string | null;
    /** confirmed_not_committed必须携带的稳定原因码。 */
    code?: string | null;
  }): Promise<{
    reconciliation: ToolEffectReconciliationSnapshot;
    recorded: boolean;
  }>;
}
