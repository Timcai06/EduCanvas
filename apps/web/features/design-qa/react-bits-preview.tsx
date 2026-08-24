'use client';

import { AnimatePresence, motion } from 'motion/react';
import { useRef, useState } from 'react';
import { BlurText } from '@/components/BlurText';
import { Topography } from '@/components/Topography';
import { useLenis } from '@/features/workspace/shared/use-lenis';
import { useReducedMotion } from '@/features/workspace/shared/use-reduced-motion';

interface DemoQuestion {
  prompt: string;
  options: string[];
}

const DEMO_QUESTIONS: DemoQuestion[] = [
  {
    prompt: '你更想先弄清哪个方向？',
    options: ['图像识别原理', '语言大模型怎么说话', 'AI 与我们的关系'],
  },
  {
    prompt: '你平时接触过哪些 AI 工具？',
    options: ['用过聊天助手', '用过画图/音视频', '基本没接触'],
  },
  { prompt: '你希望讲解偏？', options: ['更生活化', '更偏原理', '边做边讲'] },
];

function StepperDemo() {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const reducedMotion = useReducedMotion();
  const current = DEMO_QUESTIONS[step]!;
  const answeredCurrent = answers[step] !== undefined;
  const total = DEMO_QUESTIONS.length;

  const variants = {
    enter: { x: 24, opacity: 0 },
    center: { x: 0, opacity: 1 },
    exit: { x: -24, opacity: 0 },
  };

  return (
    <div>
      <div className="mb-5 flex items-center gap-1.5" aria-label="诊断进度">
        {DEMO_QUESTIONS.map((question, index) => {
          const done = answers[index] !== undefined;
          const active = index === step;
          const dot = active
            ? 'size-3 rounded-full bg-accent ring-4 ring-accent-soft'
            : done
              ? 'size-2.5 rounded-full bg-accent'
              : 'size-2.5 rounded-full border border-line bg-card';
          return (
            <button
              key={question.prompt}
              type="button"
              aria-label={`第 ${index + 1} 题${done ? '（已答）' : ''}`}
              aria-current={active ? 'step' : undefined}
              onClick={() => setStep(index)}
              className="min-w-6 rounded-full py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
            >
              <span aria-hidden="true" className={dot} />
            </button>
          );
        })}
      </div>

      <div className="relative overflow-hidden">
        <AnimatePresence initial={false} mode="wait">
          <motion.div
            key={step}
            className="rounded-3xl border border-line bg-surface p-5 sm:p-6"
            variants={variants}
            initial={reducedMotion ? undefined : 'enter'}
            animate={reducedMotion ? undefined : 'center'}
            exit={reducedMotion ? undefined : 'exit'}
            transition={{ duration: 0.22, ease: 'easeOut' }}
          >
            <p className="text-base leading-7 font-semibold">
              {step + 1}. {current.prompt}
            </p>
            <div className="mt-4 grid gap-2.5">
              {current.options.map((option, optionIndex) => {
                const selected = answers[step] === optionIndex;
                return (
                  <button
                    key={option}
                    type="button"
                    onClick={() =>
                      setAnswers((prev) => ({ ...prev, [step]: optionIndex }))
                    }
                    className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                      selected
                        ? 'border-accent bg-accent-soft text-ink'
                        : 'border-line bg-canvas hover:bg-surface'
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`grid size-5 shrink-0 place-items-center rounded-full border ${
                        selected
                          ? 'border-accent text-accent-strong'
                          : 'border-line'
                      }`}
                    />
                    {option}
                  </button>
                );
              })}
            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="mt-5 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setStep((s) => Math.max(s - 1, 0))}
          disabled={step === 0}
          className="inline-flex min-h-11 items-center gap-2 rounded-full border border-line bg-card px-5 text-sm font-medium text-ink transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          上一题
        </button>
        <button
          type="button"
          disabled={!answeredCurrent}
          onClick={() => setStep((s) => Math.min(s + 1, total - 1))}
          className="inline-flex min-h-11 items-center gap-2 rounded-full bg-accent px-5 text-sm font-semibold text-canvas transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          下一题
        </button>
      </div>
    </div>
  );
}

function LenisDemo() {
  const scrollRef = useRef<HTMLDivElement>(null);
  useLenis(scrollRef, { duration: 1.1 });
  const items = Array.from({ length: 30 }, (_, i) => `学习记录 ${i + 1}`);
  return (
    <div
      ref={scrollRef}
      className="h-52 overflow-y-auto rounded-2xl border border-line bg-surface p-3"
    >
      <ul className="space-y-2">
        {items.map((item) => (
          <li
            key={item}
            className="rounded-xl border border-line bg-canvas px-4 py-3 text-sm text-ink-muted transition-colors hover:bg-surface"
          >
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ReactBitsPreview() {
  return (
    <div className="space-y-10">
      <section className="space-y-3">
        <p className="text-xs font-semibold tracking-[0.2em] text-accent-strong uppercase">
          01 · BlurText
        </p>
        <h1 className="text-3xl font-semibold tracking-[-0.035em]">
          <BlurText as="span" text="柔焦落字，像一笔写成的开头" delay={0.35} />
        </h1>
      </section>

      <section className="space-y-3">
        <p className="text-xs font-semibold tracking-[0.2em] text-accent-strong uppercase">
          02 · Topography
        </p>
        <div className="relative isolate h-52 overflow-hidden rounded-2xl border border-line bg-canvas">
          <Topography />
          <div className="relative z-10 grid h-full place-items-center">
            <span className="rounded-full bg-card/70 px-4 py-1.5 text-xs text-ink-muted backdrop-blur-sm">
              学习地形 · 等高线氛围层（reduced-motion 下不加载）
            </span>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <p className="text-xs font-semibold tracking-[0.2em] text-accent-strong uppercase">
          03 · Stepper
        </p>
        <StepperDemo />
      </section>

      <section className="space-y-3">
        <p className="text-xs font-semibold tracking-[0.2em] text-accent-strong uppercase">
          04 · Lenis
        </p>
        <LenisDemo />
      </section>
    </div>
  );
}
