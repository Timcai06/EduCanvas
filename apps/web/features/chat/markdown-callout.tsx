'use client';

import {
  BookOpen,
  Bug,
  CheckCircle,
  Info,
  Lightning,
  ListBullets,
  Notepad,
  Question,
  Quotes,
  Warning,
  type Icon,
} from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { useState, type KeyboardEvent } from 'react';

/** hast 元素的最小结构类型：仓库未直接依赖 @types/hast，避免新增声明来源。 */
interface HastElement {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: Array<HastElement | { type: string; value?: string }>;
}

/**
 * 类型 → 图标与语义配色。配色只用既有 token（含 AR01 分支色），
 * 黛蓝无 soft 底色时用 color-mix 现算——不新增全局 token。
 */
const CALLOUT_STYLES: Record<
  string,
  { Icon: Icon; iconClass: string; frameClass: string }
> = {
  note: {
    Icon: Notepad,
    iconClass: 'text-accent',
    frameClass: 'border-l-accent bg-accent-soft/40',
  },
  info: {
    Icon: Info,
    iconClass: 'text-[var(--color-branch-2)]',
    frameClass:
      'border-l-[var(--color-branch-2)] bg-[color-mix(in_srgb,var(--color-branch-2)_10%,transparent)]',
  },
  todo: {
    Icon: ListBullets,
    iconClass: 'text-[var(--color-branch-2)]',
    frameClass:
      'border-l-[var(--color-branch-2)] bg-[color-mix(in_srgb,var(--color-branch-2)_10%,transparent)]',
  },
  tip: {
    Icon: Lightning,
    iconClass: 'text-good',
    frameClass: 'border-l-good bg-good-soft/40',
  },
  success: {
    Icon: CheckCircle,
    iconClass: 'text-good',
    frameClass: 'border-l-good bg-good-soft/40',
  },
  question: {
    Icon: Question,
    iconClass: 'text-warn',
    frameClass: 'border-l-warn bg-warn-soft/40',
  },
  warning: {
    Icon: Warning,
    iconClass: 'text-warn',
    frameClass: 'border-l-warn bg-warn-soft/40',
  },
  danger: {
    Icon: Warning,
    iconClass: 'text-bad',
    frameClass: 'border-l-bad bg-bad-soft/40',
  },
  failure: {
    Icon: Warning,
    iconClass: 'text-bad',
    frameClass: 'border-l-bad bg-bad-soft/40',
  },
  bug: {
    Icon: Bug,
    iconClass: 'text-bad',
    frameClass: 'border-l-bad bg-bad-soft/40',
  },
  example: {
    Icon: BookOpen,
    iconClass: 'text-ink-muted',
    frameClass: 'border-l-ink-faint bg-surface/60',
  },
  quote: {
    Icon: Quotes,
    iconClass: 'text-ink-faint',
    frameClass: 'border-l-line-strong bg-surface/50',
  },
};

const CALLOUT_TYPE_LABELS: Record<string, string> = {
  note: '笔记',
  info: '信息',
  todo: '待办',
  tip: '提示',
  success: '成功',
  question: '问题',
  warning: '注意',
  danger: '危险',
  failure: '失败',
  bug: '缺陷',
  example: '示例',
  quote: '引用',
};

/** hast 的 data-* 属性按 camelCase 存放；兼容字符串键以防管线差异。 */
function readDataProp(
  node: HastElement | undefined,
  name: string,
): string | undefined {
  const properties = node?.properties as
    | Record<string, unknown>
    | undefined;
  if (!properties) return undefined;
  const camel = name.replace(/-([a-z])/g, (_, char: string) =>
    char.toUpperCase(),
  );
  const value = properties[camel] ?? properties[name];
  return typeof value === 'string' ? value : undefined;
}

/**
 * Callout / 引用块统一渲染（react-markdown components.blockquote）。
 *
 * 分工：remark-callout 插件在 mdast 层识别 `[!type]` 标记、写入
 * data-* 属性并消费标记行；本组件只负责「读属性 → 选图标配色 →
 * 可选折叠」。children 由既有管线产出（链接剥离/脚本转义在上游完成），
 * 本组件不引入 raw HTML，不改变任何子节点的转义行为。
 *
 * 无 data 属性的引用块在此获得基础样式（修复 note/MD 路径裸引用）。
 */
export function MarkdownCalloutBlockquote({
  node,
  children,
}: {
  node?: HastElement;
  children?: ReactNode;
}) {
  const type = readDataProp(node, 'data-callout');
  if (!type) {
    return (
      <blockquote className="my-3 rounded-r-lg border-l-4 border-line-strong bg-surface/50 px-4 py-2 text-ink-muted [&>p]:my-1.5">
        {children}
      </blockquote>
    );
  }

  const style = CALLOUT_STYLES[type] ?? CALLOUT_STYLES.note!;
  return (
    <CalloutShell
      type={type}
      title={readDataProp(node, 'data-callout-title')}
      fold={readDataProp(node, 'data-callout-fold') as '+' | '-' | undefined}
      label={CALLOUT_TYPE_LABELS[type]}
      style={style}
    >
      {children}
    </CalloutShell>
  );
}

function CalloutShell({
  type,
  title,
  fold,
  label,
  style,
  children,
}: {
  type: string;
  title?: string;
  fold?: '+' | '-';
  label?: string;
  style: { Icon: Icon; iconClass: string; frameClass: string };
  children: ReactNode;
}) {
  /* 未知类型降级 note 风格但保留原始类型名，不猜测语义 */
  const [folded, setFolded] = useState(fold === '-');
  const collapsible = fold !== undefined;
  const headingText = title || label || type;
  const Icon = style.Icon;

  const toggleOnKey = (event: KeyboardEvent) => {
    if (collapsible && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      setFolded((value) => !value);
    }
  };

  return (
    <div
      data-callout={type}
      data-callout-fold={fold}
      className={`my-3 overflow-hidden rounded-lg border border-line/70 border-l-4 ${style.frameClass}`}
    >
      <div
        {...(collapsible
          ? {
              role: 'button',
              tabIndex: 0,
              onClick: () => setFolded((value) => !value),
              onKeyDown: toggleOnKey,
            }
          : {})}
        className={`flex items-center gap-2 px-4 pt-3 pb-1 ${
          collapsible ? 'cursor-pointer select-none' : ''
        }`}
      >
        <Icon
          aria-hidden="true"
          size={15}
          weight="fill"
          className={`shrink-0 ${style.iconClass}`}
        />
        <span className="text-sm font-semibold text-ink">{headingText}</span>
        {collapsible ? (
          <span aria-hidden="true" className="ml-auto pr-1 text-xs text-ink-faint">
            {folded ? '展开' : '收起'}
          </span>
        ) : null}
      </div>
      {/* 折叠只藏内容不卸载 DOM：静态导出与站内搜索仍可见全文 */}
      <div
        className={`px-4 pb-3 text-sm leading-6 text-ink-muted [&>p]:my-1.5 ${
          folded ? 'hidden' : ''
        }`}
      >
        {children}
      </div>
    </div>
  );
}
