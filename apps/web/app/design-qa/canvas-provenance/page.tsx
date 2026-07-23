import { notFound } from 'next/navigation';
import { isDesignQaEnabled } from '../design-qa-gate';

export const dynamic = 'force-dynamic';

export default async function CanvasProvenanceDesignQaPage() {
  if (!isDesignQaEnabled(process.env.EDUCANVAS_ENABLE_DESIGN_QA)) {
    notFound();
  }
  const { ArtifactProvenanceQa } =
    await import('@/features/canvas/artifact-provenance-qa');
  return (
    <main className="min-h-dvh bg-canvas px-4 py-8 text-ink sm:px-8 sm:py-12">
      <div className="mx-auto w-full max-w-2xl">
        <p className="text-xs font-semibold tracking-[0.2em] text-accent-strong uppercase">
          Design QA · Canvas 溯源
        </p>
        <h1 className="font-display mt-2 mb-7 text-2xl font-semibold sm:text-3xl">
          产物从对话中生长出来
        </h1>
        <ArtifactProvenanceQa />
      </div>
    </main>
  );
}
