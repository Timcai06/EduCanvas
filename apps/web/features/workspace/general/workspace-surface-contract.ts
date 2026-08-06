/**
 * Workspace 互斥行为的 characterization contract（W01 前置）。
 *
 * 从 `general-chat-workspace.tsx` 的 5 处手工清理链（W00 基线 §3.3/§5.3）忠实抽取
 * “打开一个工作面时清掉哪些兄弟”的当前行为，不改变任何语义。
 *
 * 用途：
 * 1. 固定现状，让 W01 的 `WorkspaceSurface` reducer 迁入同一行为时可用此契约测试回归；
 * 2. 忠实记录当前 5 处互斥链之间的不一致（见 `OPEN_ARTIFACT_KEEPS_HTML_PREVIEW`），
 *    为 W01 收敛提供行为基线。
 *
 * 注意：这是只读契约快照，不是生产状态模型。W01 落地后用 reducer 替换本文件。
 */

/** 当前 Workspace 工作面状态的极小子集，仅覆盖互斥链涉及的字段。 */
export interface WorkspaceMutexState {
  readonly sourceOpen: boolean;
  readonly sourcePreviewFull: boolean;
  readonly artifactOpen: boolean;
  readonly previewHtmlOpen: boolean;
  readonly studioOpen: boolean;
}

/** 当前互斥链入口。 */
export type MutexEntry =
  | 'open_source'
  | 'open_artifact_from_message'
  | 'open_artifact_from_status_card'
  | 'open_artifact_from_studio'
  | 'open_html_preview'
  | 'close_source';

/**
 * 各入口清理兄弟字段的行为映射（从 5 处 handler 忠实提取，`file:line` 见 W00 基线 §3.3）。
 *
 * - `open_source`：Studio onOpenSource（503-509）清 studio、artifact、previewHtml、source
 * - `open_artifact_from_message`：ChatPanel onOpenArtifact（394-399）清 source、previewHtml
 * - `open_artifact_from_studio`：Studio onOpenOutput（510-515）清 studio、source，保留 previewHtml
 * - `open_artifact_from_status_card`：ArtifactStatusCard onOpen（408-413）清 source，保留 previewHtml
 * - `open_html_preview`：ChatPanel onPreviewHtml（389-393）清 source
 * - `close_source`：SourceResourceRenderer onClose（479-482）清 source 与全屏
 */
const CLEARS: Record<
  MutexEntry,
  { readonly [K in keyof WorkspaceMutexState]?: boolean }
> = {
  open_source: {
    sourceOpen: false,
    sourcePreviewFull: false,
    artifactOpen: false,
    previewHtmlOpen: false,
    studioOpen: false,
  },
  open_artifact_from_message: {
    sourceOpen: false,
    sourcePreviewFull: false,
    previewHtmlOpen: false,
  },
  open_artifact_from_studio: {
    sourceOpen: false,
    sourcePreviewFull: false,
    studioOpen: false,
  },
  open_artifact_from_status_card: {
    sourceOpen: false,
    sourcePreviewFull: false,
  },
  open_html_preview: {
    sourceOpen: false,
    sourcePreviewFull: false,
  },
  close_source: {
    sourceOpen: false,
    sourcePreviewFull: false,
  },
};

/**
 * 当前是否“打开 Artifact 却保留 HTML Preview”：
 * message/studio 两个入口清 previewHtml，status_card 入口不清——这是现状的不一致。
 * W01 reducer 应统一为同一语义，并用此契约测试标记行为变化。
 */
export const OPEN_ARTIFACT_KEEPS_HTML_PREVIEW = true;

/** 按入口计算互斥清理后的下一个状态（忠实当前行为，包含已知不一致）。 */
export function applyMutexEntry(
  state: WorkspaceMutexState,
  entry: MutexEntry,
): WorkspaceMutexState {
  const clears = CLEARS[entry];
  // 中间用可变对象累积清理，避免对 readonly 属性直接赋值
  const next: {
    -readonly [K in keyof WorkspaceMutexState]: WorkspaceMutexState[K];
  } = {
    ...state,
  };
  for (const key of Object.keys(clears) as (keyof WorkspaceMutexState)[]) {
    if (clears[key] === false) {
      next[key] = false;
    }
  }
  return next;
}

/** 判断一组工作面是否同时开启（用于断言互斥不变量）。 */
export function hasConcurrentSurfaces(state: WorkspaceMutexState): boolean {
  const open = [
    state.sourceOpen,
    state.artifactOpen,
    state.previewHtmlOpen,
  ].filter(Boolean).length;
  return open > 1;
}
