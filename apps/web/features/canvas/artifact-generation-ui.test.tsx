import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ArtifactStatusCard } from './artifact-generation-ui';
import type { ArtifactDetail } from './artifact-client';

const detail = {
  artifact: {
    id: 'artifact-1',
    kind: 'mind_map',
    title: '函数思维导图',
    latestVersion: 2,
  },
} as ArtifactDetail;

describe('ArtifactStatusCard revision outcome', () => {
  it('初次生成达到总轮询上限时显示可恢复提示', () => {
    const html = renderToStaticMarkup(
      <ArtifactStatusCard
        generation={{
          phase: 'generating',
          outcome: 'timed_out',
          kind: 'mind_map',
          artifactId: 'artifact-1',
          title: '函数思维导图',
        }}
        onOpen={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );

    expect(html).toContain('后台仍在处理，可关闭提示并稍后从资源库查看');
    expect(html).not.toContain('>打开</button>');
  });

  it.each([
    ['failed', '本次修改失败，仍可打开 v2'],
    ['cancelled', '本次修改已取消，仍可打开 v2'],
    ['timed_out', '本次修改仍在后台处理，当前可打开 v2'],
    ['pending', '本次修改仍在后台处理，当前可打开 v2'],
  ] as const)(
    '单独显示 revision %s 且保留 Canvas 打开动作',
    (outcome, text) => {
      const html = renderToStaticMarkup(
        <ArtifactStatusCard
          generation={{
            phase: 'ready',
            outcome: 'ready',
            revisionOutcome: outcome,
            kind: 'mind_map',
            artifactId: 'artifact-1',
            title: '函数思维导图',
            detail,
          }}
          onOpen={vi.fn()}
          onDismiss={vi.fn()}
        />,
      );

      expect(html).toContain(text);
      expect(html).toContain('>打开</button>');
    },
  );
});
