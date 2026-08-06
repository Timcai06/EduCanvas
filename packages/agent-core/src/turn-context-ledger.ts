export interface AgentTurnContextMaterial {
  builderVersion: string;
  /** 按实际进入 Prompt 的顺序保存，不允许重复。 */
  includedMessageIds: readonly string[];
  /**
   * 按实际进入 Prompt 的顺序保存不可变 AssetVersion ID，不允许重复。
   * 同一模型消息内的多个 Asset（如多张合并图片）按消息内顺序连续登记，
   * 因此账本可重建本轮模型实际可见的完整 Asset 集合。
   */
  selectedAssetVersionIds: readonly string[];
  omittedMessageCount: number;
  characterCount: number;
}

/** 只含不可变 ID、计数和摘要；不包含消息、Asset 或 Prompt 正文。 */
export interface AgentTurnContextSnapshot extends AgentTurnContextMaterial {
  id: string;
  operationId: string;
  contextHash: string;
  createdAt: string;
}

/**
 * Turn Application 的 Context Snapshot Ledger Port。
 * 实现必须重新验证 Actor、Conversation 与 Notebook 归属，并以 Operation 幂等。
 */
export interface AgentTurnContextLedgerPort {
  createOrGet(input: {
    operationId: string;
    actorId: string;
    material: AgentTurnContextMaterial;
  }): Promise<{ snapshot: AgentTurnContextSnapshot; replayed: boolean }>;
  get(input: {
    operationId: string;
    actorId: string;
  }): Promise<AgentTurnContextSnapshot | null>;
}
