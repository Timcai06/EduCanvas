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
import { StudioCornerArc } from './studio-corner-arc';

type StudioLevel = 'root' | 'input' | 'output';

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
  const [inputIndex, setInputIndex] = useState(0);
  const [outputIndex, setOutputIndex] = useState(0);

  const options =
    level === 'input' ? STUDIO_INPUT_OPTIONS : STUDIO_OUTPUT_OPTIONS;
  const selectedIndex = level === 'input' ? inputIndex : outputIndex;

  const setSelectedIndex = (index: number) => {
    if (level === 'input') setInputIndex(index);
    else setOutputIndex(index);
  };

  const enterSelected = (index = selectedIndex) => {
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

  if (level === 'root') {
    return (
      <StudioCornerArc
        onSelect={(nextLevel) => {
          setLevel(nextLevel);
          onExpandedChange(true);
        }}
      />
    );
  }

  return (
    <div className="grid min-h-[calc(100dvh-8.5rem)] gap-3 lg:grid-cols-[minmax(0,1fr)_25rem] lg:gap-2">
      <section
        aria-label="Studio 选择轮盘"
        className="studio-wheel-stage relative min-h-64 overflow-hidden lg:order-2 lg:min-h-0"
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center justify-between px-5 pt-5">
          <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-ink-faint">
            {level === 'input' ? 'File input' : 'Content output'}
          </span>
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
        </div>
        <OptionWheel
          key={level}
          items={options}
          selectedIndex={selectedIndex}
          onChange={(index) => setSelectedIndex(index)}
          onSelect={(index) => enterSelected(index)}
          ariaLabel={
            level === 'input' ? '选择文件输入方式' : '选择内容输出方式'
          }
          side="right"
          fontSize={1.72}
          spacing={1.65}
          inset={72}
          curve={2.15}
          tilt={11}
          blur={1.4}
          fade={0.19}
          smoothing={220}
        />
        <p className="pointer-events-none absolute inset-x-0 bottom-5 px-6 text-right text-[11px] leading-5 text-ink-faint">
          滚轮或拖动选择 · 再点中心项确认
        </p>
      </section>

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
    </div>
  );
}
