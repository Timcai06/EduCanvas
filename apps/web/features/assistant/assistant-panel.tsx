'use client';

import { ChatCircleText, PaperPlaneTilt, X } from '@phosphor-icons/react';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { InkDot } from '@/features/workspace/shared/ink-dot';
import {
  type AssistantBubble,
  useAssistantRequest,
} from './use-assistant-request';

/** matchMedia 桌面宽度订阅（useSyncExternalStore 用）。 */
function subscribeDesktopWidth(callback: () => void): () => void {
  const query = window.matchMedia('(min-width: 768px)');
  query.addEventListener('change', callback);
  return () => query.removeEventListener('change', callback);
}

/** 当前是否为桌面宽度。 */
function getDesktopWidthSnapshot(): boolean {
  return window.matchMedia('(min-width: 768px)').matches;
}

// ── Assistant Bubble ──────────────────────────────────────────────

function AssistantBubbleItem({ bubble }: { bubble: AssistantBubble }) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 8,
        alignItems: 'flex-start',
        padding: '8px 0',
        maxWidth: '100%',
      }}
    >
      {bubble.role === 'assistant' && (
        <span style={{ flexShrink: 0, marginTop: 3 }}>
          <InkDot size={10} />
        </span>
      )}
      <div
        style={{
          flex: 1,
          fontSize: '0.875rem',
          lineHeight: 1.6,
          color:
            bubble.role === 'user'
              ? 'var(--color-ink)'
              : bubble.status === 'failed'
                ? 'var(--color-cinnabar)'
                : 'var(--color-ink)',
          opacity: bubble.status === 'pending' ? 0.5 : 1,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {bubble.text || (bubble.status === 'pending' ? '...' : '')}
      </div>
    </div>
  );
}

// ── Panel ─────────────────────────────────────────────────────────

/**
 * 桌面小助手浮动面板。
 *
 * 右下角悬浮按钮 → 点击弹出小面板 → 自然语言管理笔记本。
 * 与主对话共享同一个 Agent 内核，但仅装载笔记本管理工具。
 */
export function AssistantPanel() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const { bubbles, busy, send, abort } = useAssistantRequest();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // 桌面宽度守卫：悬浮按钮为 fixed 定位 + zIndex 1000，窄视口（含移动端）
  // 会遮挡页面右下角交互元素（e2e chromium-mobile 实测被截获点击）；
  // 小助手定位为桌面能力，窄视口不渲染。useSyncExternalStore 订阅 matchMedia，
  // SSR 首帧（getServerSnapshot=false）与客户端一致，避免 hydration 失配。
  const isDesktop = useSyncExternalStore(
    subscribeDesktopWidth,
    getDesktopWidthSnapshot,
    () => false,
  );

  // 打开时聚焦输入框
  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // 新消息到达时滚动到底部
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [bubbles]);

  // 关闭面板时停止等待飞行中的请求，并把对应气泡收口为已取消；
  // HTTP 中断不承诺服务端已停止已经开始的分类工作。
  const handleClose = useCallback(() => {
    abort();
    setOpen(false);
  }, [abort]);

  // Escape 关闭
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, handleClose]);

  // 窄视口不渲染悬浮助手（守卫放在所有 hooks 之后，保证 hooks 调用顺序稳定）。
  if (!isDesktop) return null;

  const handleSend = () => {
    if (!input.trim() || busy) return;
    send(input);
    setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <>
      {/* 悬浮触发按钮（仅桌面端展示）：移动端右下角固定位会遮挡
          Composer 的发送/停止按钮与产物对话框操作，见 #292 回归。 */}
      <div className="hidden md:block">
        <button
          onClick={() => (open ? handleClose() : setOpen(true))}
          aria-label={open ? '关闭桌面助手' : '打开桌面助手'}
          style={{
            position: 'fixed',
            bottom: 24,
            right: 24,
            width: 48,
            height: 48,
            borderRadius: '50%',
            border: 'none',
            background: open ? 'var(--color-surface)' : 'var(--color-accent)',
            color: open ? 'var(--color-ink)' : '#fff',
            boxShadow: '0 2px 12px rgba(106, 74, 134, 0.25)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'background 0.2s, color 0.2s, transform 0.2s',
            transform: open ? 'rotate(90deg)' : 'none',
            zIndex: 1000,
          }}
        >
          {open ? (
            <X size={22} weight="bold" />
          ) : (
            <ChatCircleText size={22} weight="bold" />
          )}
        </button>
      </div>

      {/* 弹出面板 */}
      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="桌面助手"
          style={{
            position: 'fixed',
            bottom: 84,
            right: 24,
            width: 320,
            maxHeight: 420,
            borderRadius: 12,
            background: 'var(--color-surface)',
            boxShadow: '0 4px 24px rgba(0,0,0,0.12)',
            border: '1px solid var(--color-border, rgba(106,74,134,0.15))',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            zIndex: 999,
          }}
        >
          {/* 头部 */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '12px 16px',
              borderBottom:
                '1px solid var(--color-border, rgba(106,74,134,0.1))',
              fontSize: '0.875rem',
              fontWeight: 500,
              color: 'var(--color-accent)',
            }}
          >
            <InkDot size={10} />
            <span>桌面助手</span>
            <span style={{ flex: 1 }} />
            <span
              style={{
                fontSize: '0.75rem',
                color: 'var(--color-ink-muted)',
                fontWeight: 400,
              }}
            >
              笔记本管理
            </span>
          </div>

          {/* 气泡列表 */}
          <div
            ref={listRef}
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '8px 16px',
              minHeight: 60,
              maxHeight: 280,
            }}
          >
            {bubbles.length === 0 && (
              <p
                style={{
                  fontSize: '0.8rem',
                  color: 'var(--color-ink-muted)',
                  textAlign: 'center',
                  paddingTop: 20,
                }}
              >
                输入指令管理笔记本
              </p>
            )}
            {bubbles.map((b) => (
              <AssistantBubbleItem key={b.id} bubble={b} />
            ))}
          </div>

          {/* 输入区 */}
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-end',
              gap: 8,
              padding: '10px 12px',
              borderTop: '1px solid var(--color-border, rgba(106,74,134,0.1))',
            }}
          >
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="输入指令..."
              rows={1}
              disabled={busy}
              style={{
                flex: 1,
                resize: 'none',
                border: 'none',
                outline: 'none',
                fontSize: '0.875rem',
                lineHeight: 1.5,
                fontFamily: 'inherit',
                color: 'var(--color-ink)',
                background: 'transparent',
                padding: '4px 0',
                maxHeight: 80,
              }}
            />
            <button
              onClick={handleSend}
              disabled={busy || !input.trim()}
              aria-label="发送"
              style={{
                flexShrink: 0,
                width: 32,
                height: 32,
                borderRadius: '50%',
                border: 'none',
                background:
                  input.trim() && !busy ? 'var(--color-accent)' : 'transparent',
                color:
                  input.trim() && !busy ? '#fff' : 'var(--color-ink-faint)',
                cursor: input.trim() && !busy ? 'pointer' : 'default',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'background 0.15s, color 0.15s',
                opacity: busy ? 0.4 : 1,
              }}
            >
              <PaperPlaneTilt size={16} weight="bold" />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
