'use client';

import { useEffect, useMemo, useState } from 'react';
import { fetchArtifactDetail } from './artifact-client';

interface MarkdownLineDiffSummary {
  addedLines: string[];
  removedLines: string[];
  addedCount: number;
  removedCount: number;
}

interface MarkdownVersionPayload {
  content: unknown;
  contentVersion: number;
  version: number;
}

function tryGetMarkdownContent(value: unknown): string | null {
  if (value === null || typeof value !== 'object') return null;
  const candidate = value as { contentVersion?: unknown; markdown?: unknown };
  if (
    candidate.contentVersion !== 1 ||
    typeof candidate.markdown !== 'string'
  ) {
    return null;
  }
  return candidate.markdown;
}

export function computeMarkdownVersionDiff(
  previousMarkdown: string,
  latestMarkdown: string,
  summaryLimit = 8,
): MarkdownLineDiffSummary {
  const previousLines = previousMarkdown.split('\n');
  const latestLines = latestMarkdown.split('\n');
  let prefixEnd = 0;
  while (
    prefixEnd < previousLines.length &&
    prefixEnd < latestLines.length &&
    previousLines[prefixEnd] === latestLines[prefixEnd]
  ) {
    prefixEnd += 1;
  }

  let previousSuffix = previousLines.length;
  let latestSuffix = latestLines.length;
  while (
    previousSuffix > prefixEnd &&
    latestSuffix > prefixEnd &&
    previousLines[previousSuffix - 1] === latestLines[latestSuffix - 1]
  ) {
    previousSuffix -= 1;
    latestSuffix -= 1;
  }

  const removedLines = previousLines.slice(prefixEnd, previousSuffix);
  const addedLines = latestLines.slice(prefixEnd, latestSuffix);

  return {
    addedLines: addedLines.slice(0, summaryLimit),
    removedLines: removedLines.slice(0, summaryLimit),
    addedCount: addedLines.length,
    removedCount: removedLines.length,
  };
}

export function MarkdownVersionDiffPanel({
  artifactId,
  displayedVersion,
  version,
}: {
  artifactId: string;
  displayedVersion: number;
  version: MarkdownVersionPayload | null;
}) {
  const [latestMarkdown, setLatestMarkdown] = useState<string | null>(null);
  const [error, setError] = useState<null | string>(null);
  const [loading, setLoading] = useState(true);

  const currentMarkdown = useMemo(() => {
    if (!version) return null;
    if (version.contentVersion !== 1) return null;
    return tryGetMarkdownContent(version.content);
  }, [version]);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      try {
        const latest = await fetchArtifactDetail(artifactId);
        const latestContent = latest.version;
        if (!latestContent) throw new Error('latest_version_unavailable');
        const sourceMarkdown = tryGetMarkdownContent(latestContent.content);
        if (sourceMarkdown === null) {
          throw new Error('invalid_latest_content');
        }
        if (!cancelled) {
          setLatestMarkdown(sourceMarkdown);
          setError(null);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setError('diff_load_failed');
          setLoading(false);
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [artifactId]);

  const diff = useMemo(() => {
    if (
      loading ||
      error ||
      currentMarkdown === null ||
      latestMarkdown === null
    ) {
      return null;
    }
    return computeMarkdownVersionDiff(currentMarkdown, latestMarkdown);
  }, [currentMarkdown, error, latestMarkdown, loading]);

  if (loading) {
    return (
      <section
        role="status"
        aria-label="版本差异加载中"
        className="border-b border-line px-4 py-2 text-xs text-ink-muted"
      >
        正在获取最新版本差异
      </section>
    );
  }

  if (version?.version !== displayedVersion) {
    return null;
  }

  if (currentMarkdown === null || version?.contentVersion !== 1) {
    return (
      <section
        role="alert"
        aria-label="版本差异不可用"
        className="border-b border-line px-4 py-2 text-xs text-cinnabar"
      >
        版本内容不支持差异对比
      </section>
    );
  }

  if (error) {
    return (
      <section
        role="alert"
        aria-label="版本差异加载失败"
        className="border-b border-line px-4 py-2 text-xs text-cinnabar"
      >
        版本差异加载失败，请重试。
      </section>
    );
  }

  if (!diff || (diff.addedCount === 0 && diff.removedCount === 0)) {
    return (
      <section
        role="status"
        aria-label="版本无差异"
        className="border-b border-line px-4 py-2 text-xs text-ink-muted"
      >
        与最新版本内容一致
      </section>
    );
  }

  return (
    <section
      aria-label="版本差异摘要"
      className="space-y-1 border-b border-line px-4 py-2.5 text-xs"
    >
      <p className="font-semibold text-ink">
        版本差异（v{displayedVersion} → v_latest）
      </p>
      <p className="text-ink-muted">
        新增 {diff.addedCount} 行，删除 {diff.removedCount} 行
      </p>
      {diff.removedLines.length === 0 ? null : (
        <div>
          <p className="text-cinnabar">删除</p>
          {diff.removedLines.map((line, index) => (
            <p key={`rm-${index}`} className="pl-3 text-cinnabar">
              - {line}
            </p>
          ))}
          {diff.removedLines.length < diff.removedCount ? (
            <p className="pl-3 text-ink-muted">…</p>
          ) : null}
        </div>
      )}
      {diff.addedLines.length === 0 ? null : (
        <div>
          <p className="text-accent">新增</p>
          {diff.addedLines.map((line, index) => (
            <p key={`add-${index}`} className="pl-3 text-accent">
              + {line}
            </p>
          ))}
          {diff.addedLines.length < diff.addedCount ? (
            <p className="pl-3 text-ink-muted">…</p>
          ) : null}
        </div>
      )}
    </section>
  );
}
