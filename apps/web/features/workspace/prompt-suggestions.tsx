'use client';

import { Atom, Palette, Robot } from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';

interface Suggestion {
  id: string;
  icon: Icon;
  label: string;
  prompt: string;
}

/**
 * 落地页示例提示。点击即发送真实 Turn,不预填输入框——避免用户误以为
 * 文案还需要编辑;示例必须是当前系统真实能回答的问题,不承诺未接通的能力。
 */
const SUGGESTIONS: readonly Suggestion[] = [
  {
    id: 'explain-image-recognition',
    icon: Robot,
    label: '计算机怎么认出猫和狗?',
    prompt: '用简单的比喻解释:计算机是怎么学会区分猫和狗的图片的?',
  },
  {
    id: 'interactive-demo',
    icon: Palette,
    label: '做一个互动小演示',
    prompt: '帮我做一个可以点击互动的 HTML 小演示,展示颜色混合的原理。',
  },
  {
    id: 'learn-concept',
    icon: Atom,
    label: '什么是神经网络?',
    prompt: '什么是神经网络?请从一个五年级学生能理解的角度讲起。',
  },
];

export function PromptSuggestions({
  onPick,
  disabled = false,
}: {
  onPick: (prompt: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="mt-5 flex flex-wrap items-center justify-center gap-2 px-4">
      {SUGGESTIONS.map((suggestion) => (
        <button
          key={suggestion.id}
          type="button"
          disabled={disabled}
          onClick={() => onPick(suggestion.prompt)}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-line/70 bg-surface/60 px-3.5 py-1.5 text-[13px] text-ink-muted backdrop-blur transition-colors hover:border-accent/40 hover:bg-surface hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
        >
          <suggestion.icon aria-hidden="true" size={14} />
          {suggestion.label}
        </button>
      ))}
    </div>
  );
}
