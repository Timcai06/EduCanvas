import { notFound } from 'next/navigation';
import { isDesignQaEnabled } from '../design-qa-gate';

export const dynamic = 'force-dynamic';

export default async function PipelineFlowDesignQaPage() {
  if (!isDesignQaEnabled(process.env.EDUCANVAS_ENABLE_DESIGN_QA)) {
    notFound();
  }

  // Keep QA-only client code and its fixed fixture out of the default route
  // graph. These modules are loaded only after the server-side gate succeeds.
  const [{ PipelineFlowQa }, { pipelineFlowQaArtifact }] = await Promise.all([
    import('@/features/canvas/pipeline-flow-qa'),
    import('@/features/canvas/pipeline-flow-fixture'),
  ]);

  return (
    <main className="min-h-dvh bg-canvas px-4 py-8 text-ink sm:px-8 sm:py-12">
      <div className="mx-auto mb-7 w-full max-w-7xl">
        <p className="text-xs font-semibold tracking-[0.2em] text-accent-strong uppercase">
          Design QA · Pipeline Flow
        </p>
        <h1 className="font-display mt-2 text-2xl font-semibold sm:text-3xl">
          受控教学动画模板
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-muted">
          固定 React 结构与 GSAP 时间轴；内容只来自严格语义 Schema，不执行模型
          HTML、JavaScript 或动画代码。
        </p>
      </div>
      <div className="mx-auto flex w-full justify-center">
        <PipelineFlowQa artifact={pipelineFlowQaArtifact} />
      </div>
    </main>
  );
}
