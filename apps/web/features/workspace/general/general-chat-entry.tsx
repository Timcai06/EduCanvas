'use client';

import { startGeneralChatAction } from '@/app/actions';
import { Composer } from '@/features/composer/composer';
import type { PlusMenuActionId } from '@/features/composer/plus-menu';
import { useCallback, useState, useTransition } from 'react';
import { EmptyChatHero } from '../learning/empty-chat-hero';
import { LogoMark } from '../shared/logo-mark';

export const PENDING_GENERAL_PROMPT_KEY = 'educanvas.pending-general-prompt.v1';
export const PENDING_GENERAL_MENU_ACTION_KEY =
  'educanvas.pending-general-menu-action.v1';
export const PENDING_GENERAL_CANVAS_KEY = 'educanvas.pending-general-canvas.v1';
const ENTRY_MENU_ACTIONS: readonly PlusMenuActionId[] = [
  'upload_file',
  'upload_image',
  'create_mind_map',
  'create_slides',
  'create_flashcards',
  'create_audio_overview',
];

export function GeneralChatEntry() {
  const [isPending, startTransition] = useTransition();
  const [canvasSelected, setCanvasSelected] = useState(false);
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

  const handleToolAction = useCallback(() => {
    setCanvasSelected((selected) => {
      if (selected) sessionStorage.removeItem(PENDING_GENERAL_CANVAS_KEY);
      else sessionStorage.setItem(PENDING_GENERAL_CANVAS_KEY, '1');
      return !selected;
    });
  }, []);

  return (
    <div className="flex h-dvh flex-col bg-canvas text-ink">
      <header className="flex h-16 shrink-0 items-center px-4 sm:px-6">
        <span className="inline-flex items-center gap-2.5 font-display text-base font-semibold">
          <LogoMark size={20} />
          EduCanvas
        </span>
        <span className="flex-1" />
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
          toolChips={[
            { id: 'canvas', label: 'Canvas', selected: canvasSelected },
          ]}
          onToolAction={handleToolAction}
          variant="landing"
        />
      </EmptyChatHero>
    </div>
  );
}
