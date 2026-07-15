import { ChatPanel } from '@/features/chat/chat-panel';
import { CanvasProgressWorkspace } from '@/features/learning/canvas-progress-workspace';
import { loadLearningPageData } from '@/server/learning-session';
import { startAnonymousLessonAction } from './actions';

/**
 * 学习页在Server Component读取匿名会话与公开投影；只有Canvas交互和局部进度更新进入客户端边界。
 */
export default async function LearnPage() {
  const learningData = await loadLearningPageData();

  if (!learningData) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-slate-100 p-6">
        <section className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-sm sm:p-8">
          <p className="mb-2 text-sm font-medium text-indigo-700">
            EduCanvas 学习空间
          </p>
          <h1 className="text-2xl font-bold text-slate-950 sm:text-3xl">
            准备开始今天的互动学习
          </h1>
          <p className="mt-3 text-slate-600">
            系统会创建一个匿名学习会话，用于保存你的练习结果和掌握度，不需要注册账号。
          </p>
          <form action={startAnonymousLessonAction} className="mt-6">
            <button
              type="submit"
              className="min-h-11 w-full rounded-xl bg-indigo-600 px-5 py-3 font-semibold text-white transition-colors hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2"
            >
              开始学习
            </button>
          </form>
        </section>
      </main>
    );
  }

  return (
    <main className="grid min-h-dvh grid-cols-1 gap-px bg-slate-200 lg:h-dvh lg:grid-cols-[minmax(18rem,1fr)_minmax(0,2fr)_minmax(15rem,1fr)] lg:overflow-hidden">
      <section
        className="min-h-[18rem] bg-white p-4 lg:min-h-0 lg:overflow-y-auto"
        aria-label="AI教师对话"
      >
        <ChatPanel />
      </section>
      <CanvasProgressWorkspace initialData={learningData} />
    </main>
  );
}
