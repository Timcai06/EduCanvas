'use client';

import {
  Cards,
  Headphones,
  Slideshow,
  TreeStructure,
  type Icon,
} from '@phosphor-icons/react';
import type {
  ArtifactSummary,
  CreatableArtifactKind,
} from '@/features/canvas/artifact-client';

export const STUDIO_OUTPUT_OPTIONS = [
  '产物总览',
  '思维导图',
  'Slides',
  '复习闪卡',
  '音频概览',
] as const;

const OUTPUT_ACTIONS: readonly {
  kind: CreatableArtifactKind;
  icon: Icon;
  title: string;
  description: string;
  defaultTitle: string;
}[] = [
  {
    kind: 'mind_map',
    icon: TreeStructure,
    title: '生成思维导图',
    description: '把当前对话组织为可继续修改的结构化知识图谱。',
    defaultTitle: '对话思维导图',
  },
  {
    kind: 'slides',
    icon: Slideshow,
    title: '生成 Slides',
    description: '把关键内容整理为可逐页查看和继续修订的演示文稿。',
    defaultTitle: '对话小结 Slides',
  },
  {
    kind: 'flashcards',
    icon: Cards,
    title: '生成复习闪卡',
    description: '提炼概念与问题，形成适合主动回忆的卡片组。',
    defaultTitle: '复习闪卡',
  },
  {
    kind: 'audio_overview',
    icon: Headphones,
    title: '生成音频概览',
    description: '根据已启用的 PDF 与网页来源生成脚本和语音。',
    defaultTitle: '来源音频概览',
  },
];

/**
 * Studio 内容输出详情区。创建动作只进入上层已有的显式确认流程，不在选择轮盘时
 * 静默创建 Artifact；列表只显示服务端返回的当前 Space 真实产物。
 */
export function StudioOutputPanel({
  selectedIndex,
  outputs,
  onOpen,
  onCreate,
}: {
  selectedIndex: number;
  outputs: readonly ArtifactSummary[];
  onOpen: (id: string) => void;
  onCreate: (kind: CreatableArtifactKind, defaultTitle: string) => void;
}) {
  if (selectedIndex === 0) {
    return (
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-accent">
          Notebook outputs
        </p>
        <h3 className="mt-2 font-display text-2xl font-semibold tracking-tight text-ink">
          当前笔记本的内容输出
        </h3>
        <p className="mt-2 text-sm leading-6 text-ink-muted">
          {outputs.length}{' '}
          项真实产物。生成中、失败和版本状态均以服务端记录为准。
        </p>
        {outputs.length === 0 ? (
          <div className="mt-8 rounded-3xl border border-dashed border-line bg-surface/55 px-6 py-10 text-center">
            <p className="font-display text-lg font-semibold text-ink">
              还没有内容输出
            </p>
            <p className="mt-2 text-sm text-ink-muted">
              在左侧选择一种形态，Studio 会先请你确认再开始生成。
            </p>
          </div>
        ) : (
          <ul className="mt-6 grid gap-2 sm:grid-cols-2">
            {outputs.map((output) => (
              <li key={output.id}>
                <button
                  type="button"
                  onClick={() => onOpen(output.id)}
                  className="flex min-h-24 w-full flex-col justify-between rounded-2xl border border-line bg-surface/55 p-4 text-left transition-[border-color,background-color,transform] hover:-translate-y-0.5 hover:border-accent/40 hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <span className="line-clamp-2 text-sm font-semibold text-ink">
                    {output.title}
                  </span>
                  <span className="mt-3 text-xs text-ink-muted">
                    {output.latestVersion > 0
                      ? `v${output.latestVersion}`
                      : output.status === 'proposed'
                        ? '生成中或未完成'
                        : output.status}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  const action = OUTPUT_ACTIONS[selectedIndex - 1]!;
  const ActionIcon = action.icon;
  const matchingCount = outputs.filter(
    (output) => output.kind === action.kind,
  ).length;
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-accent">
        Create output
      </p>
      <h3 className="mt-2 font-display text-2xl font-semibold tracking-tight text-ink">
        {action.title}
      </h3>
      <p className="mt-2 max-w-xl text-sm leading-6 text-ink-muted">
        {action.description}
      </p>
      <button
        type="button"
        onClick={() => onCreate(action.kind, action.defaultTitle)}
        className="group mt-8 flex min-h-32 w-full items-center gap-5 rounded-3xl border border-line bg-surface/65 p-5 text-left transition-[border-color,background-color,transform] hover:-translate-y-0.5 hover:border-accent/45 hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <span className="grid size-16 shrink-0 place-items-center rounded-[1.4rem] bg-accent-soft text-accent">
          <ActionIcon aria-hidden="true" size={30} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-display text-xl font-semibold text-ink">
            开始创建
          </span>
          <span className="mt-1 block text-sm leading-6 text-ink-muted">
            将先打开标题与来源确认，不会静默消耗模型额度。
          </span>
          {matchingCount > 0 ? (
            <span className="mt-2 block text-xs font-medium text-accent">
              当前笔记本已有 {matchingCount} 项同类产物
            </span>
          ) : null}
        </span>
      </button>
    </div>
  );
}
