'use client';

import OptionWheel from '@/components/OptionWheel';
import { GENERATED_SOFT_CLICK } from '@/components/option-wheel-sound';
import type { AssetItem } from '@/features/assets/assets-drawer';
import type {
  ArtifactSummary,
  CreatableArtifactKind,
} from '@/features/canvas/artifact-client';
import { useMemo, useState } from 'react';
import { StudioLinkBubble } from './studio-link-bubble';

type StudioRoute =
  'root' | 'source-add' | 'source-manage' | 'output-create' | 'output-browse';

const ROOT_ITEMS = ['添加来源', '管理来源', '生成内容', '查看产物'] as const;
const SOURCE_ADD_ITEMS = [
  '返回 Studio',
  '上传 PDF',
  '上传图片',
  '导入网页',
] as const;
const OUTPUT_CREATE_ITEMS = [
  '返回 Studio',
  '思维导图',
  'Slides',
  '复习闪卡',
  '音频概览',
] as const;
const OUTPUT_ACTIONS: readonly [CreatableArtifactKind, string][] = [
  ['mind_map', '对话思维导图'],
  ['slides', '对话小结 Slides'],
  ['flashcards', '复习闪卡'],
  ['audio_overview', '来源音频概览'],
];

/**
 * 当前 Notebook 的分级 Studio。每一级都由 React Bits OptionWheel 呈现；
 * 滚动只改变中心选项，再次点击中心项或按 Enter 才执行最终动作。
 */
export function StudioWorkspace({
  assets,
  outputs,
  onToggleAsset,
  onUpload,
  onImported,
  onOpenOutput,
  onCreateOutput,
}: {
  assets: readonly AssetItem[];
  outputs: readonly ArtifactSummary[];
  onToggleAsset: (id: string) => void;
  onUpload: (kind: 'document' | 'image') => void;
  onImported: (asset: AssetItem) => void;
  onOpenOutput: (id: string) => void;
  onCreateOutput: (kind: CreatableArtifactKind, defaultTitle: string) => void;
}) {
  const [route, setRoute] = useState<StudioRoute>('root');
  const [linkOpen, setLinkOpen] = useState(false);
  const items = useMemo(
    () => itemsForRoute(route, assets, outputs),
    [assets, outputs, route],
  );

  const selectItem = (index: number) => {
    if (route === 'root') {
      const routes: readonly StudioRoute[] = [
        'source-add',
        'source-manage',
        'output-create',
        'output-browse',
      ];
      setRoute(routes[index] ?? 'root');
      return;
    }
    if (index === 0) {
      setLinkOpen(false);
      setRoute('root');
      return;
    }
    if (route === 'source-add') {
      if (index === 1) onUpload('document');
      else if (index === 2) onUpload('image');
      else if (index === 3) setLinkOpen(true);
      return;
    }
    if (route === 'source-manage') {
      if (index === items.length - 1) {
        setRoute('source-add');
        return;
      }
      const asset = assets[index - 1];
      if (asset?.selectable) onToggleAsset(asset.id);
      return;
    }
    if (route === 'output-create') {
      const action = OUTPUT_ACTIONS[index - 1];
      if (action) onCreateOutput(...action);
      return;
    }
    if (index === items.length - 1) {
      setRoute('output-create');
      return;
    }
    const output = outputs[index - 1];
    if (output) onOpenOutput(output.id);
  };

  return (
    <div className="relative h-full w-full">
      <section
        aria-label="Studio 分级选择轮盘"
        className="pointer-events-auto absolute inset-0"
      >
        <OptionWheel
          key={route}
          items={items}
          defaultSelected={Math.min(1, items.length - 1)}
          onSelect={(index) => selectItem(index)}
          textColor="var(--color-ink-muted)"
          activeColor="var(--color-ink)"
          side="right"
          fontSize={route === 'root' ? 2.7 : 1.95}
          spacing={route === 'root' ? 1.55 : 1.5}
          curve={1}
          tilt={route === 'root' ? 7 : 6}
          blur={route === 'root' ? 1.8 : 1.45}
          fade={route === 'root' ? 0.22 : 0.18}
          minOpacity={0.08}
          smoothing={200}
          inset={52}
          draggable
          soundUrl={GENERATED_SOFT_CLICK}
          soundVolume={0.38}
          ariaLabel={routeLabel(route)}
          className="font-display"
        />
      </section>
      <p className="pointer-events-none absolute bottom-5 right-6 text-[11px] text-ink-faint">
        {route === 'root'
          ? '滚轮或拖动浏览 · 再点中心项进入'
          : '每一级都是滚轮 · 返回 Studio 回到上级'}
      </p>
      {linkOpen ? (
        <StudioLinkBubble
          onCancel={() => setLinkOpen(false)}
          onImported={(asset) => {
            onImported(asset);
            setLinkOpen(false);
            setRoute('source-manage');
          }}
        />
      ) : null}
    </div>
  );
}

function itemsForRoute(
  route: StudioRoute,
  assets: readonly AssetItem[],
  outputs: readonly ArtifactSummary[],
): readonly string[] {
  if (route === 'root') return ROOT_ITEMS;
  if (route === 'source-add') return SOURCE_ADD_ITEMS;
  if (route === 'output-create') return OUTPUT_CREATE_ITEMS;
  if (route === 'source-manage') {
    return assets.length === 0
      ? ['返回 Studio', '暂无来源', '添加新来源']
      : [
          '返回 Studio',
          ...assets.map((asset) => `${asset.label} · ${assetStatus(asset)}`),
          '添加新来源',
        ];
  }
  return outputs.length === 0
    ? ['返回 Studio', '暂无产物', '生成新内容']
    : [
        '返回 Studio',
        ...outputs.map(
          (output) =>
            `${output.title} · ${output.latestVersion > 0 ? `v${output.latestVersion}` : '生成中'}`,
        ),
        '生成新内容',
      ];
}

function assetStatus(asset: AssetItem): string {
  if (asset.status === 'ready') return asset.enabled ? '已启用' : '未启用';
  if (asset.status === 'failed') return '处理失败';
  return '处理中';
}

function routeLabel(route: StudioRoute): string {
  if (route === 'source-add') return '选择来源添加方式';
  if (route === 'source-manage') return '管理当前笔记本来源';
  if (route === 'output-create') return '选择内容输出类型';
  if (route === 'output-browse') return '查看当前笔记本产物';
  return '选择 Studio 能力';
}
