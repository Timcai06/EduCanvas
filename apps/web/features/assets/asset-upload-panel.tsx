'use client';

import { useGSAP } from '@gsap/react';
import {
  FilePdf,
  Image as ImageIcon,
  UploadSimple,
} from '@phosphor-icons/react';
import gsap from 'gsap';
import { useRef, useState } from 'react';
import { uploadAsset } from './asset-client';
import type { AssetItem } from './assets-drawer';

gsap.registerPlugin(useGSAP);

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
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [scope, setScope] = useState<AssetItem['scope']>(fixedScope ?? 'turn');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const accept =
    kind === 'image' ? 'image/png,image/jpeg,image/webp' : 'application/pdf';

  useGSAP(
    () => {
      const root = rootRef.current;
      if (!root) return;
      const sections = root.querySelectorAll('[data-upload-section]');
      const media = gsap.matchMedia();
      media.add('(prefers-reduced-motion: no-preference)', () => {
        gsap.fromTo(
          sections,
          { autoAlpha: 0, y: 10 },
          {
            autoAlpha: 1,
            y: 0,
            duration: 0.38,
            stagger: 0.055,
            ease: 'power2.out',
          },
        );
      });
      media.add('(prefers-reduced-motion: reduce)', () => {
        gsap.set(sections, { autoAlpha: 1, y: 0 });
      });
      return () => media.revert();
    },
    { scope: rootRef },
  );

  return (
    <div ref={rootRef} className="space-y-6">
      <div
        data-upload-section
        className="relative overflow-hidden rounded-3xl border border-line bg-card p-5 shadow-[var(--shadow-float)]"
      >
        <span className="grid size-11 place-items-center rounded-2xl bg-accent-soft text-accent">
          {kind === 'image' ? <ImageIcon size={23} /> : <FilePdf size={23} />}
        </span>
        <h3 className="mt-4 font-display text-lg font-semibold text-ink">
          {kind === 'image' ? '添加图片' : '添加PDF资料'}
        </h3>
        <p className="mt-1 text-sm leading-6 text-ink-muted">
          {kind === 'image'
            ? fixedScope === 'space'
              ? '支持PNG、JPEG和WebP，最大10MB。图片会保存为当前笔记本来源；当前模型暂不读取图片像素。'
              : '支持PNG、JPEG和WebP，最大10MB。图片会保存为Asset；当前模型仅支持文本，发送时会明确提示能力边界。'
            : fixedScope === 'space'
              ? '支持带可复制文字的PDF，最大10MB。文字会在服务端解析并成为当前笔记本的长期来源。'
              : '支持带可复制文字的PDF，最大10MB。上传后文字会在服务端解析并作为受控附件进入对话。'}
        </p>
      </div>

      {fixedScope ? (
        <p
          data-upload-section
          className="rounded-2xl bg-surface px-4 py-3 text-sm text-ink-muted"
        >
          文件会保存到当前笔记本的来源中，切换笔记本不会带走。
        </p>
      ) : (
        <fieldset data-upload-section>
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
      )}

      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="sr-only"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (!file || busy) return;
          setBusy(true);
          setError(null);
          void uploadAsset({ file, scope, endpoint })
            .then(onUploaded)
            .catch((reason: unknown) => {
              setError(
                reason instanceof Error ? reason.message : '文件上传失败。',
              );
            })
            .finally(() => setBusy(false));
        }}
      />
      <button
        data-upload-section
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-accent px-4 font-medium text-card transition-colors hover:bg-accent-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60"
      >
        <UploadSimple size={20} />
        {busy ? '正在安全处理…' : '选择文件'}
      </button>
      <p
        data-upload-section
        className={`min-h-5 text-sm ${error ? 'text-bad' : 'text-ink-muted'}`}
      >
        {error ?? '对象存储地址和模型密钥不会发送到浏览器。'}
      </p>
    </div>
  );
}
