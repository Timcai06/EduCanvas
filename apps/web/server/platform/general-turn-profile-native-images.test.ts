import { modelMessageText } from '@educanvas/agent-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { webGeneralTurns } from './general-turn-persistence';
import { loadGeneralArtifactStatusContext } from './general-turn-artifact-context';
import {
  assetContext,
  createProfile,
  command,
  turn,
} from './general-turn-profile.test-support';

vi.mock('server-only', () => ({}));
vi.mock('./general-turn-artifact-context', () => ({
  loadGeneralArtifactStatusContext: vi
    .fn()
    .mockResolvedValue('historical artifact status snapshot'),
}));

beforeEach(() => {
  vi.spyOn(webGeneralTurns, 'listMessages').mockResolvedValue([]);
  vi.mocked(loadGeneralArtifactStatusContext).mockClear();
  process.env.EDUCANVAS_DEPLOYMENT_ENV = 'test';
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.EDUCANVAS_DEPLOYMENT_ENV;
});

describe('WebGeneralProfile 原生图片输入', () => {
  const image = {
    versionId: 'version-1',
    mimeType: 'image/png' as const,
    data: 'iVBORw0KGgo=',
    resourcePath: null,
  };

  it('把多张图片合并进一条消息，不逐张占用 segment 名额', async () => {
    const plan = await createProfile({
      assetContext: {
        ...assetContext,
        nativeImages: [image, { ...image, versionId: 'version-2' }],
      },
    }).prepare({ command, turn });

    expect(plan.context.sourcesAndAssets).toHaveLength(1);
    expect(plan.context.sourcesAndAssets[0]?.message.content).toHaveLength(3);
  });

  it('多图合并段登记全部 Asset Version 且保持消息内顺序（R02 完整追溯）', async () => {
    const plan = await createProfile({
      assetContext: {
        ...assetContext,
        nativeImages: [
          { ...image, versionId: 'version-1' },
          { ...image, versionId: 'version-2' },
          { ...image, versionId: 'version-3' },
        ],
      },
    }).prepare({ command, turn });

    const segment = plan.context.sourcesAndAssets[0]!.segment as {
      assetVersionIds?: readonly string[];
      assetVersionId?: string;
    };
    expect(segment.assetVersionIds).toEqual([
      'version-1',
      'version-2',
      'version-3',
    ]);
    expect(segment.assetVersionId).toBeUndefined();
  });

  it('segment 文本与消息的文本投影逐字相等，否则会触发 Prompt 漂移守卫', async () => {
    /* Turn Application 用 modelMessageText(message) === segment.content 检测漂移
       （turn-application/helpers.ts）。这两处的占位符写法是绑定的。 */
    const plan = await createProfile({
      assetContext: { ...assetContext, nativeImages: [image] },
    }).prepare({ command, turn });

    const candidate = plan.context.sourcesAndAssets[0]!;
    expect(modelMessageText(candidate.message)).toBe(candidate.segment.content);
  });

  it('同一版本的多张派生图只登记唯一 Asset Version，part id 用 resourcePath 区分', async () => {
    const derivedA = {
      ...image,
      versionId: 'version-1',
      resourcePath: 'images/fig1.png',
    };
    const derivedB = {
      ...image,
      versionId: 'version-1',
      resourcePath: 'images/fig2.png',
    };
    const plan = await createProfile({
      assetContext: { ...assetContext, nativeImages: [derivedA, derivedB] },
    }).prepare({ command, turn });

    const segment = plan.context.sourcesAndAssets[0]!.segment as {
      id?: string;
      assetVersionIds?: readonly string[];
    };
    expect(segment.id).toBe(
      'asset-native:version-1:images/fig1.png,version-1:images/fig2.png',
    );
    expect(segment.assetVersionIds).toEqual(['version-1']);
  });

  it('没有原生图片时不产生任何额外 segment', async () => {
    const plan = await createProfile().prepare({ command, turn });

    expect(plan.context.sourcesAndAssets).toEqual([]);
  });
});
