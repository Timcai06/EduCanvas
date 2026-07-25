'use client';

import type { NoteContent } from '@educanvas/canvas-protocol';
import { useCallback, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  ArrowCounterClockwise,
  Check,
  FloppyDisk,
  PencilSimple,
  Eye,
  TextHOne,
  TextHTwo,
  TextHThree,
  ListBullets,
  ListNumbers,
  CodeBlock,
  LinkSimple,
  Quotes,
  TextB,
  TextItalic,
} from '@phosphor-icons/react';

const AUTOSAVE_DELAY_MS = 1_500;

interface ToolbarAction {
  label: string;
  marker: string;
  suffix?: string;
  block?: boolean;
}

const toolbarActions: readonly ToolbarAction[] = [
  { label: 'H1', marker: '# ', block: true },
  { label: 'H2', marker: '## ', block: true },
  { label: 'H3', marker: '### ', block: true },
  { label: '粗体', marker: '**', suffix: '**' },
  { label: '斜体', marker: '_', suffix: '_' },
  { label: '无序列表', marker: '- ', block: true },
  { label: '有序列表', marker: '1. ', block: true },
  { label: '代码块', marker: '\n```\n', suffix: '\n```\n' },
  { label: '链接', marker: '[', suffix: '](url)' },
  { label: '引用', marker: '> ', block: true },
];

const toolbarIcons: Record<string, React.ComponentType<{ size?: number }>> = {
  H1: TextHOne,
  H2: TextHTwo,
  H3: TextHThree,
  '粗体': TextB,
  '斜体': TextItalic,
  '无序列表': ListBullets,
  '有序列表': ListNumbers,
  '代码块': CodeBlock,
  '链接': LinkSimple,
  '引用': Quotes,
};

function insertMarkdown(
  textarea: HTMLTextAreaElement,
  marker: string,
  suffix?: string,
  block?: boolean,
) {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const selected = textarea.value.slice(start, end);
  const before = textarea.value.slice(0, start);
  const after = textarea.value.slice(end);
  const insertion = block
    ? marker + selected
    : marker + selected + (suffix ?? marker);
  textarea.value = before + insertion + after;
  textarea.focus();
  const cursorPos = block
    ? start + marker.length + selected.length
    : start + marker.length + selected.length + (suffix ?? '').length;
  textarea.setSelectionRange(cursorPos, cursorPos);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

export function NoteRenderer({
  content,
  isLatest,
  readOnly = false,
  onSave,
  saving = false,
}: {
  content: NoteContent;
  isLatest: boolean;
  readOnly?: boolean;
  onSave?: (markdown: string) => void;
  saving?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [markdown, setMarkdown] = useState(content.markdown);
  const [preview, setPreview] = useState(false);
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setMarkdown(content.markdown);
    setEditing(false);
  }, [content.markdown]);

  const canEdit = isLatest && !readOnly;
  const dirty = markdown !== content.markdown;

  const triggerAutosave = useCallback(
    (value: string) => {
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
      autosaveTimer.current = setTimeout(() => {
        if (onSave && value !== content.markdown) {
          onSave(value);
        }
      }, AUTOSAVE_DELAY_MS);
    },
    [onSave, content.markdown],
  );

  const handleSave = useCallback(() => {
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    if (onSave && dirty) onSave(markdown);
  }, [onSave, dirty, markdown]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {editing ? (
        <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-line px-3 py-2">
          {toolbarActions.map((action) => {
            const Icon = toolbarIcons[action.label]!;
            return (
              <button
                key={action.label}
                type="button"
                title={action.label}
                onClick={() => {
                  if (textareaRef.current) {
                    insertMarkdown(
                      textareaRef.current,
                      action.marker,
                      action.suffix,
                      action.block,
                    );
                    setMarkdown(textareaRef.current.value);
                  }
                }}
                className="grid size-8 place-items-center rounded-lg text-ink-muted transition-colors hover:bg-surface-strong hover:text-ink"
              >
                <Icon size={16} />
              </button>
            );
          })}
          <span className="mx-1 h-5 w-px bg-line" aria-hidden="true" />
          <button
            type="button"
            onClick={() => setPreview((v) => !v)}
            title={preview ? '关闭预览' : '开启预览'}
            className={`grid size-8 place-items-center rounded-lg transition-colors ${
              preview
                ? 'bg-accent-soft text-accent'
                : 'text-ink-muted hover:bg-surface-strong hover:text-ink'
            }`}
          >
            <Eye size={16} />
          </button>
          {readOnly ? null : (
            <>
              <span className="flex-1" aria-hidden="true" />
              <span className="text-xs text-ink-muted">
                {saving
                  ? '保存中…'
                  : dirty
                    ? '未保存'
                    : '已保存'}
              </span>
              <button
                type="button"
                disabled={!dirty || saving}
                onClick={handleSave}
                className="flex items-center gap-1.5 rounded-full bg-accent px-3 py-1.5 text-xs font-semibold text-card transition-colors hover:bg-accent-strong disabled:bg-surface-strong disabled:text-ink-faint"
              >
                <FloppyDisk size={14} />
                保存
              </button>
            </>
          )}
        </div>
      ) : null}

      <div className="min-h-0 flex-1">
        {editing && preview ? (
          <div className="flex h-full divide-x divide-line">
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <textarea
                ref={textareaRef}
                value={markdown}
                readOnly={!canEdit}
                onChange={(e) => {
                  setMarkdown(e.target.value);
                  triggerAutosave(e.target.value);
                }}
                className="h-full w-full resize-none bg-transparent font-mono text-sm text-ink outline-none placeholder:text-ink-faint"
                placeholder="用 Markdown 写笔记…"
                aria-label="笔记编辑区"
              />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <article className="prose prose-sm max-w-none dark:prose-invert">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {markdown}
                </ReactMarkdown>
              </article>
            </div>
          </div>
        ) : editing ? (
          <textarea
            ref={textareaRef}
            value={markdown}
            readOnly={!canEdit}
            onChange={(e) => {
              setMarkdown(e.target.value);
              triggerAutosave(e.target.value);
            }}
            className="h-full w-full resize-none bg-transparent p-4 font-mono text-sm text-ink outline-none placeholder:text-ink-faint"
            placeholder="用 Markdown 写笔记…"
            aria-label="笔记编辑区"
          />
        ) : (
          <div className="h-full overflow-y-auto p-4">
            <article className="prose prose-sm max-w-none dark:prose-invert">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {markdown}
              </ReactMarkdown>
            </article>
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t border-line px-4 py-2">
        {canEdit ? (
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              editing
                ? 'bg-accent text-card hover:bg-accent-strong'
                : 'bg-surface-strong text-ink hover:bg-line'
            }`}
          >
            {editing ? (
              <>
                <Check size={14} />
                完成编辑
              </>
            ) : (
              <>
                <PencilSimple size={14} />
                编辑
              </>
            )}
          </button>
        ) : null}
        {!isLatest ? (
          <span className="text-xs text-ink-muted">
            <ArrowCounterClockwise size={14} className="inline" />{' '}
            历史版本（只读）
          </span>
        ) : null}
        {readOnly ? (
          <span className="text-xs text-ink-muted">只读</span>
        ) : null}
      </div>
    </div>
  );
}
