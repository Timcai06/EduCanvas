import { describe, expect, it } from 'vitest';
import type { ArtifactDetail } from '@/features/canvas/artifact-client';
import type { GenerationState } from '@/features/canvas/artifact-generation-flow';
import { projectObservedConversationArtifact } from './conversation-artifact-observation';

function generation(status: string, latestVersion = 0): GenerationState {
  return {
    phase: 'failed',
    outcome: status === 'cancelled' ? 'cancelled' : 'failed',
    kind: 'note',
    title: '笔记',
    artifactId: 'artifact-1',
    detail: {
      artifact: {
        id: 'artifact-1',
        kind: 'note',
        title: '笔记',
        status: 'proposed',
        latestVersion,
      },
      latestJob: { status },
    } as ArtifactDetail,
  };
}

describe('conversation artifact observation', () => {
  it.each(['failed', 'cancelled'] as const)(
    '无版本后台任务 %s 收敛卡片',
    (status) => {
      expect(
        projectObservedConversationArtifact(generation(status)),
      ).toMatchObject({
        id: 'artifact-1',
        status,
        latestVersion: 0,
      });
    },
  );
  it('成功版本由同一任务详情恢复为可打开的卡片', () => {
    expect(
      projectObservedConversationArtifact({
        ...generation('succeeded', 1),
        phase: 'ready',
        outcome: 'ready',
      }),
    ).toMatchObject({ status: 'active', latestVersion: 1 });
  });
  it('修订失败保留可用版本', () => {
    expect(
      projectObservedConversationArtifact(generation('failed', 2)),
    ).toMatchObject({ status: 'active', latestVersion: 2 });
  });
  it('网络失败、本地取消和超时观察不能伪造任务终态', () => {
    expect(projectObservedConversationArtifact(null)).toBeNull();
    expect(
      projectObservedConversationArtifact({
        ...generation('failed'),
        detail: undefined,
      }),
    ).toBeNull();
    expect(
      projectObservedConversationArtifact({
        ...generation('running'),
        outcome: 'timed_out',
      }),
    ).toBeNull();
    expect(
      projectObservedConversationArtifact(generation('running')),
    ).toBeNull();
  });
});
