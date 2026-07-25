import type { AssetItem } from '@/features/assets/assets-drawer';
import type {
  ArtifactSummary,
  CreatableArtifactKind,
} from '@/features/canvas/artifact-client';

export type StudioRoute =
  'source-add' | 'source-manage' | 'output-create' | 'output-browse';

export const ROOT_ITEMS = [
  '添加来源',
  '管理来源',
  '生成内容',
  '查看产物',
] as const;

export const SOURCE_ADD_ITEMS = ['上传 PDF', '上传图片', '导入网页'] as const;

export const OUTPUT_CREATE_ITEMS = [
  '新建空白笔记',
  '生成对话笔记',
  '思维导图',
  'Slides',
  '复习闪卡',
  '音频概览',
] as const;

export const OUTPUT_ACTIONS: readonly [CreatableArtifactKind, string][] = [
  ['note', '对话笔记'],
  ['mind_map', '对话思维导图'],
  ['slides', '对话小结 Slides'],
  ['flashcards', '复习闪卡'],
  ['audio_overview', '来源音频概览'],
];

/** 返回指定 Studio 二级能力的可见标签，不在展示模型中携带业务回调。 */
export function itemsForRoute(
  route: StudioRoute,
  assets: readonly AssetItem[],
  outputs: readonly ArtifactSummary[],
): readonly string[] {
  if (route === 'source-add') return SOURCE_ADD_ITEMS;
  if (route === 'output-create') return OUTPUT_CREATE_ITEMS;
  if (route === 'source-manage') {
    return assets.length === 0
      ? ['暂无来源', '添加新来源']
      : [
          ...assets.map((asset) => `${asset.label} · ${assetStatus(asset)}`),
          '添加新来源',
        ];
  }
  return outputs.length === 0
    ? ['暂无产物', '生成新内容']
    : [
        ...outputs.map(
          (output) =>
            `${output.title} · ${output.latestVersion > 0 ? `v${output.latestVersion}` : '生成中'}`,
        ),
        '生成新内容',
      ];
}

export function routeLabel(route: StudioRoute): string {
  if (route === 'source-add') return '选择来源添加方式';
  if (route === 'source-manage') return '管理当前笔记本来源';
  if (route === 'output-create') return '选择内容输出类型';
  return '查看当前笔记本产物';
}

function assetStatus(asset: AssetItem): string {
  if (asset.status === 'ready') return asset.enabled ? '已启用' : '未启用';
  if (asset.status === 'failed') return '处理失败';
  return '处理中';
}
