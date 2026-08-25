import { useEffect, useRef, useState, type UIEvent } from 'react';
import type { DesktopChatMessage } from '../../shared/chat-history';

const BOTTOM_THRESHOLD_PX = 36;

export function isChatHistoryNearBottom(input: {
  scrollHeight: number;
  scrollTop: number;
  clientHeight: number;
}): boolean {
  return (
    input.scrollHeight - input.scrollTop - input.clientHeight <=
    BOTTOM_THRESHOLD_PX
  );
}

export function useChatFollow(
  conversationId: string | null,
  messages: readonly DesktopChatMessage[],
) {
  const historyScrollRef = useRef<HTMLDivElement | null>(null);
  const historyEndRef = useRef<HTMLDivElement | null>(null);
  const followingRef = useRef(true);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);

  const scrollToLatest = (behavior: ScrollBehavior = 'auto'): void => {
    historyEndRef.current?.scrollIntoView({ block: 'end', behavior });
    followingRef.current = true;
    setShowJumpToLatest(false);
  };

  useEffect(() => {
    followingRef.current = true;
    scrollToLatest();
  }, [conversationId]);

  useEffect(() => {
    if (followingRef.current) scrollToLatest();
    else setShowJumpToLatest(true);
  }, [messages]);

  const onHistoryScroll = (event: UIEvent<HTMLDivElement>): void => {
    const nearBottom = isChatHistoryNearBottom(event.currentTarget);
    followingRef.current = nearBottom;
    setShowJumpToLatest(!nearBottom);
  };

  const jumpToLatest = (): void => {
    const reducedMotion = window.matchMedia?.(
      '(prefers-reduced-motion: reduce)',
    ).matches;
    scrollToLatest(reducedMotion ? 'auto' : 'smooth');
  };

  return {
    historyScrollRef,
    historyEndRef,
    showJumpToLatest,
    onHistoryScroll,
    jumpToLatest,
  };
}
