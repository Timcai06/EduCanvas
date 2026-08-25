import { notFound } from 'next/navigation';
import { ProductMark } from '@/components/ProductMark';
import { isDesignQaEnabled } from '../design-qa-gate';

export const dynamic = 'force-dynamic';

export default async function UiPrimitivesDesignQaPage() {
  if (!isDesignQaEnabled(process.env.EDUCANVAS_ENABLE_DESIGN_QA)) {
    notFound();
  }
  const { UiPrimitivesPreview } =
    await import('@/features/design-qa/ui-primitives-preview');
  return (
    <main className="min-h-dvh bg-canvas px-4 py-8 text-ink sm:px-8 sm:py-12">
      <div className="mx-auto w-full max-w-2xl">
        <ProductMark href="/" className="mb-5" />
        <p className="text-xs font-semibold tracking-[0.2em] text-accent-strong uppercase">
          Design QA · UI 基础件
        </p>
        <h2 className="font-display mt-2 mb-7 text-2xl font-semibold sm:text-3xl">
          阶段一四组件预览（明暗 / motion 验收）
        </h2>
        <UiPrimitivesPreview />
      </div>
    </main>
  );
}
