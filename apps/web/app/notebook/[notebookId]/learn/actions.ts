'use server';
import { redirect } from 'next/navigation';
import { submitCanvasAction } from '@/app/learn/actions';
import type {
  StudyActionResultDTO,
  CreateStudyPlanInputDTO,
  CanvasSubmissionInput,
  SubmitDiagnosticInputDTO,
} from '@/features/learning/learning-contracts';
import { readAnonymousIdentity } from '@/server/identity/anonymous-identity';
import { isValidConversationId } from '@/server/platform/general-conversation';
import {
  bootstrapStudyPlan,
  submitStudyDiagnostic,
} from '@/server/study/study-service';
import { resumeOwnedAnonymousLesson } from '@/server/teaching/learning-session';
export async function submitNotebookDiagnosticAction(
  notebookId: string,
  sessionId: string | undefined,
  goalId: string | undefined,
  input: SubmitDiagnosticInputDTO,
): Promise<StudyActionResultDTO> {
  const identity = await readAnonymousIdentity();
  if (!identity || !isValidConversationId(notebookId))
    return { status: 'unauthorized', message: '请重新打开笔记本。' };
  if (
    !sessionId ||
    !goalId ||
    !isValidConversationId(sessionId) ||
    !isValidConversationId(goalId)
  )
    return { status: 'invalid', message: '学习会话已变化，请刷新页面后重试。' };
  try {
    const outcome = await submitStudyDiagnostic(identity, input, notebookId, {
      sessionId,
      goalId,
    });
    if (!outcome.ok)
      return { status: 'invalid', message: '诊断答案不完整，请重新检查。' };
  } catch {
    return {
      status: 'error',
      requestId: crypto.randomUUID(),
      message: '诊断暂时无法提交，请重试。',
    };
  }
  redirect(`/notebook/${notebookId}/learn`);
}
export async function resumeNotebookLessonAction(
  notebookId: string,
  sessionId: string,
): Promise<void> {
  const identity = await readAnonymousIdentity();
  if (
    !identity ||
    !isValidConversationId(notebookId) ||
    !isValidConversationId(sessionId)
  )
    redirect('/');
  await resumeOwnedAnonymousLesson(identity, sessionId, notebookId);
  redirect(`/notebook/${notebookId}/learn`);
}

export async function createNotebookStudyPlanAction(
  notebookId: string,
  input: CreateStudyPlanInputDTO,
): Promise<StudyActionResultDTO> {
  const identity = await readAnonymousIdentity();
  if (!identity || !isValidConversationId(notebookId))
    return { status: 'unauthorized', message: '请重新打开笔记本。' };
  try {
    await bootstrapStudyPlan(identity, input, notebookId);
  } catch {
    return {
      status: 'error',
      requestId: crypto.randomUUID(),
      message: '总学习目标暂时无法建立，请重试。',
    };
  }
  redirect(`/notebook/${notebookId}/learn`);
}
export async function submitNotebookCanvasAction(
  notebookId: string,
  sessionId: string | null,
  goalId: string | undefined,
  input: CanvasSubmissionInput,
) {
  if (
    !sessionId ||
    !goalId ||
    !isValidConversationId(sessionId) ||
    !isValidConversationId(goalId)
  )
    return {
      status: 'invalid' as const,
      code: 'SESSION_NOT_FOUND',
      message: '学习会话已变化，请刷新页面后重试。',
    };
  return submitCanvasAction(input, notebookId, { sessionId, goalId });
}
