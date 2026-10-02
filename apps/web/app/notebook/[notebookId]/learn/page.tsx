import type { ReactNode } from 'react';
import { NotebookLearningResourceFocus } from '@/features/workspace/learning/notebook-learning-resource-focus';
import { parseHomeFocusParam } from '@/features/workspace/general/home-focus';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DrizzlePlatformConversationRepository } from '@educanvas/db';
import { LearnWorkspace } from '@/features/workspace/learning/learn-workspace';
import { StudySetup } from '@/features/study/study-setup';
import { StudyDiagnostic } from '@/features/study/study-diagnostic';
import { readAnonymousIdentity } from '@/server/identity/anonymous-identity';
import { isValidConversationId } from '@/server/platform/general-conversation';
import {
  readNotebookStudyResumeCandidate,
  loadStudyCourseOptions,
  loadStudyPageStateForNotebook,
} from '@/server/study/study-service';
import { loadLearningPageData } from '@/server/teaching/learning-session';
import {
  createNotebookStudyPlanAction,
  submitNotebookCanvasAction,
  submitNotebookDiagnosticAction,
  resumeNotebookLessonAction,
} from './actions';
export default async function NotebookLearnPage({
  params,
  searchParams,
}: {
  params: Promise<{ notebookId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { notebookId } = await params;
  const identity = await readAnonymousIdentity();
  if (!identity || !isValidConversationId(notebookId)) notFound();
  const notebook =
    await new DrizzlePlatformConversationRepository().getNotebook({
      notebookId,
      trustedSubjectId: identity.studentId,
    });
  if (!notebook) notFound();
  const query = await searchParams;
  const focusTarget = parseHomeFocusParam(query.focus);
  const repository = new DrizzlePlatformConversationRepository();
  let explicitConversation = null;
  if (query.conversation !== undefined) {
    if (
      typeof query.conversation !== 'string' ||
      !isValidConversationId(query.conversation)
    )
      notFound();
    explicitConversation = await repository.getOwned({
      conversationId: query.conversation,
      trustedSubjectId: identity.studentId,
    });
    if (
      !explicitConversation ||
      explicitConversation.spaceId !== notebookId ||
      !['general', 'k12.teacher'].includes(explicitConversation.agentProfileId)
    )
      notFound();
  }
  const focusConversation = focusTarget
    ? (explicitConversation ??
      (
        await repository.listInNotebook({
          notebookId,
          trustedSubjectId: identity.studentId,
        })
      ).find(
        (conversation) =>
          conversation.agentProfileId === 'k12.teacher' ||
          conversation.agentProfileId === 'general',
      ))
    : null;
  const withResourceFocus = (content: ReactNode) => (
    <NotebookLearningResourceFocus
      key={`${notebookId}:${focusTarget?.kind}:${focusTarget?.resourceId}`}
      target={focusTarget}
      requestContext={
        focusConversation
          ? { notebookId, conversationId: focusConversation.id }
          : null
      }
    >
      {content}
    </NotebookLearningResourceFocus>
  );
  const state = await loadStudyPageStateForNotebook(identity, notebookId);
  if (state.kind === 'setup') {
    const candidate = await readNotebookStudyResumeCandidate(
      identity,
      notebookId,
    );
    if (candidate.kind !== 'empty')
      return withResourceFocus(
        <main className="grid min-h-dvh place-items-center bg-canvas p-6 text-ink">
          <section className="max-w-md rounded-2xl border border-line bg-surface p-6">
            <h1 className="text-xl font-semibold">
              {candidate.kind === 'resume'
                ? '继续已有课程'
                : '课程记录暂时不可用'}
            </h1>
            <p className="mt-3 text-sm text-ink-muted">
              {candidate.kind === 'resume'
                ? `「${candidate.topic}」的学习记录已保留，可以继续学习。`
                : '已有总学习目标仍保留，请稍后重试。'}
            </p>
            {candidate.kind === 'resume' ? (
              <form
                action={resumeNotebookLessonAction.bind(
                  null,
                  notebookId,
                  candidate.sessionId,
                )}
              >
                <button className="mt-5 min-h-11 rounded-xl border border-line px-4 text-sm focus-visible:ring-2 focus-visible:ring-accent">
                  继续这本笔记本的课程
                </button>
              </form>
            ) : null}
            <Link
              className="mt-4 inline-flex min-h-11 items-center text-accent underline"
              href={`/notebook/${notebookId}/plans`}
            >
              返回笔记本计划
            </Link>
          </section>
        </main>,
      );
    return withResourceFocus(
      <StudySetup
        notebookId={notebookId}
        courseOptions={loadStudyCourseOptions()}
        createAction={createNotebookStudyPlanAction.bind(null, notebookId)}
      />,
    );
  }
  if (state.kind === 'diagnostic')
    return withResourceFocus(
      <StudyDiagnostic
        data={state.data}
        notebookId={notebookId}
        submitAction={submitNotebookDiagnosticAction.bind(
          null,
          notebookId,
          state.data.sessionId,
          state.data.goalId,
        )}
      />,
    );
  const data = await loadLearningPageData(identity, state.context);
  if (!data)
    return withResourceFocus(
      <main className="grid min-h-dvh place-items-center bg-canvas p-8 text-ink">
        <p>学习工作区暂时不可用，请稍后刷新。已有记录仍会保留。</p>
      </main>,
    );
  return withResourceFocus(
    <LearnWorkspace
      initialData={data}
      submitCanvas={submitNotebookCanvasAction.bind(
        null,
        notebookId,
        data.currentSessionId,
        data.goalId,
      )}
      sessionActions={{
        onResumeSession: resumeNotebookLessonAction.bind(null, notebookId),
      }}
    />,
  );
}
