/**
 * `WorkspaceSurface` 显式状态模型（W01）。
 *
 * 目标：把 `general-chat-workspace.tsx` 中靠级联三元 + 手工 `setX(null)` 组合的隐式互斥，
 * 收敛为单一判别联合状态，互斥由 reducer 保证，组件不再散落清理逻辑。
 *
 * 设计要点：
 * - 判别联合只存标识（resourceId / artifactId / html source），不持有详情数据；
 *   详情仍由各工作面的局部 controller（`useArtifactGeneration`、`useStudioOpenActions`）管理，
 *   与 W02"各工作面拥有局部 controller"对齐。
 * - `loading` / `failed` 显式建模资源打开的中间态与失败态（对齐 W01 示例）；
 *   `failed` 携带稳定 code，不把失败伪装成空。
 * - 互斥语义统一：任何 `open*` 动作都先清理其它工作面，消除
 *   characterization 发现的"status_card 打开 Artifact 保留 HTML Preview"不一致
 *   （见 `workspace-surface-contract.ts` 的 `OPEN_ARTIFACT_KEEPS_HTML_PREVIEW`）。
 */

/** 资源打开目标（source 用 asset id，artifact 用 artifact id，html 用消息内嵌 source）。 */
export type WorkspaceTarget =
  | { readonly kind: 'source'; readonly resourceId: string }
  | { readonly kind: 'artifact'; readonly artifactId: string }
  | { readonly kind: 'html'; readonly source: string };

/** 资源打开的稳定失败码（对齐 W03 诚实失败语义，非展示文案）。 */
export type WorkspaceFailureCode =
  'empty' | 'unavailable' | 'forbidden' | 'not_found' | 'failed' | 'offline';

/** 单一工作面状态：同一时刻至多一个工作面是打开的。 */
export type WorkspaceSurface =
  | { readonly type: 'none' }
  | { readonly type: 'studio' }
  | {
      readonly type: 'source';
      readonly resourceId: string;
      readonly full: boolean;
    }
  | {
      readonly type: 'artifact';
      readonly artifactId: string;
      readonly full: boolean;
    }
  | { readonly type: 'html'; readonly source: string; readonly full: boolean }
  | { readonly type: 'loading'; readonly target: WorkspaceTarget }
  | {
      readonly type: 'failed';
      readonly target: WorkspaceTarget;
      readonly code: WorkspaceFailureCode;
    };

export type WorkspaceAction =
  | { readonly type: 'openStudio' }
  | { readonly type: 'closeStudio' }
  | { readonly type: 'openSource'; readonly resourceId: string }
  | { readonly type: 'openArtifact'; readonly artifactId: string }
  | { readonly type: 'openHtml'; readonly source: string }
  | { readonly type: 'close' }
  | { readonly type: 'toggleFull' }
  | { readonly type: 'beginLoad'; readonly target: WorkspaceTarget }
  | {
      readonly type: 'fail';
      readonly target: WorkspaceTarget;
      readonly code: WorkspaceFailureCode;
    }
  | { readonly type: 'reset' };

export const INITIAL_SURFACE: WorkspaceSurface = { type: 'none' };

/**
 * WorkspaceSurface reducer：所有互斥清理都发生在 `open*`/`close` 分支，
 * 外部调用方不再需要手动清兄弟状态。
 */
export function workspaceSurfaceReducer(
  state: WorkspaceSurface,
  action: WorkspaceAction,
): WorkspaceSurface {
  switch (action.type) {
    case 'openStudio':
      return { type: 'studio' };
    case 'closeStudio':
      return state.type === 'studio' ? { type: 'none' } : state;
    case 'openSource':
      return { type: 'source', resourceId: action.resourceId, full: false };
    case 'openArtifact':
      return { type: 'artifact', artifactId: action.artifactId, full: false };
    case 'openHtml':
      return { type: 'html', source: action.source, full: false };
    case 'close':
      return { type: 'none' };
    case 'toggleFull':
      return state.type === 'source' ||
        state.type === 'artifact' ||
        state.type === 'html'
        ? { ...state, full: !state.full }
        : state;
    case 'beginLoad':
      return { type: 'loading', target: action.target };
    case 'fail':
      return { type: 'failed', target: action.target, code: action.code };
    case 'reset':
      return INITIAL_SURFACE;
  }
}

/** 是否处于"正在打开"或"打开失败"的非内容态（供 UI 显示加载/错误槽位）。 */
export function isPending(surface: WorkspaceSurface): boolean {
  return surface.type === 'loading' || surface.type === 'failed';
}

/** 取当前打开的工作面标识（供深链/恢复/断言使用），无打开时返回 null。 */
export function activeTarget(
  surface: WorkspaceSurface,
): WorkspaceTarget | null {
  switch (surface.type) {
    case 'source':
      return { kind: 'source', resourceId: surface.resourceId };
    case 'artifact':
      return { kind: 'artifact', artifactId: surface.artifactId };
    case 'html':
      return { kind: 'html', source: surface.source };
    default:
      return null;
  }
}
