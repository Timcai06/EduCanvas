'use client';

import {
  ArrowRight,
  Cards,
  Exam,
  TreeStructure,
  Trophy,
  Waveform,
  NotePencil,
  Headphones,
  Slideshow,
  PresentationChart,
  type Icon,
} from '@phosphor-icons/react';

export interface StudioOutput {
  id: string;
  title: string;
  kind: string;
  status: '本课预置' | '已完成';
}

// 学习产物谱系：Studio 是把知识转化为多种形态的工作台。这一排是同一家族里
// 尚未开放的形态，以静默态陈列——既让学生看见工作台的全貌，也不假装它们已经能用。
const UPCOMING_KINDS: readonly { icon: Icon; label: string }[] = [
  { icon: Cards, label: '卡片' },
  { icon: Exam, label: '测验' },
  { icon: TreeStructure, label: '图解' },
  { icon: Waveform, label: '音频' },
  { icon: Trophy, label: '作品' },
];

const kindIcons: Record<string, Icon> = {
  note: NotePencil,
  mind_map: TreeStructure,
  slides: Slideshow,
  flashcards: Cards,
  audio_overview: Headphones,
};

/**
 * 本课产物抽屉：已具备的形态（阶段一是课程预置分类互动）可打开进入 Chat+Canvas
 * 协作态，由 LearnWorkspace 装载受控 Artifact；未开放形态只作谱系陈列，不可点击。
 */
export function StudioDrawer({
  outputs,
  onOpen,
  onCreateNote,
}: {
  outputs: readonly StudioOutput[];
  onOpen: (id: string) => void;
  onCreateNote?: () => void;
}) {
  const KindIcon = (kind: string) => kindIcons[kind] ?? PresentationChart;

  return (
    <div className="space-y-7">
      {onCreateNote ? (
        <button
          type="button"
          onClick={onCreateNote}
          className="flex w-full items-center gap-3 rounded-2xl border-2 border-dashed border-line p-3 text-left text-sm text-ink-muted transition-colors hover:border-accent/50 hover:text-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
        >
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface-strong">
            <NotePencil size={20} />
          </span>
          <span className="font-medium">新建笔记</span>
        </button>
      ) : null}

      <ul className="space-y-2">
        {outputs.map((output) => {
          const IconComp = KindIcon(output.kind);
          return (
          <li key={output.id}>
            <button
              type="button"
              onClick={() => onOpen(output.id)}
              className="flex min-h-14 w-full items-center gap-3 rounded-2xl border border-line p-3 text-left transition-colors hover:border-accent/40 hover:bg-surface focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
            >
              <span
                aria-hidden="true"
                className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent"
              >
                <IconComp size={21} weight="regular" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-ink">
                  {output.title}
                </span>
                <span className="block text-xs text-ink-muted">
                  {output.kind} ·{' '}
                  <span
                    className={
                      output.status === '已完成' ? 'text-good' : undefined
                    }
                  >
                    {output.status}
                  </span>
                </span>
              </span>
              <ArrowRight
                aria-hidden="true"
                size={16}
                weight="bold"
                className="shrink-0 text-accent"
              />
            </button>
          </li>
          );
        })}
      </ul>

      <div>
        <p className="mb-3 text-xs tracking-wide text-ink-faint">
          更多形态 · 即将开放
        </p>
        <ul className="grid grid-cols-3 gap-1.5">
          {UPCOMING_KINDS.map(({ icon: KindIcon, label }) => (
            <li
              key={label}
              className="flex flex-col items-center gap-1.5 rounded-xl py-3 text-ink-faint"
            >
              <KindIcon aria-hidden="true" size={22} weight="regular" />
              <span className="text-xs">{label}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
