'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import {
  readNotebookRequestContext,
  type NotebookRequestContext,
} from './notebook-request-context';

const Scope = createContext<NotebookRequestContext | null | undefined>(
  undefined,
);

/** 服务端恢复的课程范围只在当前 React 子树内传递；从不缓存身份或共享标签游标。 */
export function NotebookRequestScopeProvider({
  value,
  children,
}: {
  value: NotebookRequestContext | null;
  children: ReactNode;
}) {
  return <Scope.Provider value={value}>{children}</Scope.Provider>;
}

export function useNotebookRequestScope() {
  const explicit = useContext(Scope);
  const resolved =
    explicit === undefined ? readNotebookRequestContext() : explicit;
  const notebookId = resolved?.notebookId;
  const conversationId = resolved?.conversationId;
  return useMemo(
    () =>
      notebookId && conversationId ? { notebookId, conversationId } : null,
    [notebookId, conversationId],
  );
}
