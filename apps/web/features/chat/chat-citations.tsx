import { ArrowSquareOut } from '@phosphor-icons/react';
import type { MessageCitationDTO } from './messages';

export function ChatCitations({
  citations,
  messageId,
  onOpenSource,
}: {
  citations: readonly MessageCitationDTO[];
  messageId: string;
  onOpenSource?: (assetId: string) => void;
}) {
  return (
    <div
      className="marginalia flex flex-col gap-0.5 pt-1"
      aria-label="回答引用"
    >
      {citations.map((citation) => {
        const content = (
          <>
            {citation.marker !== undefined ? (
              <span className="marginalia__marker">{citation.marker}</span>
            ) : null}
            <span className="max-w-72 truncate">{citation.label}</span>
          </>
        );
        const anchorId =
          citation.marker !== undefined
            ? `cite-${messageId}-${citation.marker}`
            : undefined;
        if (citation.kind === 'web') {
          return (
            <div
              key={citation.id}
              {...(anchorId ? { id: anchorId } : {})}
              className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 scroll-mt-24"
            >
              <span className="marginalia__item">{content}</span>
              {onOpenSource ? (
                <button
                  type="button"
                  aria-label={`打开来源 ${citation.label}`}
                  title="在当前笔记本中打开来源"
                  onClick={() => onOpenSource(citation.assetId)}
                  className="text-xs text-accent underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
                >
                  打开来源
                </button>
              ) : null}
              <a
                href={citation.url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`打开原网页 ${citation.label}`}
                title="打开原网页"
                className="marginalia__item text-xs hover:text-accent"
              >
                <ArrowSquareOut
                  aria-hidden="true"
                  size={12}
                  className="self-center"
                />
                <span>打开原网页</span>
              </a>
            </div>
          );
        }
        return (
          <span
            key={citation.id}
            {...(anchorId ? { id: anchorId } : {})}
            className="marginalia__item scroll-mt-24"
            title="来自本轮冻结的课程资料版本"
          >
            {content}
          </span>
        );
      })}
    </div>
  );
}
