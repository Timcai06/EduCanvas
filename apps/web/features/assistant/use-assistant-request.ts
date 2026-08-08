'use client';

import { useCallback, useRef, useState } from 'react';
import { PENDING_GENERAL_MENU_ACTION_KEY } from '@/features/workspace/general/general-chat-entry';

export interface AssistantBubble {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  status: 'pending' | 'completed' | 'failed';
}

/** 发送小助手 JSON 请求，并维护请求气泡与可取消的单飞状态。 */
export function useAssistantRequest() {
  const [bubbles, setBubbles] = useState<AssistantBubble[]>([]);
  const [busy, setBusy] = useState(false);
  const activeRequest = useRef<{
    controller: AbortController;
    assistantBubbleId: string;
  } | null>(null);

  const abort = useCallback(() => {
    const active = activeRequest.current;
    if (!active) return;
    active.controller.abort();
    activeRequest.current = null;
    setBubbles((prev) =>
      prev.map((bubble) =>
        bubble.id === active.assistantBubbleId && bubble.status === 'pending'
          ? {
              ...bubble,
              text: '已停止等待；操作可能仍在后台完成。',
              status: 'failed',
            }
          : bubble,
      ),
    );
    setBusy(false);
  }, []);

  const send = useCallback(async (text: string) => {
    // ref 是同步单飞门；不能只依赖异步 React state 阻止同一帧双击。
    if (!text.trim() || activeRequest.current) return;
    setBusy(true);
    const userBubble: AssistantBubble = {
      id: crypto.randomUUID(),
      role: 'user',
      text: text.trim(),
      status: 'completed',
    };
    const assistantBubble: AssistantBubble = {
      id: crypto.randomUUID(),
      role: 'assistant',
      text: '',
      status: 'pending',
    };
    setBubbles((prev) => [...prev, userBubble, assistantBubble]);

    const ac = new AbortController();
    activeRequest.current = {
      controller: ac,
      assistantBubbleId: assistantBubble.id,
    };

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
          prev.map((bubble) =>
            bubble.id === assistantBubble.id
              ? { ...bubble, text: errorMsg, status: 'failed' }
              : bubble,
          ),
        );
        return;
      }

      const data = await response.json();
      setBubbles((prev) =>
        prev.map((bubble) =>
          bubble.id === assistantBubble.id
            ? { ...bubble, text: data.message ?? '完成', status: 'completed' }
            : bubble,
        ),
      );

      if (
        data.action === 'created' ||
        data.action === 'renamed' ||
        data.action === 'deleted' ||
        data.action === 'switched'
      ) {
        setTimeout(() => window.location.reload(), 800);
      }

      if (data.action === 'open_artifact' && data.artifactId) {
        sessionStorage.setItem(
          'educanvas.assistant_open_artifact',
          data.artifactId,
        );
        setTimeout(() => window.location.reload(), 300);
      }

      if (data.action === 'open_panel' && data.panel) {
        sessionStorage.setItem(PENDING_GENERAL_MENU_ACTION_KEY, data.panel);
        setTimeout(() => window.location.reload(), 300);
      }
    } catch {
      if (!ac.signal.aborted) {
        setBubbles((prev) =>
          prev.map((bubble) =>
            bubble.id === assistantBubble.id && bubble.status !== 'completed'
              ? {
                  ...bubble,
                  text: bubble.text || '连接中断，请重试。',
                  status: 'failed',
                }
              : bubble,
          ),
        );
      }
    } finally {
      // 已取消的旧请求可能晚于新请求结束；只有当前请求可以释放 busy。
      if (activeRequest.current?.controller === ac) {
        activeRequest.current = null;
        setBusy(false);
      }
    }
  }, []);

  return { bubbles, busy, send, abort } as const;
}
