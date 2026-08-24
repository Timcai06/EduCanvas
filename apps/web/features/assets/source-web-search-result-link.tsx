import { ArrowSquareOut } from '@phosphor-icons/react';
import type { WebSearchResult } from './web-search-client';

/** External navigation remains separate from selection and import mutations. */
export function SourceWebSearchResultLink({
  result,
}: {
  result: Pick<WebSearchResult, 'title' | 'url' | 'domain'>;
}) {
  return (
    <a
      href={result.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      aria-label={`${result.title}（在新标签页打开）`}
    >
      <h4 className="flex items-start gap-1.5 text-sm font-semibold leading-5 text-ink transition-colors group-hover:text-accent">
        <span>{result.title}</span>
        <ArrowSquareOut
          size={14}
          className="mt-0.5 shrink-0 text-ink-faint transition-colors group-hover:text-accent"
          aria-hidden="true"
        />
      </h4>
      <p className="mt-1 truncate text-xs text-ink-faint">{result.domain}</p>
    </a>
  );
}
