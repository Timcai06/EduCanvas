'use client';

import { CanvasHost } from './canvas-host';
import { CanvasShellStatus } from './canvas-shell-status';
import type { CanvasResourceClientError } from './canvas-resource-client';

export function CanvasResourceOpenStatus({
  pendingKind,
  error,
  onRetry,
  onClose,
}: {
  pendingKind: 'source' | 'artifact' | null;
  error: CanvasResourceClientError | null;
  onRetry: () => void;
  onClose: () => void;
}) {
  const kindLabel = pendingKind === 'artifact' ? '作品' : '来源';
  return (
    <CanvasHost
      ariaLabel="Canvas 资源状态"
      title={`打开${kindLabel}`}
      closeLabel="返回对话"
      onClose={onClose}
      isPending={pendingKind !== null}
    >
      {pendingKind ? (
        <CanvasShellStatus
          status="loading"
          title={`正在打开${kindLabel}`}
          description="正在验证资源与当前笔记本的访问关系。"
        />
      ) : error ? (
        <CanvasShellStatus
          status={error.kind}
          title="无法打开资源"
          description={error.message}
          onRetry={onRetry}
          retryLabel="重试"
        />
      ) : null}
    </CanvasHost>
  );
}
