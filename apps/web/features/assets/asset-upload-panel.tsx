'use client';

import {
  FilePdf,
  Image as ImageIcon,
  SpinnerGap,
  UploadSimple,
} from '@phosphor-icons/react';
import { useRef, useState } from 'react';
import { toClientError } from '../canvas/resource-error';
import { uploadWorkspaceSource } from './source-intake';
import type { AssetItem } from './assets-drawer';

/** 浏览器文件选择器使用标准 OOXML MIME，并保留扩展名兜底空 MIME 系统。 */
export const DOCUMENT_UPLOAD_ACCEPT = [
  'application/pdf',
  'text/markdown',
  'text/plain',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pdf',
  '.md',
  '.markdown',
  '.txt',
  '.docx',
  '.pptx',
  '.xlsx',
].join(',');

/** 上传错误只展示项目稳定文案；浏览器/扩展抛出的原生错误不得透传给用户。 */
export function uploadErrorText(reason: unknown): string {
  return toClientError(reason, '文件上传失败，请重试。').message;
}

export function AssetUploadPanel({
  kind,
  onUploaded,
  endpoint,
  fixedScope,
}: {
  kind: AssetItem['kind'];
  onUploaded: (asset: AssetItem) => void;
  endpoint?: string;
  fixedScope?: AssetItem['scope'];
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [scope, setScope] = useState<AssetItem['scope']>(fixedScope ?? 'turn');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const accept =
    kind === 'image'
      ? 'image/png,image/jpeg,image/webp'
      : DOCUMENT_UPLOAD_ACCEPT;

  return (
    <div className="space-y-5">
      {!fixedScope ? (
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-ink">
            保存范围
          </legend>
          <div className="grid grid-cols-2 gap-2 rounded-2xl bg-surface p-1.5">
            {(['turn', 'space'] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={scope === value}
                onClick={() => setScope(value)}
                className={`min-h-11 rounded-xl px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                  scope === value
                    ? 'bg-card text-ink shadow-[var(--shadow-float)]'
                    : 'text-ink-muted hover:text-ink'
                }`}
              >
                {value === 'turn' ? '仅用于本轮' : '保存到空间'}
              </button>
            ))}
          </div>
        </fieldset>
      ) : null}

      <input
        ref={inputRef}
        type="file"
        accept={accept}
        aria-label={kind === 'image' ? '选择要上传的图片' : '选择要上传的文件'}
        tabIndex={-1}
        className="sr-only"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (!file || busy) return;
          setBusy(true);
          setError(null);
          void uploadWorkspaceSource({ file, scope, endpoint })
            .then(onUploaded)
            .catch((reason: unknown) => {
              /* 只展示项目稳定文案；浏览器/扩展抛出的原生错误（如
                 SecurityError: illegal path）不得直接透传给用户。 */
              setError(uploadErrorText(reason));
            })
            .finally(() => setBusy(false));
        }}
      />
      <div className="rounded-2xl border border-dashed border-line px-5 py-6 text-center">
        <span className="mx-auto grid size-10 place-items-center rounded-xl bg-surface text-ink-muted">
          {kind === 'image' ? (
            <ImageIcon size={21} aria-hidden="true" />
          ) : (
            <FilePdf size={21} aria-hidden="true" />
          )}
        </span>
        <p className="mt-3 text-sm leading-6 text-ink-muted">
          {kind === 'image'
            ? 'PNG、JPEG 或 WebP，最大 25 MB'
            : 'PDF、Word、PowerPoint、Excel、Markdown 或 TXT，最大 25 MB'}
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className="mt-4 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-accent px-4 font-medium text-card transition-colors hover:bg-accent-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60"
        >
          {busy ? (
            <SpinnerGap
              size={20}
              className="animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
          ) : (
            <UploadSimple size={20} aria-hidden="true" />
          )}
          {busy ? '正在上传…' : kind === 'image' ? '选择图片' : '选择文件'}
        </button>
      </div>
      {error ? (
        <p className="text-sm text-bad" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
