import { LearnWorkspace } from '@/features/workspace/learning/learn-workspace';
import { StudyDiagnostic } from '@/features/study/study-diagnostic';
import { StudySetup } from '@/features/study/study-setup';
import { readAnonymousIdentity } from '@/server/identity/anonymous-identity';
import { loadStudyPageState } from '@/server/study/study-service';
import { loadLearningPageData } from '@/server/teaching/learning-session';
import {
  resumeAnonymousLessonAction,
  startNewAnonymousLessonAction,
} from './actions';

/**
 * 学习页在 Server Component 读取匿名会话与公开投影；对话、Canvas 与抽屉的
 * 全部交互状态在客户端 LearnWorkspace 内。默认视图是 Chat-empty，首条消息后进入
 * Chat-only，Canvas 继续按需展开。
 */
export default async function LearnPage() {
  const identity = await readAnonymousIdentity();
  const state = await loadStudyPageState(identity);

  if (state.kind === 'setup') return <StudySetup />;
  if (state.kind === 'diagnostic') {
    return <StudyDiagnostic data={state.data} />;
  }

  const learningData = identity
    ? await loadLearningPageData(identity, state.context)
    : null;
  if (!learningData) {
    return (
      <main className="grid min-h-dvh place-items-center bg-canvas px-5 text-ink">
        <section className="max-w-md rounded-3xl border border-line bg-surface p-7 text-center">
          <h1 className="text-xl font-semibold">学习工作区暂时不可用</h1>
          <p className="mt-3 leading-6 text-ink-muted">
            你的学习计划仍然保留着。请稍后刷新页面，不会自动重建或覆盖已有记录。
          </p>
        </section>
      </main>
    );
  }

  return (
    <LearnWorkspace
      initialData={learningData}
      sessionActions={{
        onNewSession: startNewAnonymousLessonAction,
        onResumeSession: resumeAnonymousLessonAction,
      }}
    />
  );
}
