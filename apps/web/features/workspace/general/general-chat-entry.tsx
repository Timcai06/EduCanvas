'use client';

import { startGeneralChatAction } from '@/app/actions';
import { Composer } from '@/features/composer/composer';
import type { PlusMenuActionId } from '@/features/composer/plus-menu';
import { useCallback, useState, useTransition } from 'react';
import { OfflineBanner } from '@/features/chat/offline-banner';
import { useOnlineStatus } from '@/features/chat/use-online-status';
import { EmptyChatHero } from '../shared/empty-chat-hero';
import { GraduationCap } from '@phosphor-icons/react';
import { UserMenu } from '@/features/auth/user-menu';
import { ProductMark } from '@/components/ProductMark';
import { PillNav, type PillNavItem } from '@/components/PillNav';

/**
 * 空态入口此时还没有 Notebook/Studio 上下文，只暴露「学习计划」一个入口，
 * 但用与主工作区 Header 相同的 PillNav 胶囊身份呈现，避免同一入口在两处长相不一。
 */
const ENTRY_NAV: readonly PillNavItem[] = [
  {
    id: 'learning-plan',
    label: '学习计划',
    href: '/learn',
    icon: <GraduationCap size={17} weight="duotone" />,
  },
];

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

export function GeneralChatEntry({ nickname }: { nickname?: string | null }) {
  const online = useOnlineStatus();
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
      <header className="flex h-16 shrink-0 items-center gap-3 px-4 sm:px-6">
        <ProductMark />
        <span className="flex-1" />
        <PillNav items={ENTRY_NAV} />
        <UserMenu />
      </header>
      {!online ? (
        <div className="shrink-0 pt-1">
          <OfflineBanner />
        </div>
      ) : null}
      <EmptyChatHero nickname={nickname}>
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
