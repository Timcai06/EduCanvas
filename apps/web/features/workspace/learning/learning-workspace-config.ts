import type { PlusMenuActionId } from '@/features/composer/plus-menu';

export const AI_UNAVAILABLE_MESSAGE = 'AI 老师暂时无法连接，请稍后重试。';

/* K12 页仍基于 lesson_sessions,通用产物入口(思维导图)待 /learn 并入统一界面后开放 */
export const LEARN_MENU_ACTIONS: readonly PlusMenuActionId[] = [
  'upload_file',
  'upload_image',
  'create_demo',
];

/** 桌面协作态对话列的宽度百分比边界；保证对话永远可读、Canvas 永远可用。 */
export const CHAT_PCT_DEFAULT = 40;
export const CHAT_PCT_MIN = 28;
export const CHAT_PCT_MAX = 62;
