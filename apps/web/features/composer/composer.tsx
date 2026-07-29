'use client';

import {
  ArrowUp,
  File,
  Image as ImageIcon,
  Microphone,
  SidebarSimple,
  StopCircle,
  X,
} from '@phosphor-icons/react';
import { createPortal } from 'react-dom';
import { useCallback, useEffect, useRef, useState } from 'react';
import { PlusMenu, type PlusMenuActionId } from './plus-menu';
import type { PendingFile } from './use-drop-files';

export interface ContextChip {
  id: string;
  label: string;
}

export interface ComposerToolChip {
  id: 'canvas';
  label: string;
  selected: boolean;
  detail?: string;
}

export function Composer({
  chips,
  busy,
  statusText,
  onSend,
  onRemoveChip,
  onMenuAction,
  onStop,
  stopAvailable = false,
  variant = 'conversation',
  statusTone = 'info',
  availableMenuActions,
  toolChips = [],
  onToolAction,
  pendingFiles = [],
  onAddFiles,
  onRemoveFile,
  rejectedMessage,
}: {
  chips: readonly ContextChip[];
  busy: boolean;
  statusText: string | null;
  onSend: (text: string) => void;
  onRemoveChip: (id: string) => void;
  onMenuAction: (action: PlusMenuActionId) => void;
  onStop?: () => void;
  stopAvailable?: boolean;
  variant?: 'landing' | 'conversation';
  statusTone?: 'info' | 'error';
  availableMenuActions?: readonly PlusMenuActionId[];
  toolChips?: readonly ComposerToolChip[];
  onToolAction?: (id: ComposerToolChip['id']) => void;
  pendingFiles?: readonly PendingFile[];
  onAddFiles?: (files: FileList | File[]) => void;
  onRemoveFile?: (id: string) => void;
  rejectedMessage?: string | null;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const dragCounter = useRef(0);
  const isLanding = variant === 'landing';
  const hasText = value.trim().length > 0;
  const hasFiles = pendingFiles.length > 0;
  const hasPayload = hasText || chips.length > 0 || hasFiles;

  useEffect(() => {
    return () => { dragCounter.current = 0; setIsDragOver(false); };
  }, []);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    dragCounter.current += 1;
    if (e.dataTransfer.items?.length > 0) setIsDragOver(true);
  }, []);
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    dragCounter.current -= 1;
    if (dragCounter.current <= 0) setIsDragOver(false);
  }, []);
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
  }, []);
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    setIsDragOver(false); dragCounter.current = 0;
    if (e.dataTransfer.files.length > 0 && onAddFiles) onAddFiles(e.dataTransfer.files);
  }, [onAddFiles]);
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items || !onAddFiles) return;
    const files: File[] = [];
    for (const item of Array.from(items)) {
      if (item.kind === 'file') { const f = item.getAsFile(); if (f) files.push(f); }
      else if (item.type.startsWith('image/')) { const f = item.getAsFile(); if (f) files.push(f); }
    }
    if (files.length > 0) { e.preventDefault(); onAddFiles(files); }
  }, [onAddFiles]);

  const submit = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const text = value.trim();
    if (!hasPayload || busy) return;
    setValue('');
    textarea.style.height = 'auto';
    onSend(text);
  };

  return (
    <>
    <div
      className={`mx-auto w-full px-4 ${isLanding ? 'max-w-[42rem]' : 'max-w-3xl pb-3'}`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {hasFiles ? (
        <div className="mb-2 flex flex-wrap gap-2">
          {pendingFiles.map((pf) => (
            <span key={pf.id} className="inline-flex items-center gap-1.5 rounded-full border border-accent/40 bg-accent-soft/60 px-3 py-1.5 text-xs font-medium text-ink">
              {pf.previewUrl ? (
                <button type="button" aria-label={`预览 ${pf.file.name}`} onClick={() => setPreview(pf.previewUrl)} className="shrink-0">
                  <img src={pf.previewUrl} alt={pf.file.name} className="size-5 rounded-full object-cover hover:opacity-80" />
                </button>
              ) : (
                <File aria-hidden="true" size={14} weight="fill" className="text-ink-muted" />
              )}
              <span className="max-w-[120px] truncate">{pf.file.name}</span>
              <button type="button" aria-label={`移除 ${pf.file.name}`} onClick={() => onRemoveFile?.(pf.id)} className="ml-0.5 grid size-4 place-items-center rounded-full text-ink-faint transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                <X aria-hidden="true" size={11} weight="bold" />
              </button>
            </span>
          ))}
        </div>
      ) : null}
      {chips.length > 0 ? (
        <div className="mb-2 flex flex-wrap gap-2">
          {chips.map((chip) => (
            <span key={chip.id} className="inline-flex items-center gap-1 rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium text-ink-muted">
              {chip.label}
              <button type="button" aria-label={`移除资料 ${chip.label}`} onClick={() => onRemoveChip(chip.id)} className="ml-1 grid size-5 place-items-center rounded-full text-ink-faint transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                <X aria-hidden="true" size={12} weight="bold" />
              </button>
            </span>
          ))}
        </div>
      ) : null}
      <div className={`ink-flow-shell relative flex items-end gap-1 border border-line bg-card p-2 transition-[border-color,box-shadow] focus-within:border-accent/60 focus-within:shadow-[var(--shadow-float)] ${isLanding ? 'min-h-16 rounded-[1.75rem] shadow-[var(--shadow-float)]' : 'rounded-[1.375rem] shadow-[0_1px_2px_rgb(72_60_34_/_0.05)]'} ${isDragOver ? 'border-accent bg-accent-soft/10' : ''}`}>
        <span aria-hidden="true" className="ink-flow-line" />
        <PlusMenu onAction={onMenuAction} availableActions={availableMenuActions} />
        <textarea
          ref={textareaRef}
          value={value}
          disabled={busy}
          rows={1}
          aria-label="向 EduCanvas 提问"
          placeholder={isLanding ? '向 EduCanvas 提问' : '继续对话…'}
          onChange={(event) => setValue(event.currentTarget.value)}
          onInput={(event) => {
            const textarea = event.currentTarget;
            textarea.style.height = 'auto';
            textarea.style.height = `${Math.min(textarea.scrollHeight, 144)}px`;
          }}
          onPaste={handlePaste}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submit(); }
          }}
          className={`max-h-36 min-h-10 flex-1 resize-none self-center bg-transparent px-2 py-2 leading-6 text-ink outline-none placeholder:text-ink-muted ${isLanding ? 'text-base' : 'text-[15px]'}`}
        />
        {busy && stopAvailable && onStop ? (
          <button type="button" onClick={onStop} aria-label="停止回答" title="停止回答" className="grid size-10 shrink-0 place-items-center rounded-full bg-ink text-canvas transition-colors hover:bg-ink/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2">
            <StopCircle aria-hidden="true" size={21} weight="fill" />
          </button>
        ) : hasPayload ? (
          <button type="button" onClick={submit} disabled={busy} aria-label="发送" className="grid size-10 shrink-0 place-items-center rounded-full bg-accent text-card transition-colors hover:bg-accent-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:bg-surface-strong disabled:text-ink-faint">
            <ArrowUp aria-hidden="true" size={20} weight="bold" />
          </button>
        ) : (
          <button type="button" disabled title="语音输入即将开放" aria-label="语音输入（即将开放）" className="grid size-10 shrink-0 place-items-center rounded-full text-ink-muted">
            <Microphone aria-hidden="true" size={20} weight="regular" />
          </button>
        )}
      </div>
      {toolChips.length > 0 ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 px-1">
          {toolChips.map((tool) => (
            <button key={tool.id} type="button" aria-label={tool.label} aria-pressed={tool.selected} onClick={() => onToolAction?.(tool.id)} className={`inline-flex min-h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 ${tool.selected ? 'border-accent/55 bg-accent-soft text-ink' : 'border-line bg-surface/75 text-ink-muted hover:bg-surface hover:text-ink'}`}>
              <SidebarSimple aria-hidden="true" size={15} weight={tool.selected ? 'fill' : 'regular'} className={tool.selected ? 'text-accent' : undefined} />
              <span>{tool.label}</span>
              {tool.detail ? <span className="text-[11px] text-ink-muted">{tool.detail}</span> : null}
            </button>
          ))}
        </div>
      ) : null}
      {rejectedMessage ? (
        <p className="mt-2 text-center text-xs text-ink-muted">{rejectedMessage}</p>
      ) : !isLanding || statusText ? (
        <p className={`mt-2 min-h-4 text-center text-xs ${statusTone === 'error' ? 'text-bad' : 'text-ink-muted'}`}>
          {statusText ?? 'AI 也可能出错，请核对重要信息。'}
        </p>
      ) : null}
      {isDragOver ? (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-accent/10 backdrop-blur-[1px]">
          <div className="rounded-3xl border-2 border-dashed border-accent/60 bg-surface px-10 py-6 text-center shadow-[var(--shadow-float)]">
            <ImageIcon aria-hidden="true" size={32} weight="duotone" className="mx-auto mb-2 text-accent" />
            <p className="text-sm font-semibold text-ink">拖放文件或图片到此处</p>
            <p className="mt-1 text-xs text-ink-muted">支持 PDF、Word、Markdown、图片、音频、视频</p>
          </div>
        </div>
      ) : null}
    </div>
    {preview && createPortal(
      <div role="dialog" aria-label="图片预览" className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={() => setPreview(null)} onKeyDown={(e) => { if (e.key === 'Escape') setPreview(null); }}>
        <button type="button" aria-label="关闭预览" onClick={() => setPreview(null)} className="absolute right-4 top-4 grid size-10 place-items-center rounded-full bg-white/20 text-white transition-colors hover:bg-white/40"><X aria-hidden="true" size={20} weight="bold" /></button>
        <img src={preview} alt="预览" className="max-h-[85vh] max-w-[90vw] rounded-2xl object-contain shadow-2xl" onClick={(e) => e.stopPropagation()} />
      </div>,
      document.body,
    )}
    </>
  );
}
