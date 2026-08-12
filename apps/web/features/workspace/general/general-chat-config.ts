import type { AgentTurnClientOptions } from '@/features/chat/use-teaching-turn';
import type { PlusMenuActionId } from '@/features/composer/plus-menu';

export const GENERAL_ASSET_ENDPOINT = '/api/v1/chat/assets';

export const GENERAL_TURN_OPTIONS: AgentTurnClientOptions = {
  endpoint: '/api/v1/chat/turn',
  assistantLabel: 'AI',
  cancelEndpoint: (turnId) =>
    `/api/v1/chat/turn/${encodeURIComponent(turnId)}/cancel`,
};

export const GENERAL_MENU_ACTIONS: readonly PlusMenuActionId[] = [
  'upload_file',
  'upload_image',
  'add_link',
];
