'use client';

import { useState } from 'react';
import type { ArtifactProposalKind } from '@educanvas/agent-core';
import { Button } from '@/components/ui/button';
import { notebookScopedFetch } from './notebook-request-context';

const KINDS: readonly { value: ArtifactProposalKind; label: string }[] = [
  { value: 'markdown_document', label: 'Markdown 文档' },
  { value: 'mind_map', label: '思维导图' },
  { value: 'slides', label: 'Slides' },
  { value: 'flashcards', label: '闪卡' },
  { value: 'picturebook', label: '知识绘本' },
  { value: 'note', label: '笔记' },
  { value: 'web_app', label: 'Web App' },
];

export function ArtifactConfirmationCard({
  confirmation,
  onConfirm,
}: {
  confirmation: { id: string; kind: ArtifactProposalKind; title: string };
  onConfirm: (
    confirmationId: string,
    kind: ArtifactProposalKind,
    clientMessageId: string,
  ) => Promise<void> | void;
}) {
  const [kind, setKind] = useState(confirmation.kind);
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (dismissed) return null;

  const postAction = async (action: 'select' | 'cancel') => {
    setBusy(true);
    setError(null);
    try {
      const response = await notebookScopedFetch(
        `/api/v1/chat/artifact-confirmations/${encodeURIComponent(confirmation.id)}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(
            action === 'select' ? { action, kind } : { action },
          ),
        },
      );
      if (!response.ok) throw new Error('artifact_confirmation_failed');
      if (action === 'cancel') {
        setDismissed(true);
        return;
      }
      const result = (await response.json()) as {
        clientMessageId?: unknown;
        kind?: unknown;
      };
      if (
        typeof result.clientMessageId !== 'string' ||
        typeof result.kind !== 'string' ||
        !KINDS.some((item) => item.value === result.kind)
      ) {
        throw new Error('artifact_confirmation_failed');
      }
      await onConfirm(
        confirmation.id,
        result.kind as ArtifactProposalKind,
        result.clientMessageId,
      );
      setDismissed(true);
    } catch {
      setError('操作未完成，请重试。');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      className="max-w-lg rounded-2xl border border-accent/30 bg-accent-soft/30 p-4"
      aria-label="确认产物类型"
      data-artifact-confirmation={confirmation.id}
    >
      <p className="text-sm font-semibold text-ink">建议创建持久产物</p>
      <p className="mt-1 text-sm text-ink-muted">{confirmation.title}</p>
      <label className="mt-3 block text-sm text-ink">
        类型
        <select
          className="mt-1 block min-h-10 w-full rounded-lg border border-line bg-card px-3"
          value={kind}
          onChange={(event) =>
            setKind(event.currentTarget.value as ArtifactProposalKind)
          }
          disabled={busy}
        >
          {KINDS.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          variant="primary"
          size="md"
          disabled={busy}
          onClick={() => void postAction('select')}
        >
          {busy ? '处理中…' : '确认并创建'}
        </Button>
        <Button
          variant="secondary"
          size="md"
          disabled={busy}
          onClick={() => void postAction('cancel')}
        >
          取消
        </Button>
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
      <p className="mt-2 text-xs text-ink-muted">
        确认后才会开始创建；任务提交不代表生成完成。
      </p>
    </section>
  );
}
