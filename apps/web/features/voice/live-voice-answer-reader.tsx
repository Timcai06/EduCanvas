'use client';

import { ArrowDown } from '@phosphor-icons/react';
import { useEffect, useRef, useState, type UIEvent } from 'react';
import { MessageMarkdown } from '@/features/chat/markdown';

const LONG_ANSWER_CHARACTERS = 180;
const FOLLOW_EDGE_PX = 72;

/** 长回答或带结构的回答进入阅读面；短口语回答继续只使用中央字幕。 */
export function shouldShowLiveAnswerReader(text: string | null): boolean {
  const normalized = text?.trim() ?? '';
  if (normalized.length >= LONG_ANSWER_CHARACTERS) return true;
  return /(^|\n)(#{1,6}\s|[-*+]\s|\d+[.)]\s|```|>\s)|\n{2,}/m.test(normalized);
}

export function LiveVoiceAnswerReader({
  text,
  streaming,
  hidden = false,
}: {
  readonly text: string;
  readonly streaming: boolean;
  readonly hidden?: boolean;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [following, setFollowing] = useState(true);

  useEffect(() => {
    if (!following || hidden) return;
    const scroller = scrollerRef.current;
    if (!scroller) return;
    scroller.scrollTop = scroller.scrollHeight;
  }, [following, hidden, text]);

  const updateFollowing = (event: UIEvent<HTMLDivElement>) => {
    const scroller = event.currentTarget;
    const distance =
      scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop;
    if (distance <= FOLLOW_EDGE_PX) setFollowing(true);
  };

  return (
    <section
      data-live-answer-reader
      aria-label="本轮完整回答"
      className="live-voice-answer-reader"
      hidden={hidden}
    >
      <header>
        <div>
          <span aria-hidden="true" />
          <p>{streaming ? '回答正在生成' : '本轮回答'}</p>
        </div>
        {!following ? (
          <button
            type="button"
            onClick={() => {
              setFollowing(true);
              scrollerRef.current?.scrollTo({
                top: scrollerRef.current.scrollHeight,
                behavior: 'smooth',
              });
            }}
          >
            <ArrowDown size={15} />
            跟随最新
          </button>
        ) : null}
      </header>
      <div
        ref={scrollerRef}
        className="live-voice-answer-reader__body"
        onScroll={updateFollowing}
        onWheel={(event) => {
          if (event.deltaY < 0) setFollowing(false);
        }}
        onTouchStart={() => setFollowing(false)}
        onPointerDown={() => setFollowing(false)}
        onKeyDown={(event) => {
          if (['ArrowUp', 'PageUp', 'Home'].includes(event.key)) {
            setFollowing(false);
          }
        }}
        tabIndex={0}
      >
        <MessageMarkdown text={text} />
        {streaming ? <i aria-label="仍在生成" /> : null}
      </div>
    </section>
  );
}
