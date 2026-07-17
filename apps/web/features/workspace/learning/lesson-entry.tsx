'use client';

import { startAnonymousLessonAction } from '@/app/learn/actions';
import { Composer } from '@/features/composer/composer';
import type { PlusMenuActionId } from '@/features/composer/plus-menu';
import { useCallback, useTransition } from 'react';
import { EmptyChatHero } from './empty-chat-hero';
import {
  PENDING_FIRST_MENU_ACTION_KEY,
  PENDING_FIRST_PROMPT_KEY,
} from './first-prompt';
import { TopBar } from './top-bar';

/* K12 入口与工作台同一菜单集;通用产物入口待 /learn 并入统一界面后开放 */
const LESSON_ENTRY_MENU_ACTIONS: readonly PlusMenuActionId[] = [
  'upload_file',
  'upload_image',
  'create_demo',
];

/**
 * 首次访问也直接呈现可用的对话入口。第一条消息暂存在 sessionStorage，匿名会话
 * 创建并重定向后由 LearnWorkspace 消费，避免把学生问题放进 URL 或 Cookie。
 */
export function LessonEntry() {
  const [isPending, startTransition] = useTransition();

  const startLesson = useCallback(() => {
    startTransition(async () => {
      await startAnonymousLessonAction();
    });
  }, []);

  const beginWithPrompt = useCallback(
    (prompt: string) => {
      sessionStorage.removeItem(PENDING_FIRST_MENU_ACTION_KEY);
      sessionStorage.setItem(PENDING_FIRST_PROMPT_KEY, prompt);
      startLesson();
    },
    [startLesson],
  );

  const beginWithMenuAction = useCallback(
    (action: PlusMenuActionId) => {
      sessionStorage.removeItem(PENDING_FIRST_PROMPT_KEY);
      sessionStorage.setItem(PENDING_FIRST_MENU_ACTION_KEY, action);
      startLesson();
    },
    [startLesson],
  );

  return (
    <div
      data-learning-workspace
      className="flex h-dvh flex-col bg-canvas text-ink"
    >
      <TopBar courseTitle="" stageLabel={null} masteryPercent={null} quiet />
      <EmptyChatHero>
        <Composer
          availableMenuActions={LESSON_ENTRY_MENU_ACTIONS}
          chips={[]}
          busy={isPending}
          statusText={isPending ? '正在准备你的课堂…' : null}
          onSend={beginWithPrompt}
          onRemoveChip={() => undefined}
          onMenuAction={beginWithMenuAction}
          variant="landing"
        />
      </EmptyChatHero>
    </div>
  );
}
