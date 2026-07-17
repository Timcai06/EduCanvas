'use client';

import { startGeneralChatAction } from '@/app/actions';
import { Composer } from '@/features/composer/composer';
import type { PlusMenuActionId } from '@/features/composer/plus-menu';
import Link from 'next/link';
import { useCallback, useTransition } from 'react';
import { EmptyChatHero } from '../learning/empty-chat-hero';

export const PENDING_GENERAL_PROMPT_KEY = 'educanvas.pending-general-prompt.v1';
export const PENDING_GENERAL_MENU_ACTION_KEY =
  'educanvas.pending-general-menu-action.v1';
const ENTRY_MENU_ACTIONS: readonly PlusMenuActionId[] = [
  'upload_file',
  'upload_image',
];

export function GeneralChatEntry() {
  const [isPending, startTransition] = useTransition();
  const begin = useCallback((prompt: string) => {
    sessionStorage.removeItem(PENDING_GENERAL_MENU_ACTION_KEY);
    sessionStorage.setItem(PENDING_GENERAL_PROMPT_KEY, prompt);
    startTransition(async () => {
      await startGeneralChatAction();
    });
  }, []);

  const beginWithMenuAction = useCallback((action: PlusMenuActionId) => {
    sessionStorage.removeItem(PENDING_GENERAL_PROMPT_KEY);
    sessionStorage.setItem(PENDING_GENERAL_MENU_ACTION_KEY, action);
    startTransition(async () => {
      await startGeneralChatAction();
    });
  }, []);

  return (
    <div className="flex h-dvh flex-col bg-canvas text-ink">
      <header className="flex h-16 shrink-0 items-center px-4 sm:px-6">
        <span className="font-display text-base font-semibold tracking-[-0.02em]">
          EduCanvas
        </span>
        <span className="flex-1" />
        <Link
          href="/learn"
          className="rounded-full px-4 py-2 text-sm text-ink-muted transition-colors hover:bg-surface hover:text-ink"
        >
          K12 学习模式
        </Link>
      </header>
      <EmptyChatHero>
        <Composer
          chips={[]}
          busy={isPending}
          statusText={isPending ? '正在创建对话…' : null}
          onSend={begin}
          onRemoveChip={() => undefined}
          onMenuAction={beginWithMenuAction}
          availableMenuActions={ENTRY_MENU_ACTIONS}
          variant="landing"
        />
      </EmptyChatHero>
    </div>
  );
}
