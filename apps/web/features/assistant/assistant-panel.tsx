'use client';

import { ChatCircleText, PaperPlaneTilt, X } from '@phosphor-icons/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { InkDot } from '@/features/workspace/shared/ink-dot';
import { PENDING_GENERAL_MENU_ACTION_KEY } from '@/features/workspace/general/general-chat-entry';

// ── Types ─────────────────────────────────────────────────────────

interface Bubble {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  status: 'pending' | 'streaming' | 'completed' | 'failed';
}

// ── Hook ──────────────────────────────────────────────────────────

/**
 * Assistant 专用的轻量 SSE 消费 hook。
 * 与 useAgentTurn 使用相同的底层事件解析，但不维护历史消息列表。
 */
function useAssistantStream() {
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);

  const send = useCallback(
    async (text: string) => {
      if (!text.trim() || busy) return;
      setBusy(true);
      const userBubble: Bubble = {
        id: crypto.randomUUID(),
        role: 'user',
        text: text.trim(),
        status: 'completed',
      };
      const assistantBubble: Bubble = {
        id: crypto.randomUUID(),
        role: 'assistant',
        text: '',
        status: 'pending',
      };
      setBubbles((prev) => [...prev, userBubble, assistantBubble]);

      const ac = new AbortController();
      controller.current = ac;

      try {
        const response = await fetch('/api/v1/assistant/turn', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({
            clientMessageId: crypto.randomUUID(),
            text: text.trim(),
          }),
          signal: ac.signal,
        });

        if (!response.ok) {
          let errorMsg = '抱歉，暂时无法处理。';
          try {
            const err = await response.json();
            if (err?.error?.message) errorMsg = err.error.message;
          } catch {}
          setBubbles((prev) =>
            prev.map((b) =>
              b.id === assistantBubble.id
                ? { ...b, text: errorMsg, status: 'failed' }
                : b,
            ),
          );
          setBusy(false);
          return;
        }

        // 管理操作：JSON 直接返回（assistant 端点只返回 JSON，无 SSE 分支）
        const data = await response.json();
        setBubbles((prev) =>
          prev.map((b) =>
            b.id === assistantBubble.id
              ? { ...b, text: data.message ?? '完成', status: 'completed' }
              : b,
          ),
        );

        // 需要刷新页面的操作
        if (
          data.action === 'created' ||
          data.action === 'renamed' ||
          data.action === 'deleted' ||
          data.action === 'switched'
        ) {
          setTimeout(() => window.location.reload(), 800);
        }

        // 打开产物：存 sessionStorage 后刷新
        if (data.action === 'open_artifact' && data.artifactId) {
          sessionStorage.setItem(
            'educanvas.assistant_open_artifact',
            data.artifactId,
          );
          setTimeout(() => window.location.reload(), 300);
        }

        // 打开面板：存 sessionStorage 后刷新
        if (data.action === 'open_panel' && data.panel) {
          sessionStorage.setItem(PENDING_GENERAL_MENU_ACTION_KEY, data.panel);
          setTimeout(() => window.location.reload(), 300);
        }
        setBusy(false);
      } catch {
        if (!ac.signal.aborted) {
          setBubbles((prev) =>
            prev.map((b) =>
              b.id === assistantBubble.id && b.status !== 'completed'
                ? {
                    ...b,
                    text: b.text || '连接中断，请重试。',
                    status: 'failed',
                  }
                : b,
            ),
          );
        }
        setBusy(false);
      } finally {
        if (controller.current === ac) controller.current = null;
      }
    },
    [busy],
  );

  return { bubbles, busy, send } as const;
}

// ── Assistant Bubble ──────────────────────────────────────────────

function AssistantBubbleItem({ bubble }: { bubble: Bubble }) {
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
  const { bubbles, busy, send } = useAssistantStream();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

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

  // Escape 关闭
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

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
      {/* 悬浮触发按钮 */}
      <button
        onClick={() => setOpen((prev) => !prev)}
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
