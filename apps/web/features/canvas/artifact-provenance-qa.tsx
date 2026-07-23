'use client';

import type { ArtifactDetail } from './artifact-client';
import {
  ArtifactGeneratingSkeleton,
  ArtifactProvenanceStrip,
} from './artifact-provenance';

/**
 * 设计 QA:溯源条在不同状态下的样张（生成中 / 已就绪 / 失败 / 带来源），
 * 与生成中骨架。仅供 EDUCANVAS_ENABLE_DESIGN_QA 门后的人工/快照复核。
 */

const base: ArtifactDetail['artifact'] = {
  id: 'qa',
  kind: 'mind_map',
  trustTier: 'tier1',
  title: '分数运算思维导图',
  status: 'active',
  latestVersion: 2,
  fromConversation: true,
  createdAt: '2026-07-20T06:00:00.000Z',
  updatedAt: new Date().toISOString(),
};

function detail(
  overrides: Omit<Partial<ArtifactDetail>, 'artifact'> & {
    artifact?: Partial<ArtifactDetail['artifact']>;
  } = {},
): ArtifactDetail {
  return {
    artifact: { ...base, ...overrides.artifact },
    version: overrides.version ?? { version: 2, content: {}, media: null },
    versions: overrides.versions ?? [
      {
        version: 2,
        generatedBy: 'model:artifact.revise:v1',
        revisionInstruction: '把根节点改成蓝色，并加一个例子分支',
        createdAt: base.updatedAt,
      },
      {
        version: 1,
        generatedBy: 'rule:outline-v1',
        revisionInstruction: null,
        createdAt: base.createdAt,
      },
    ],
    latestJob: overrides.latestJob ?? null,
  };
}

const cases: { label: string; detail: ArtifactDetail; revising: boolean }[] = [
  { label: '已就绪', detail: detail(), revising: false },
  {
    label: '正在生成（首次）',
    detail: detail({
      version: null,
      latestJob: {
        id: 'j',
        status: 'running',
        progress: 45,
        failureCode: null,
      },
    }),
    revising: false,
  },
  { label: '正在生成新版本（共创）', detail: detail(), revising: true },
  {
    label: '生成失败',
    detail: detail({
      latestJob: {
        id: 'j',
        status: 'failed',
        progress: null,
        failureCode: 'runtime_failed',
      },
    }),
    revising: false,
  },
  {
    label: '带来源（音频概览）',
    detail: detail({
      artifact: { kind: 'audio_overview', title: '光合作用音频概览' },
      version: {
        version: 1,
        content: null,
        media: {
          url: '/x',
          contentVersion: 1,
          contentType: 'audio/mpeg',
          byteSize: 1,
          transcript: '',
          sourceCount: 3,
          script: {
            generator: 'g',
            provider: null,
            resolvedModelId: null,
            inputTokens: 0,
            outputTokens: 0,
            latencyMs: 0,
          },
          speech: {
            provider: 'p',
            resolvedModelId: 'm',
            voice: 'v',
            inputCharacters: 0,
            latencyMs: 0,
          },
        },
      },
    }),
    revising: false,
  },
];

export function ArtifactProvenanceQa() {
  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <h2 className="font-display text-lg font-semibold text-ink">
          溯源条状态
        </h2>
        <div className="space-y-4">
          {cases.map((testCase) => (
            <div key={testCase.label} className="space-y-1.5">
              <p className="text-xs font-medium text-ink-muted">
                {testCase.label}
              </p>
              <div className="overflow-hidden rounded-2xl border border-line bg-canvas">
                <ArtifactProvenanceStrip
                  detail={testCase.detail}
                  revising={testCase.revising}
                />
              </div>
            </div>
          ))}
        </div>
      </section>
      <section className="space-y-4">
        <h2 className="font-display text-lg font-semibold text-ink">
          生成中骨架
        </h2>
        <div className="rounded-2xl border border-line bg-canvas p-4">
          <ArtifactGeneratingSkeleton />
        </div>
      </section>
    </div>
  );
}
