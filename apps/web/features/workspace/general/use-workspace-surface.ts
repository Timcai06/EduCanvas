'use client';

import { useCallback, useReducer } from 'react';
import {
  INITIAL_SURFACE,
  workspaceSurfaceReducer,
  type WorkspaceAction,
  type WorkspaceSurface,
} from './workspace-surface';

/**
 * W01 `WorkspaceSurface` 判别联合的 React 桥接。
 *
 * `workspace-surface.ts` 是纯 reducer（无 React 依赖），这里用 `useReducer` 把它接入组件。
 * 互斥语义全部收敛在 reducer 分支里，组件/controller 不再散落手工 `setX(null)` 组合。
 *
 * 设计约束：
 * - 只封装"打开/关闭/toggle"等 surface 状态动作；资源验证、详情加载仍由各工作面局部
 *   controller（`useStudioOpenActions`、`useArtifactGeneration`）负责，验证成功后再 dispatch。
 * - `loading`/`failed` 中间态由 W03 诚实失败接入，本层不判断详情是否就绪。
 */

export interface UseWorkspaceSurfaceResult {
  /** 当前工作面判别联合（互斥由 reducer 保证）。 */
  readonly surface: WorkspaceSurface;
  readonly openSource: (resourceId: string) => void;
  readonly openArtifact: (artifactId: string) => void;
  readonly openHtml: (source: string) => void;
  readonly openStudio: () => void;
  readonly closeStudio: () => void;
  /** 关闭当前打开的工作面（source/artifact/html 统一出口）。 */
  readonly close: () => void;
  readonly toggleFull: () => void;
  /** 透传原始 action，供需要直接 dispatch 的组合动作使用。 */
  readonly dispatch: (action: WorkspaceAction) => void;
}

export function useWorkspaceSurface(): UseWorkspaceSurfaceResult {
  const [surface, dispatch] = useReducer(
    workspaceSurfaceReducer,
    INITIAL_SURFACE,
  );

  return {
    surface,
    openSource: useCallback(
      (resourceId: string) => dispatch({ type: 'openSource', resourceId }),
      [],
    ),
    openArtifact: useCallback(
      (artifactId: string) => dispatch({ type: 'openArtifact', artifactId }),
      [],
    ),
    openHtml: useCallback(
      (source: string) => dispatch({ type: 'openHtml', source }),
      [],
    ),
    openStudio: useCallback(() => dispatch({ type: 'openStudio' }), []),
    closeStudio: useCallback(() => dispatch({ type: 'closeStudio' }), []),
    close: useCallback(() => dispatch({ type: 'close' }), []),
    toggleFull: useCallback(() => dispatch({ type: 'toggleFull' }), []),
    dispatch,
  };
}
