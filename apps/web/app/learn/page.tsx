import { ChatPanel } from '@/features/chat/chat-panel';
import { CanvasStage } from '@/features/canvas/canvas-stage';
import { ProgressPanel } from '@/features/progress/progress-panel';

/**
 * 三栏布局让“教师引导—动手理解—学习反馈”始终同时可见，避免退化成通用聊天页。
 * 各栏职责来自 doc/01-product/product-definition.md，前端边界见 doc/05-engineering/frontend.md。
 */
export default function LearnPage() {
  return (
    <main className="grid h-screen grid-cols-[minmax(280px,1fr)_minmax(0,2fr)_minmax(240px,1fr)] gap-px bg-slate-200">
      <section className="bg-white p-4" aria-label="AI教师对话">
        <ChatPanel />
      </section>
      <section className="bg-white p-4" aria-label="教学Canvas">
        <CanvasStage />
      </section>
      <section className="bg-white p-4" aria-label="学习进度">
        <ProgressPanel />
      </section>
    </main>
  );
}
