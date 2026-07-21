export const toolEffectLedgerStatuses = [
  'intended',
  'committed',
  'failed',
  'outcome_unknown',
] as const;
export type ToolEffectLedgerStatus = (typeof toolEffectLedgerStatuses)[number];
export type ToolEffectLedgerTerminalStatus = Extract<
  ToolEffectLedgerStatus,
  'committed' | 'failed' | 'outcome_unknown'
>;

/** write工具的最小副作用证据；不包含参数、结果、Credential或外部异常。 */
export interface ToolEffectLedgerSnapshot {
  id: string;
  operationId: string;
  toolCallId: string;
  effectKey: string;
  semanticsHash: string;
  status: ToolEffectLedgerStatus;
  code: string | null;
  receiptHash: string | null;
  intendedAt: string;
  settledAt: string | null;
}

/** Tool Kernel 是effect ledger唯一语义写者；checkpoint和worker不得调用本Port提交副作用。 */
export interface ToolEffectLedgerPort {
  intend(input: {
    operationId: string;
    actorId: string;
    toolCallId: string;
    effectKey: string;
    semanticsHash: string;
  }): Promise<{ effect: ToolEffectLedgerSnapshot; replayed: boolean }>;
  settle(input: {
    operationId: string;
    actorId: string;
    effectId: string;
    status: ToolEffectLedgerTerminalStatus;
    code?: string | null;
    /** 外部可验证回执的SHA-256；绝不接受回执正文。 */
    receiptHash?: string | null;
  }): Promise<{ effect: ToolEffectLedgerSnapshot; transitioned: boolean }>;
  get(input: {
    operationId: string;
    actorId: string;
    effectKey: string;
  }): Promise<ToolEffectLedgerSnapshot | null>;
}
