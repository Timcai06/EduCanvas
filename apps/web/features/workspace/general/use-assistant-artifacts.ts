import { useEffect, useRef } from 'react';

interface AssistantArtifactFlow {
  observeProposedArtifact(
    artifact: { artifactId: string; kind: string; title: string },
    options?: { openWhenReady?: boolean },
  ): Promise<void>;
  openArtifact(artifactId: string): Promise<void>;
}

/**
 * 桌面小助手创建的产物与打开请求，经 sessionStorage 传递后由本 hook 接管。
 * 与 W 线的工作面状态分离，不增加 workspace 主文件的职责。
 */
export function useAssistantArtifacts(artifactFlow: AssistantArtifactFlow) {
  const artifactConsumed = useRef(false);
  useEffect(() => {
    if (artifactConsumed.current) return;
    artifactConsumed.current = true;
    const raw = sessionStorage.getItem('educanvas.assistant_artifact');
    if (!raw) return;
    sessionStorage.removeItem('educanvas.assistant_artifact');
    try {
      const artifact = JSON.parse(raw) as {
        id: string;
        kind: string;
        title: string;
      };
      if (artifact.id && artifact.kind) {
        queueMicrotask(() => {
          void artifactFlow.observeProposedArtifact(
            {
              artifactId: artifact.id,
              kind: artifact.kind as
                | 'mind_map'
                | 'slides'
                | 'flashcards'
                | 'audio_overview'
                | 'note',
              title: artifact.title,
            },
            { openWhenReady: true },
          );
        });
      }
    } catch {
      // 格式异常，静默忽略
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artifactFlow.observeProposedArtifact]);

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
