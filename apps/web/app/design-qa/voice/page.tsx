import { notFound } from 'next/navigation';
import { ProductMark } from '@/components/ProductMark';
import { isDesignQaEnabled } from '../design-qa-gate';

export const dynamic = 'force-dynamic';

export default async function VoiceDesignQaPage() {
  if (!isDesignQaEnabled(process.env.EDUCANVAS_ENABLE_DESIGN_QA)) notFound();
  const { VoiceComposerFixture } =
    await import('@/features/voice/voice-composer-fixture');
  return (
    <main className="min-h-dvh bg-canvas px-4 py-8 text-ink sm:px-8">
      <div className="mx-auto mb-7 w-full max-w-3xl">
        <ProductMark href="/" className="mb-5" />
        <p className="text-xs font-semibold tracking-[0.2em] text-accent-strong uppercase">
          Design QA · Voice
        </p>
        <h1 className="font-display mt-2 text-2xl font-semibold">
          短句输入与课堂字幕 fixture
        </h1>
      </div>
      <div className="mx-auto flex w-full max-w-3xl justify-center">
        <VoiceComposerFixture />
      </div>
    </main>
  );
}
