import type { ReactElement, ReactNode } from 'react';
import idlePetUrl from '../../../assets/pet/idle.png';
import thinkingPetUrl from '../../../assets/pet/thinking.png';
import celebratingPetUrl from '../../../assets/pet/celebrating.png';
import loginFailedPetUrl from '../../../assets/pet/login-failed.png';
import backendOfflinePetUrl from '../../../assets/pet/backend-offline.png';
import confusedPetUrl from '../../../assets/pet/confused.png';
import listeningPetUrl from '../../../assets/pet/listening.png';
import speakingPetUrl from '../../../assets/pet/speaking.png';
import greetingPetUrl from '../../../assets/pet/greeting.png';
import type { PetVisual } from './pet-visual-state';

export interface PetAppProps {
  initialChatCollapsed?: boolean;
  view?: 'pet' | 'chat';
}

export const PET_VISUALS: Record<PetVisual, { src: string; alt: string }> = {
  idle: { src: idlePetUrl, alt: 'EduCanvas 桌宠' },
  greeting: { src: greetingPetUrl, alt: 'EduCanvas 桌宠正在打招呼' },
  listening: { src: listeningPetUrl, alt: 'EduCanvas 桌宠正在听你说话' },
  thinking: { src: thinkingPetUrl, alt: 'EduCanvas 桌宠正在思考' },
  speaking: { src: speakingPetUrl, alt: 'EduCanvas 桌宠正在播报回答' },
  celebrating: { src: celebratingPetUrl, alt: 'EduCanvas 桌宠正在庆祝' },
  'login-failed': {
    src: loginFailedPetUrl,
    alt: 'EduCanvas 桌宠提示登录失败',
  },
  'backend-offline': {
    src: backendOfflinePetUrl,
    alt: 'EduCanvas 桌宠提示服务未连接',
  },
  confused: { src: confusedPetUrl, alt: 'EduCanvas 桌宠没有理解输入' },
};

export function MicIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M6.5 11a5.5 5.5 0 0 0 11 0M12 16.5V21M9 21h6" />
    </svg>
  );
}

export function SpeakerIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 9v6h4l5 4V5L8 9H4Z" />
      <path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11" />
    </svg>
  );
}

export function ExpandIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" />
    </svg>
  );
}

export function PetDesktopShell(props: {
  chatCollapsed: boolean;
  chatPanel: ReactNode;
  petVisual: PetVisual;
  petAsset: { src: string; alt: string };
  expandChat(): void;
}): ReactElement {
  const { chatCollapsed, chatPanel, petVisual, petAsset, expandChat } = props;
  return (
    <main
      className={`pet-mvp-shell${chatCollapsed ? ' is-chat-collapsed' : ''}`}
    >
      {!chatCollapsed && chatPanel}
      {chatCollapsed && <div className="pet-chat-slot" aria-hidden="true" />}
      <div className="pet-drag-region" title="按住我拖动">
        <img
          key={petVisual}
          src={petAsset.src}
          alt={petAsset.alt}
          draggable={false}
        />
        {chatCollapsed && (
          <button
            className="pet-chat__expand"
            type="button"
            aria-label="展开对话框"
            aria-expanded="false"
            title="展开对话框"
            onClick={expandChat}
          >
            ›
          </button>
        )}
        <span>按住拖动</span>
      </div>
    </main>
  );
}
