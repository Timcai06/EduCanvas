export type DesktopChatRole = 'user' | 'assistant' | 'system';
export type DesktopChatSource = 'text' | 'voice';
export type DesktopChatMessageStatus =
  | 'pending'
  | 'streaming'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted';

/**
 * 服务端 citation target 的受限投影（DP06 保留资源身份；卡片渲染留 DP07）。
 * 镜像 gateway-core 的 `GatewayCitationTarget`，renderer 侧保持纯本地类型。
 */
export type DesktopCitationTarget =
  | {
      kind: 'knowledge';
      sourceId: string;
      documentId: string;
      chunkId: string;
      pageStart: number | null;
      pageEnd: number | null;
    }
  | { kind: 'web'; assetId: string; assetVersionId: string; url: string }
  | { kind: 'asset'; assetId: string; assetVersionId: string };

/** 服务端 citation 的受限投影（DP06 保留资源身份；卡片渲染留 DP07）。 */
export interface DesktopCitation {
  citationId: string;
  marker?: number;
  label: string;
  target: DesktopCitationTarget;
}

export type DesktopArtifactStatus =
  'proposed' | 'version_added' | 'generating' | 'failed';

/**
 * Artifact 生命周期的受限投影。versionId/progress/code 依事件阶段可选；
 * kind/title 只在 proposed 阶段可得，后续事件由 renderer 按 artifactId 合并保留。
 */
export interface DesktopArtifactRef {
  artifactId: string;
  artifactKind: string | null;
  title: string | null;
  status: DesktopArtifactStatus;
  versionId?: string;
  progress?: number;
  code?: string;
}

/** approval.required 的受限投影，保留 approvalId/operationId 供后续审批或取消。 */
export interface DesktopApprovalRef {
  approvalId: string;
  operationId: string;
  capability: string;
  risk: string;
  summary: string;
  expiresAt: string;
}

/**
 * 可删除、可从服务端 canonical Message 重建的 View Cache 投影。
 * - `id`：服务端 canonical messageId（已知时）；乐观消息在服务端事实到达前使用本地 id。
 * - `clientMessageId`：一次 Turn 的稳定请求身份，用于乐观 User Message 与服务端事实去重。
 * - `citations`/`artifacts`/`pendingApproval`：流式期间保留的结构化事件（DP06），
 *   仅存于流式占位消息的内存态；重建历史时不回填，卡片渲染留 DP07/DP08。
 */
export interface DesktopChatMessage {
  id: string;
  clientMessageId: string | null;
  role: DesktopChatRole;
  content: string;
  source: DesktopChatSource;
  status: DesktopChatMessageStatus;
  createdAt: string;
  citations?: readonly DesktopCitation[];
  artifacts?: readonly DesktopArtifactRef[];
  pendingApproval?: DesktopApprovalRef | null;
}

export interface DesktopChatMessageInput {
  role: DesktopChatRole;
  content: string;
  source: DesktopChatSource;
  clientMessageId?: string;
  status?: DesktopChatMessageStatus;
}

export interface DesktopChatHistorySnapshot {
  revision: number;
  conversationId: string | null;
  messages: readonly DesktopChatMessage[];
  hasMore: boolean;
  /** 服务端分页游标；指向当前窗口最旧一条更早的页，用于「向上加载更早页」。 */
  nextCursor: string | null;
  loading: boolean;
}

/** 服务端 canonical Message 的历史投影（与 gateway 契约对齐）。 */
export interface DesktopCanonicalMessage {
  messageId: string;
  clientMessageId: string;
  role: 'user' | 'assistant';
  status: DesktopChatMessageStatus;
  content: string;
  createdAt: string;
}
