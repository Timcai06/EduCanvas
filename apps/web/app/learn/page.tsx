import { LearnWorkspace } from '@/features/workspace/learn-workspace';
import { loadLearningPageData } from '@/server/learning-session';
import { startAnonymousLessonAction } from './actions';

/**
 * 学习页在 Server Component 读取匿名会话与公开投影；对话、Canvas 与抽屉的
 * 全部交互状态在客户端 LearnWorkspace 内。默认视图是 Chat-only，Canvas 按需展开。
 */
export default async function LearnPage() {
  const learningData = await loadLearningPageData();

  if (!learningData) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center bg-canvas p-6">
        <section className="w-full max-w-md text-center">
          <p className="font-display text-lg font-bold text-accent">
            EduCanvas
          </p>
          <h1 className="font-display mt-4 text-3xl font-bold text-ink text-balance">
            你的 AI 老师已经准备好了
          </h1>
          <p className="mt-4 leading-7 text-ink-muted">
            点击开始，老师会带你一步步学习。练习结果和掌握度会自动保存，不需要注册账号。
          </p>
          <form action={startAnonymousLessonAction} className="mt-8">
            <button
              type="submit"
              className="min-h-12 w-full max-w-xs rounded-full bg-accent px-8 py-3 font-semibold text-white transition-colors hover:bg-accent-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
            >
              开始学习
            </button>
          </form>
        </section>
      </main>
    );
  }

  return <LearnWorkspace initialData={learningData} />;
}
