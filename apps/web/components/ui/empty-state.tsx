import type { ReactNode } from 'react';

export function EmptyState({
  title,
  description,
  icon,
  action,
  compact = false,
}: {
  title: string;
  description: string;
  icon?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div
      className={`rounded-3xl border border-dashed border-line bg-surface/60 px-5 text-center ${
        compact ? 'py-6' : 'py-8'
      }`}
    >
      {icon ? (
        <span
          aria-hidden="true"
          className="mx-auto mb-3 grid size-9 place-items-center rounded-full bg-card text-ink-muted shadow-[var(--shadow-float)]"
        >
          {icon}
        </span>
      ) : (
        <span
          aria-hidden="true"
          className="mx-auto mb-3 block h-px w-10 bg-line"
        />
      )}
      <p className="text-sm font-medium text-ink">{title}</p>
      <p className="mt-1 text-caption leading-5 text-ink-muted">
        {description}
      </p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
