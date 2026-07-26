'use client';

import { useGSAP } from '@gsap/react';
import { CheckCircle, Circle, WarningCircle } from '@phosphor-icons/react';
import gsap from 'gsap';
import { useRef } from 'react';
import type { MessageToolStep } from './messages';

gsap.registerPlugin(useGSAP);

/**
 * 一轮回答里的工具轨迹。
 *
 * 只呈现服务端映射出的动作名，不显示参数与返回值——判分类工具的返回值直接
 * 包含答案。轨迹保留到回答结束之后，学生可以回看这轮「做了什么」。
 *
 * 新条目用 GSAP 单独入场（独立 scope、只动 transform/opacity）；reduced-motion
 * 下不建 Timeline，条目直接就位。
 */
export function ToolTrace({ steps }: { steps: readonly MessageToolStep[] }) {
  const rootRef = useRef<HTMLOListElement>(null);

  useGSAP(
    () => {
      const media = gsap.matchMedia();
      media.add('(prefers-reduced-motion: no-preference)', () => {
        gsap.from('[data-tool-step]:last-child', {
          autoAlpha: 0,
          x: -6,
          duration: 0.28,
          ease: 'power2.out',
        });
      });
      return () => media.revert();
    },
    { scope: rootRef, dependencies: [steps.length] },
  );

  if (steps.length === 0) return null;

  return (
    <ol
      ref={rootRef}
      aria-label="这轮回答使用的工具"
      className="flex flex-col gap-1 border-l border-line pl-3 text-xs text-ink-muted"
    >
      {steps.map((step) => (
        <li
          key={step.id}
          data-tool-step
          className="flex items-center gap-1.5 leading-5"
        >
          <StepIcon status={step.status} />
          <span className={step.status === 'failed' ? 'text-bad' : undefined}>
            {step.label}
            {step.status === 'failed' ? '（未成功）' : null}
          </span>
        </li>
      ))}
    </ol>
  );
}

function StepIcon({ status }: { status: MessageToolStep['status'] }) {
  if (status === 'completed') {
    return <CheckCircle size={13} weight="fill" className="text-accent" />;
  }
  if (status === 'failed') {
    return <WarningCircle size={13} weight="fill" className="text-bad" />;
  }
  /* 运行中不使用旋转图标：轨迹可能同时有多条在跑，一排转圈会盖过正文。 */
  return <Circle size={13} className="text-ink-faint" />;
}
