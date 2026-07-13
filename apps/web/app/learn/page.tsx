import { ChatPanel } from '@/features/chat/chat-panel';
import { CanvasStage } from '@/features/canvas/canvas-stage';
import { ProgressPanel } from '@/features/progress/progress-panel';

// 产品定义（doc/01-product/product-definition.md）中的三栏主形态：
// 左侧对话 / 中间教学 Canvas / 右侧知识地图与掌握度。

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
