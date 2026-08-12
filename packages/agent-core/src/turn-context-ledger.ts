import type {
  AssetRepresentationKind,
  RepresentationQuality,
} from './asset-contracts';

/**
 * ADR-0026 第 5 节：冻结到 Context Snapshot 的实际表示身份。
 * 标识本轮模型实际使用的派生表示，不包含任何对象存储位置。
 */
export interface AssetVersionRepresentationIdentity {
  /** 表示类型（text / transcription / …）。 */
  kind: AssetRepresentationKind;
  /** 文档质量四态之一；只读事实，不允许改写历史。 */
  quality: RepresentationQuality;
  variant: string;
  producer: string;
  producerVersion: string;
}

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
  /**
   * ADR-0026 第 5 节：与 selectedAssetVersionIds 同序、同数的实际表示身份，
   * null 表示该版本无派生表示（原生图片段/旧资产）。
   * 后续重新处理（如 MinerU 重跑）不能改变历史 Turn 已冻结的表示事实。
   */
  selectedAssetRepresentations: readonly (AssetVersionRepresentationIdentity | null)[];
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
