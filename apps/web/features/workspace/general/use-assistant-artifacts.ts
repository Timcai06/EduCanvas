import { useEffect, useRef } from 'react';

interface AssistantArtifactOpenActions {
  openArtifact(artifactId: string): void;
}

/**
 * 桌面小助手的打开产物请求，经 sessionStorage 传递后由本 hook 接管。
 * 与 W 线的工作面状态分离，不增加 workspace 主文件的职责。
 */
export function useAssistantArtifacts(
  openActions: AssistantArtifactOpenActions,
) {
  const openConsumed = useRef(false);
  useEffect(() => {
    if (openConsumed.current) return;
    openConsumed.current = true;
    const artifactId = sessionStorage.getItem(
      'educanvas.assistant_open_artifact',
    );
    if (!artifactId) return;
    sessionStorage.removeItem('educanvas.assistant_open_artifact');
    queueMicrotask(() => {
      void openActions.openArtifact(artifactId);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openActions.openArtifact]);
}
