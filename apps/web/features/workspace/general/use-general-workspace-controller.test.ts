import { describe, expect, it } from 'vitest';
import type { ArtifactDetail } from '@/features/canvas/artifact-client';
import { shouldOpenArtifactSurface } from './artifact-detail-surface-sync';
import { shouldConsumeTurnScopedInputs } from './turn-input-consumption';

const detail = {
  artifact: {
    id: 'art-1',
    title: '思维导图',
    kind: 'mind_map',
    latestVersion: 1,
  },
} as ArtifactDetail;

describe('shouldOpenArtifactSurface（Artifact 详情新打开判定）', () => {
  it('null → 有详情：返回 true（新打开，需 dispatch surface）', () => {
    expect(shouldOpenArtifactSurface(null, detail)).toBe(true);
  });

  it('有详情 → null：返回 false（关闭由 closeArtifactCanvas 处理）', () => {
    expect(shouldOpenArtifactSurface(detail, null)).toBe(false);
  });

  it('null → null：返回 false', () => {
    expect(shouldOpenArtifactSurface(null, null)).toBe(false);
  });

  it('有详情 → 另一详情：返回 false（版本切换不重置 surface）', () => {
    const next = {
      ...detail,
      artifact: { ...detail.artifact, latestVersion: 2 },
    };
    expect(shouldOpenArtifactSurface(detail, next)).toBe(false);
  });

  it('返回 true 时类型守卫将 nextDetail 收窄为非 null', () => {
    const next: ArtifactDetail | null = detail;
    if (shouldOpenArtifactSurface(null, next)) {
      expect(next.artifact.id).toBe('art-1');
    } else {
      throw new Error('应为新打开');
    }
  });
});

describe('shouldConsumeTurnScopedInputs（Turn 一次性输入消费）', () => {
  it('只在 completed 后清空本轮上下文和输出偏好', () => {
    expect(shouldConsumeTurnScopedInputs('completed')).toBe(true);
    expect(shouldConsumeTurnScopedInputs('failed')).toBe(false);
    expect(shouldConsumeTurnScopedInputs('cancelled')).toBe(false);
    expect(shouldConsumeTurnScopedInputs('interrupted')).toBe(false);
    expect(shouldConsumeTurnScopedInputs('rejected')).toBe(false);
  });
});
