import { useEffect, useRef } from 'react';

interface AssistantArtifactFlow {
  openArtifact(artifactId: string): Promise<void>;
}

/**
 * 桌面小助手的打开产物请求，经 sessionStorage 传递后由本 hook 接管。
 * 与 W 线的工作面状态分离，不增加 workspace 主文件的职责。
 */
export function useAssistantArtifacts(artifactFlow: AssistantArtifactFlow) {
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
      void artifactFlow.openArtifact(artifactId);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artifactFlow.openArtifact]);
}
