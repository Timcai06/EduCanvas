import type {
  DesktopArtifactRef,
  DesktopChatMessage,
  DesktopMessagePart,
  DesktopResultTarget,
} from '../../shared/chat-history';

export function MessageResultCards(props: {
  message: DesktopChatMessage;
  openResult(target: DesktopResultTarget): Promise<void> | void;
}) {
  const { message, openResult } = props;
  const citations = message.citations ?? [];
  const images = (message.parts ?? []).filter(
    (part): part is Extract<DesktopMessagePart, { type: 'image' }> =>
      part.type === 'image',
  );
  const unsupported = (message.parts ?? []).filter(
    (part): part is Extract<DesktopMessagePart, { type: 'unsupported' }> =>
      part.type === 'unsupported',
  );
  const artifacts = mergeArtifacts(message);
  const tools = message.toolActivities ?? [];

  if (
    citations.length === 0 &&
    images.length === 0 &&
    artifacts.length === 0 &&
    tools.length === 0 &&
    unsupported.length === 0
  ) {
    return null;
  }

  return (
    <div className="message-results">
      {tools.length > 0 && (
        <section className="result-group" aria-label="工具进度">
          {tools.map((tool) => (
            <div
              className="result-card result-card--tool"
              key={tool.toolCallId}
            >
              <span
                className={`result-status is-${tool.status}`}
                aria-hidden="true"
              />
              <div>
                <strong>{tool.summary}</strong>
                <span>{toolStatusLabel(tool.status)}</span>
              </div>
            </div>
          ))}
        </section>
      )}

      {citations.length > 0 && (
        <section className="result-group" aria-label="引用来源">
          {citations.map((citation, index) => (
            <article className="result-card" key={citation.citationId}>
              <span className="result-card__marker">
                [{citation.marker ?? index + 1}]
              </span>
              <div className="result-card__body">
                <strong>{citation.label}</strong>
                <span>{citationLocation(citation.target)}</span>
              </div>
              <button
                type="button"
                onClick={() => void openResult(citation.target)}
              >
                查看来源
              </button>
            </article>
          ))}
        </section>
      )}

      {images.map((part) => (
        <article
          className="result-card result-card--media"
          key={`${part.assetId}:${part.versionId}`}
        >
          <div
            className="result-card__thumbnail"
            role="img"
            aria-label={`图片预览：${part.label}`}
          >
            <ImageIcon />
          </div>
          <div className="result-card__body">
            <strong>{part.label}</strong>
            <span>图片结果</span>
          </div>
          <button
            type="button"
            onClick={() =>
              void openResult({
                kind: 'asset',
                assetId: part.assetId,
                assetVersionId: part.versionId,
              })
            }
          >
            在 EduCanvas 中打开
          </button>
        </article>
      ))}

      {artifacts.map((artifact) => (
        <article className="result-card" key={artifact.artifactId}>
          <span className="result-card__kind" aria-hidden="true">
            {artifactKindGlyph(artifact.artifactKind)}
          </span>
          <div className="result-card__body">
            <strong>
              {artifact.title ?? artifactKindLabel(artifact.artifactKind)}
            </strong>
            <span>{artifactStatusLabel(artifact)}</span>
          </div>
          <button
            type="button"
            disabled={artifact.status === 'failed'}
            onClick={() =>
              void openResult({
                kind: 'artifact',
                artifactId: artifact.artifactId,
                versionId: artifact.versionId ?? null,
              })
            }
          >
            在 EduCanvas 中打开
          </button>
        </article>
      ))}

      {unsupported.map((part, index) => (
        <article className="result-card" key={`${part.partType}:${index}`}>
          <span className="result-card__kind" aria-hidden="true">
            ↗
          </span>
          <div className="result-card__body">
            <strong>{part.label}</strong>
            <span>此内容需要在 Web 查看</span>
          </div>
          {part.target && (
            <button type="button" onClick={() => void openResult(part.target!)}>
              在 EduCanvas 中打开
            </button>
          )}
        </article>
      ))}
    </div>
  );
}

function mergeArtifacts(message: DesktopChatMessage): DesktopArtifactRef[] {
  const byId = new Map<string, DesktopArtifactRef>();
  for (const part of message.parts ?? []) {
    if (part.type !== 'artifact') continue;
    byId.set(part.artifactId, {
      artifactId: part.artifactId,
      artifactKind: part.artifactKind,
      title: part.label,
      status: 'version_added',
      versionId: part.versionId,
    });
  }
  for (const artifact of message.artifacts ?? []) {
    const previous = byId.get(artifact.artifactId);
    byId.set(artifact.artifactId, {
      ...previous,
      ...artifact,
      artifactKind: artifact.artifactKind ?? previous?.artifactKind ?? null,
      title: artifact.title ?? previous?.title ?? null,
    });
  }
  return [...byId.values()];
}

function citationLocation(target: DesktopResultTarget): string {
  if (target.kind === 'knowledge') {
    if (target.pageStart === null) return '知识库来源';
    if (target.pageEnd !== null && target.pageEnd !== target.pageStart)
      return `第 ${target.pageStart}–${target.pageEnd} 页`;
    return `第 ${target.pageStart} 页`;
  }
  if (target.kind === 'web') return '网页来源';
  if (target.kind === 'artifact') return '生成内容';
  return '资源来源';
}

function toolStatusLabel(status: 'started' | 'completed' | 'failed'): string {
  if (status === 'completed') return '处理完成';
  if (status === 'failed') return '处理失败';
  return '处理中';
}

function artifactStatusLabel(artifact: DesktopArtifactRef): string {
  if (artifact.status === 'version_added')
    return artifact.versionId ? `已生成 · ${artifact.versionId}` : '已生成';
  if (artifact.status === 'generating')
    return artifact.progress === undefined
      ? '生成中'
      : `生成中 ${Math.round(artifact.progress * 100)}%`;
  if (artifact.status === 'failed') return '生成失败';
  return '准备生成';
}

function artifactKindLabel(kind: string | null): string {
  return (
    {
      mind_map: '思维导图',
      slides: '幻灯片',
      image: '图片',
      document: '文档',
      canvas: 'Canvas',
    }[kind ?? ''] ?? '生成内容'
  );
}

function artifactKindGlyph(kind: string | null): string {
  return kind === 'mind_map' ? '⌘' : kind === 'slides' ? '▤' : '◇';
}

function ImageIcon() {
  return (
    <svg viewBox="0 0 32 24" aria-hidden="true">
      <path d="M3 3.5h26v17H3zM7 17l6-6 4 4 3-3 5 5M22 8h.01" />
    </svg>
  );
}
