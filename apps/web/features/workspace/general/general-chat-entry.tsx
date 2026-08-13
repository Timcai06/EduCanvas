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
import type { OutputPreference } from '@educanvas/agent-core';
import {
  createPendingGeneralTurnWrite,
  pendingGeneralTurnReadKeys,
} from './pending-general-turn';

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
export const PENDING_GENERAL_OUTPUT_PREFERENCE_KEY =
  'educanvas.pending-general-output-preference.v1';
const ENTRY_MENU_ACTIONS: readonly PlusMenuActionId[] = [
  'upload_file',
  'upload_image',
  'add_link',
];

export function GeneralChatEntry({ nickname }: { nickname?: string | null }) {
  const [draft, setDraft] = useState('');
  const online = useOnlineStatus();
  const [isPending, startTransition] = useTransition();
  const [outputPreference, setOutputPreference] =
    useState<OutputPreference>('auto');
  const begin = useCallback(
    (prompt: string) => {
      pendingGeneralTurnReadKeys.forEach((key) =>
        sessionStorage.removeItem(key),
      );
      const write = createPendingGeneralTurnWrite({ prompt, outputPreference });
      sessionStorage.setItem(write.key, write.value);
      startTransition(async () => {
        await startGeneralChatAction();
      });
    },
    [outputPreference],
  );

  const beginWithMenuAction = useCallback((action: PlusMenuActionId) => {
    pendingGeneralTurnReadKeys.forEach((key) => sessionStorage.removeItem(key));
    sessionStorage.setItem(PENDING_GENERAL_MENU_ACTION_KEY, action);
    startTransition(async () => {
      await startGeneralChatAction();
    });
  }, []);

  return (
    <div
      data-general-workspace
      className="flex h-dvh flex-col bg-canvas text-ink"
    >
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
          value={draft}
          onValueChange={setDraft}
          chips={[]}
          busy={isPending}
          statusText={isPending ? '正在创建对话…' : null}
          onSend={begin}
          onRemoveChip={() => undefined}
          onMenuAction={beginWithMenuAction}
          availableMenuActions={ENTRY_MENU_ACTIONS}
          toolChips={[]}
          outputPreference={outputPreference}
          onOutputPreferenceChange={(preference) => {
            setOutputPreference(preference);
          }}
          variant="landing"
        />
      </EmptyChatHero>
    </div>
  );
}
