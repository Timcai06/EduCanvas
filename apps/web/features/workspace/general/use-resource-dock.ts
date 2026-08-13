'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { WorkspaceResourceSummary } from '@educanvas/canvas-protocol';
import {
  fetchWorkspaceResourcePage,
  type WorkspaceResourcePage,
} from '@/features/canvas/workspace-resource-client';

export interface ResourceDockState {
  readonly items: readonly WorkspaceResourceSummary[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
  readonly loading: boolean;
  readonly error: Error | null;
}

export interface UseResourceDockResult extends ResourceDockState {
  readonly loadMore: () => Promise<void>;
  readonly loadAll: () => Promise<void>;
  readonly reload: () => Promise<void>;
}

interface StoredResourceDockState extends ResourceDockState {
  readonly notebookId: string;
}

/** 合并一页摘要；列表阶段只处理摘要，不触发任何逐项详情请求。 */
export function appendResourceDockPage(
  current: readonly WorkspaceResourceSummary[],
  page: WorkspaceResourcePage,
): Pick<ResourceDockState, 'items' | 'nextCursor' | 'hasMore'> {
  const seen = new Set(
    current.map((item) => `${item.resourceKind}:${item.resourceId}`),
  );
  const items = [
    ...current,
    ...page.items.filter((item) => {
      const key = `${item.resourceKind}:${item.resourceId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
  ];
  return {
    items,
    nextCursor: page.nextCursor,
    hasMore: page.nextCursor !== null,
  };
}

const initialState: ResourceDockState = {
  items: [],
  nextCursor: null,
  hasMore: false,
  loading: false,
  error: null,
};

/**
 * 资源 Dock 的唯一列表读取 seam。
 * notebookId 变化会取消旧请求并清空旧资源，防止跨 Notebook 显示残留摘要。
 */
export function useResourceDock(notebookId: string): UseResourceDockResult {
  const [state, setState] = useState<StoredResourceDockState>(() => ({
    ...initialState,
    notebookId,
  }));
  const controllerRef = useRef<AbortController | null>(null);
  const generationRef = useRef(0);
  const itemsRef = useRef<readonly WorkspaceResourceSummary[]>([]);
  const cursorRef = useRef<string | null>(null);
  const loadingRef = useRef(false);

  const requestPage = useCallback(
    async (
      cursor: string | null,
      replace: boolean,
      generation: number,
      targetNotebookId: string,
    ) => {
      if (loadingRef.current) return;
      loadingRef.current = true;
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      setState((current) => ({
        ...(current.notebookId === targetNotebookId ? current : initialState),
        notebookId: targetNotebookId,
        loading: true,
        error: null,
      }));
      try {
        const page = await fetchWorkspaceResourcePage({
          filter: 'all',
          cursor: cursor ?? undefined,
          signal: controller.signal,
        });
        if (controller.signal.aborted || generation !== generationRef.current)
          return;
        if (
          page.nextCursor !== null &&
          (page.nextCursor === cursor || page.items.length === 0)
        ) {
          throw new Error('资源分页游标没有向前推进。');
        }
        const merged = appendResourceDockPage(
          replace ? [] : itemsRef.current,
          page,
        );
        if (
          !replace &&
          page.nextCursor !== null &&
          merged.items.length === itemsRef.current.length
        ) {
          throw new Error('资源分页没有返回新的资源。');
        }
        itemsRef.current = merged.items;
        cursorRef.current = merged.nextCursor;
        setState({
          ...merged,
          notebookId: targetNotebookId,
          loading: false,
          error: null,
        });
      } catch (error: unknown) {
        if (controller.signal.aborted || generation !== generationRef.current)
          return;
        const normalized =
          error instanceof Error ? error : new Error('资源列表暂时不可用。');
        setState((current) => ({
          ...current,
          loading: false,
          error: normalized,
        }));
      } finally {
        if (controllerRef.current === controller) {
          controllerRef.current = null;
          loadingRef.current = false;
        }
      }
    },
    [],
  );

  const reload = useCallback(async () => {
    generationRef.current += 1;
    controllerRef.current?.abort();
    loadingRef.current = false;
    itemsRef.current = [];
    cursorRef.current = null;
    setState({ ...initialState, notebookId });
    await requestPage(null, true, generationRef.current, notebookId);
  }, [notebookId, requestPage]);

  const loadMore = useCallback(async () => {
    if (!cursorRef.current || loadingRef.current) return;
    await requestPage(
      cursorRef.current,
      false,
      generationRef.current,
      notebookId,
    );
  }, [notebookId, requestPage]);

  const loadAll = useCallback(async () => {
    while (cursorRef.current && !loadingRef.current) {
      const previous = cursorRef.current;
      await requestPage(previous, false, generationRef.current, notebookId);
      if (cursorRef.current === previous) break;
    }
  }, [notebookId, requestPage]);

  useEffect(() => {
    generationRef.current += 1;
    controllerRef.current?.abort();
    itemsRef.current = [];
    cursorRef.current = null;
    loadingRef.current = false;
    void requestPage(null, true, generationRef.current, notebookId);
    return () => controllerRef.current?.abort();
  }, [notebookId, requestPage]);

  const visibleState = state.notebookId === notebookId ? state : initialState;
  return { ...visibleState, loadMore, loadAll, reload };
}
