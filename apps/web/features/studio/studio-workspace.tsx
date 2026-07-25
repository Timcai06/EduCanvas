'use client';

import type { AssetItem } from '@/features/assets/assets-drawer';
import type {
  ArtifactSummary,
  CreatableArtifactKind,
} from '@/features/canvas/artifact-client';
import { ArrowLeft } from '@phosphor-icons/react';
import { useState } from 'react';
import OptionWheel from './option-wheel';
import { STUDIO_INPUT_OPTIONS, StudioInputPanel } from './studio-input-panel';
import {
  STUDIO_OUTPUT_OPTIONS,
  StudioOutputPanel,
} from './studio-output-panel';

type StudioLevel = 'root' | 'input' | 'output';

const ROOT_OPTIONS = ['文件输入', '内容输出'] as const;

/**
 * 当前 Notebook 的统一 Studio。第一层只表达输入/输出两个同级主题，第二层选择
 * 具体能力；历史会话不进入这里，所有数据仍以父级当前 Space 投影为边界。
 */
export function StudioWorkspace({
  assets,
  outputs,
  onToggleAsset,
  onUpload,
  onImported,
  onOpenOutput,
  onCreateOutput,
  onExpandedChange,
}: {
  assets: readonly AssetItem[];
  outputs: readonly ArtifactSummary[];
  onToggleAsset: (id: string) => void;
  onUpload: (kind: 'document' | 'image') => void;
  onImported: (asset: AssetItem) => void;
  onOpenOutput: (id: string) => void;
  onCreateOutput: (kind: CreatableArtifactKind, defaultTitle: string) => void;
  onExpandedChange: (expanded: boolean) => void;
}) {
  const [level, setLevel] = useState<StudioLevel>('root');
  const [rootIndex, setRootIndex] = useState(0);
  const [inputIndex, setInputIndex] = useState(0);
  const [outputIndex, setOutputIndex] = useState(0);

  const options =
    level === 'root'
      ? ROOT_OPTIONS
      : level === 'input'
        ? STUDIO_INPUT_OPTIONS
        : STUDIO_OUTPUT_OPTIONS;
  const selectedIndex =
    level === 'root' ? rootIndex : level === 'input' ? inputIndex : outputIndex;

  const setSelectedIndex = (index: number) => {
    if (level === 'root') setRootIndex(index);
    else if (level === 'input') setInputIndex(index);
    else setOutputIndex(index);
  };

  const enterSelected = (index = selectedIndex) => {
    if (level === 'root') {
      setLevel(index === 0 ? 'input' : 'output');
      onExpandedChange(true);
      return;
    }
    if (level === 'input') {
      if (index === 1) onUpload('document');
      else if (index === 2) onUpload('image');
      return;
    }
    if (index === 0) return;
    const actions: readonly [CreatableArtifactKind, string][] = [
      ['mind_map', '对话思维导图'],
      ['slides', '对话小结 Slides'],
      ['flashcards', '复习闪卡'],
      ['audio_overview', '来源音频概览'],
    ];
    const action = actions[index - 1];
    if (action) onCreateOutput(...action);
  };

  return (
    <div
      className={
        level === 'root'
          ? 'h-full'
          : 'grid min-h-[calc(100dvh-8.5rem)] gap-3 lg:grid-cols-[minmax(0,1fr)_25rem] lg:gap-2'
      }
    >
      <section
        aria-label="Studio 选择轮盘"
        className={`studio-wheel-stage relative overflow-hidden ${
          level === 'root'
            ? 'h-full min-h-80'
            : 'min-h-64 lg:order-2 lg:min-h-0'
        }`}
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center justify-between px-5 pt-5">
          <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-ink-faint">
            {level === 'root'
              ? 'Choose a direction'
              : level === 'input'
                ? 'File input'
                : 'Content output'}
          </span>
          {level !== 'root' ? (
            <button
              type="button"
              onClick={() => {
                setLevel('root');
                onExpandedChange(false);
              }}
              className="pointer-events-auto inline-flex min-h-9 items-center gap-1.5 rounded-full border border-line bg-card/80 px-3 text-xs font-medium text-ink-muted backdrop-blur transition-colors hover:border-accent/40 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <ArrowLeft aria-hidden="true" size={14} />
              两个主题
            </button>
          ) : null}
        </div>
        <OptionWheel
          key={level}
          items={options}
          selectedIndex={selectedIndex}
          onChange={(index) => setSelectedIndex(index)}
          onSelect={(index) => enterSelected(index)}
          activateOnItemClick={level === 'root'}
          ariaLabel={
            level === 'root'
              ? '选择文件输入或内容输出'
              : level === 'input'
                ? '选择文件输入方式'
                : '选择内容输出方式'
          }
          side="right"
          fontSize={level === 'root' ? 2.35 : 1.72}
          spacing={level === 'root' ? 1.85 : 1.65}
          inset={72}
          curve={2.15}
          tilt={level === 'root' ? 14 : 11}
          blur={1.4}
          fade={0.19}
          smoothing={220}
        />
        <p className="pointer-events-none absolute inset-x-0 bottom-5 px-6 text-right text-[11px] leading-5 text-ink-faint">
          {level === 'root'
            ? '单击一个主题展开工作台'
            : '滚轮或拖动选择 · 再点中心项确认'}
        </p>
      </section>

      {level !== 'root' ? (
        <section
          aria-live="polite"
          data-studio-detail
          className="min-w-0 rounded-[2rem] border border-line/60 bg-card/75 px-5 py-6 shadow-[var(--shadow-float)] backdrop-blur-xl sm:px-8 sm:py-9 lg:order-1"
        >
          {level === 'input' ? (
            <StudioInputPanel
              selectedIndex={inputIndex}
              assets={assets}
              onToggle={onToggleAsset}
              onUpload={onUpload}
              onImported={onImported}
            />
          ) : (
            <StudioOutputPanel
              selectedIndex={outputIndex}
              outputs={outputs}
              onOpen={onOpenOutput}
              onCreate={onCreateOutput}
            />
          )}
        </section>
      ) : null}
    </div>
  );
}
