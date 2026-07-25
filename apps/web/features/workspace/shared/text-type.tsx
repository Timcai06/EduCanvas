'use client';

import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useReducedMotion } from './use-reduced-motion';
import './text-type.css';

type TypingPhase = 'typing' | 'pausing' | 'deleting' | 'waiting';

export interface TextTypeProps {
  text: string | readonly string[];
  typingSpeed?: number;
  deletingSpeed?: number;
  pauseRange?: Readonly<{ min: number; max: number }>;
  showCursor?: boolean;
  cursorCharacter?: string;
  cursorBlinkDuration?: number;
  className?: string;
}

/**
 * 有界循环打字文本。只在允许动态时逐字输入；每轮完整文本保持指定的随机停顿，
 * reduced-motion 和 SSR 首帧直接展示完整内容，避免水合错位。
 */
export function TextType({
  text,
  typingSpeed = 76,
  deletingSpeed = 46,
  pauseRange = { min: 3_000, max: 5_000 },
  showCursor = true,
  cursorCharacter = '_',
  cursorBlinkDuration = 0.55,
  className = '',
}: TextTypeProps) {
  const cursorRef = useRef<HTMLSpanElement>(null);
  const reducedMotion = useReducedMotion();
  const texts = useMemo(
    () => (Array.isArray(text) ? [...text] : [text]),
    [text],
  );
  const [textIndex, setTextIndex] = useState(0);
  const [characterCount, setCharacterCount] = useState(0);
  const [phase, setPhase] = useState<TypingPhase>('typing');
  const currentText = texts[textIndex] ?? '';
  const displayedText = reducedMotion
    ? currentText
    : currentText.slice(0, characterCount);

  useGSAP(
    () => {
      const cursor = cursorRef.current;
      if (!cursor || reducedMotion) return;
      gsap.fromTo(
        cursor,
        { autoAlpha: 1 },
        {
          autoAlpha: 0,
          duration: cursorBlinkDuration,
          repeat: -1,
          yoyo: true,
          ease: 'power2.inOut',
        },
      );
    },
    {
      scope: cursorRef,
      dependencies: [cursorBlinkDuration, reducedMotion],
      revertOnUpdate: true,
    },
  );

  useEffect(() => {
    if (reducedMotion || currentText.length === 0) return;
    const pauseMin = Math.max(0, Math.min(pauseRange.min, pauseRange.max));
    const pauseMax = Math.max(pauseMin, pauseRange.max);
    const delay =
      phase === 'typing'
        ? typingSpeed
        : phase === 'deleting'
          ? deletingSpeed
          : phase === 'pausing'
            ? pauseMin + Math.random() * (pauseMax - pauseMin)
            : 480;
    const timer = window.setTimeout(() => {
      if (phase === 'typing') {
        if (characterCount < currentText.length) {
          setCharacterCount((count) => count + 1);
        } else {
          setPhase('pausing');
        }
        return;
      }
      if (phase === 'pausing') {
        setPhase('deleting');
        return;
      }
      if (phase === 'deleting') {
        if (characterCount > 0) {
          setCharacterCount((count) => count - 1);
        } else {
          setPhase('waiting');
        }
        return;
      }
      setTextIndex((index) => (index + 1) % texts.length);
      setPhase('typing');
    }, delay);
    return () => window.clearTimeout(timer);
  }, [
    characterCount,
    currentText,
    deletingSpeed,
    pauseRange.max,
    pauseRange.min,
    phase,
    reducedMotion,
    texts.length,
    typingSpeed,
  ]);

  return (
    <span className={`text-type${className ? ` ${className}` : ''}`}>
      <span aria-hidden="true" className="text-type__content">
        {displayedText}
      </span>
      {showCursor && !reducedMotion ? (
        <span ref={cursorRef} aria-hidden="true" className="text-type__cursor">
          {cursorCharacter}
        </span>
      ) : null}
    </span>
  );
}
