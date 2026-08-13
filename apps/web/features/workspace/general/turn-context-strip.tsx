'use client';

import type {
  TurnContextSnapshot,
  TurnContextSnapshotEntry,
} from '@/features/chat/turn-context-snapshot';

const omittedReasonLabels: Record<
  NonNullable<TurnContextSnapshotEntry['reason']>,
  string
> = {
  processing: '处理中',
  failed: '处理失败',
  disabled: '未启用',
  unavailable: '没有可用版本或当前不可用',
  limit: '超过本轮上限',
  duplicate: '重复版本',
};

export function formatTurnContextOmittedReason(
  entry: TurnContextSnapshotEntry,
): string {
  return entry.reason ? omittedReasonLabels[entry.reason] : '';
}

/**
 * 发送前的只读上下文事实条。它只消费 snapshot，不读取资源详情、不发请求，
 * 并把未进入本轮的原因明确呈现给键盘和读屏用户。
 */
export function TurnContextStrip({
  snapshot,
  maxVisibleTitles = 4,
}: {
  snapshot: TurnContextSnapshot | null;
  maxVisibleTitles?: number;
}) {
  if (!snapshot) return null;
  const ready = snapshot.included;
  const omitted = snapshot.omitted;
  const contextCount = ready.filter(
    (entry) => entry.usage === 'context',
  ).length;
  const attachmentCount = ready.filter(
    (entry) => entry.usage === 'attachment',
  ).length;
  const titles = ready.slice(0, Math.max(0, maxVisibleTitles));
  const hiddenReadyCount = Math.max(0, ready.length - titles.length);

  return (
    <section
      aria-label="本轮上下文"
      aria-live="polite"
      data-turn-context-strip
      className="mx-auto w-full max-w-3xl rounded-xl border border-line/70 bg-surface/70 px-3 py-2 text-xs text-ink-muted motion-safe:transition-[opacity,transform] motion-safe:duration-150"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <strong className="font-medium text-ink">本轮上下文</strong>
        <span>{ready.length} 项将带入</span>
        <span>长期 {contextCount}</span>
        <span>本轮 {attachmentCount}</span>
      </div>
      {titles.length > 0 ? (
        <ul
          aria-label="将带入的资料"
          className="mt-1 flex flex-wrap gap-x-3 gap-y-1"
        >
          {titles.map((entry) => (
            <li
              key={`${entry.id}:${entry.versionId ?? 'none'}`}
              className="max-w-full truncate"
            >
              {entry.label} ·{' '}
              {entry.versionId ? `版本 ${entry.versionId}` : '无版本'}
            </li>
          ))}
          {hiddenReadyCount > 0 ? <li>另有 {hiddenReadyCount} 项</li> : null}
        </ul>
      ) : null}
      {omitted.length > 0 ? (
        <ul
          aria-label="本轮未带入的资料"
          className="mt-1 space-y-0.5 text-danger"
        >
          {omitted.slice(0, 4).map((entry) => (
            <li
              key={`${entry.id}:${entry.versionId ?? 'none'}:${entry.reason}`}
            >
              {entry.label}：本轮未带入（{formatTurnContextOmittedReason(entry)}
              ）
            </li>
          ))}
          {omitted.length > 4 ? (
            <li>另有 {omitted.length - 4} 项未带入</li>
          ) : null}
        </ul>
      ) : null}
    </section>
  );
}
