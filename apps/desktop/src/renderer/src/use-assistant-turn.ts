import { useCallback, useRef, useState } from 'react';
import { buildTurnRequest } from './turn-request';
import { turnResultToBubble } from './turn-response';

export interface Bubble {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  status: 'pending' | 'completed' | 'failed';
}

export function useAssistantTurn() {
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const busyRef = useRef(false);

  const append = useCallback((bubble: Bubble) => {
    setBubbles((prev) => [...prev, bubble]);
  }, []);

  const updateLastAssistant = useCallback(
    (patch: Partial<Pick<Bubble, 'text' | 'status'>>) => {
      setBubbles((prev) => {
        const next = [...prev];
        for (let i = next.length - 1; i >= 0; i -= 1) {
          if (next[i]!.role === 'assistant') {
            next[i] = { ...next[i]!, ...patch };
            break;
          }
        }
        return next;
      });
    },
    [],
  );

  const send = useCallback(
    (raw: string) => {
      if (busyRef.current) return;
      const request = buildTurnRequest(raw);
      if (!request) return;
      busyRef.current = true;
      setBusy(true);

      append({
        id: crypto.randomUUID(),
        role: 'user',
        text: request.text,
        status: 'completed',
      });
      append({
        id: crypto.randomUUID(),
        role: 'assistant',
        text: '',
        status: 'pending',
      });

      const ac = new AbortController();
      controller.current = ac;

      window.desktopAssistant
        .turn(request.text, ac.signal)
        .then((result) => {
          const presentation = turnResultToBubble(result);
          if (presentation) updateLastAssistant(presentation);
        })
        .catch(() => {
          updateLastAssistant({ text: '连接中断，请重试。', status: 'failed' });
        })
        .finally(() => {
          busyRef.current = false;
          setBusy(false);
          if (controller.current === ac) controller.current = null;
        });
    },
    [append, updateLastAssistant],
  );

  const cancel = useCallback(() => {
    controller.current?.abort();
  }, []);

  return { bubbles, busy, send, cancel } as const;
}
