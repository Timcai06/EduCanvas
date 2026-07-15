'use server';

import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import type {
  CanvasSubmissionInput,
  SubmitCanvasResultDTO,
} from '@/features/learning/learning-contracts';
import {
  createAnonymousIdentity,
  readAnonymousIdentity,
  writeAnonymousIdentityCookie,
} from '@/server/anonymous-identity';
import {
  bootstrapAnonymousLesson,
  hasActiveAnonymousLesson,
  progressFromSubmission,
  submitOwnedCanvas,
} from '@/server/learning-session';

/** 明确的用户动作负责创建Cookie；Server Component渲染绝不写Cookie。 */
export async function startAnonymousLessonAction(): Promise<void> {
  const existingIdentity = await readAnonymousIdentity();
  const identity =
    existingIdentity && (await hasActiveAnonymousLesson(existingIdentity))
      ? existingIdentity
      : createAnonymousIdentity();
  await bootstrapAnonymousLesson(identity);
  await writeAnonymousIdentityCookie(identity.token);
  redirect('/learn');
}

const publicMessages: Record<string, string> = {
  INVALID_CLIENT_EVENT: '提交格式无效，请刷新页面后重试。',
  EVENT_NOT_GRADABLE: '当前交互不能作为答案提交。',
  ARTIFACT_MISMATCH: '提交内容与当前练习不匹配。',
  EVENT_TYPE_MISMATCH: '提交类型与当前练习不匹配。',
  UNKNOWN_ITEM: '提交包含未知题目。',
  UNKNOWN_CHOICE: '提交包含未知选项。',
  INCOMPLETE_SUBMISSION: '请完成全部题目后再提交。',
  ARTIFACT_NOT_FOUND: '当前练习不可用，请刷新页面。',
  SESSION_NOT_FOUND: '学习会话不可用，请重新开始。',
  NO_ACTIVE_KNOWLEDGE_NODE: '当前课程尚未准备完成。',
  IDEMPOTENCY_CONFLICT: '重复提交内容不一致，请刷新页面。',
};

/** 仅返回learning-contracts公开DTO；内部事件、身份、判分键和异常不会序列化到浏览器。 */
export async function submitCanvasAction(
  input: CanvasSubmissionInput,
): Promise<SubmitCanvasResultDTO> {
  try {
    const result = await submitOwnedCanvas(input);
    if (!result.authenticated) {
      return { status: 'unauthorized', message: '请先开始学习。' };
    }
    if (!result.outcome.ok) {
      if (result.outcome.code === 'SESSION_NOT_FOUND') {
        return {
          status: 'unauthorized',
          message: '学习会话不可用，请重新开始。',
        };
      }
      return {
        status: 'invalid',
        code: result.outcome.code,
        message:
          publicMessages[result.outcome.code] ?? '提交未通过校验，请重试。',
      };
    }
    return {
      status: 'success',
      replayed: result.outcome.replayed,
      feedback: {
        attemptedItems: result.outcome.grading.attemptedItems,
        correctItems: result.outcome.grading.correctItems,
        itemResults: result.outcome.grading.itemResults,
        message: result.outcome.grading.feedback ?? null,
      },
      progress: progressFromSubmission(result.outcome),
    };
  } catch (error) {
    const requestId = randomUUID();
    console.error('Canvas提交失败', { requestId, error });
    return {
      status: 'error',
      requestId,
      message: '提交暂时失败，请稍后重试。',
    };
  }
}
