import { LearnWorkspace } from '@/features/workspace/learning/learn-workspace';
import { LessonEntry } from '@/features/workspace/learning/lesson-entry';
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
  const learningData = await loadLearningPageData();

  if (!learningData) {
    return <LessonEntry />;
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
