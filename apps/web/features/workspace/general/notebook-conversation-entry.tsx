'use client';
import { useEffect, useState, type ComponentProps } from 'react';
import { GeneralChatWorkspace } from './general-chat-workspace';
/** 首次显式深链先验证并同步兼容游标，随后工作区才能发起旧BFF请求。 */
export function NotebookConversationEntry(
  props: ComponentProps<typeof GeneralChatWorkspace>,
) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>(
    'loading',
  );
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/v1/notebooks/${props.notebookId}/conversations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ conversationId: props.conversationId }),
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error('unavailable');
        setStatus('ready');
      })
      .catch(() => {
        if (!controller.signal.aborted) setStatus('failed');
      });
    return () => controller.abort();
  }, [props.notebookId, props.conversationId, retry]);
  if (status === 'ready') return <GeneralChatWorkspace {...props} />;
  return (
    <main className="grid min-h-dvh place-items-center bg-canvas text-ink">
      <section role="status" className="max-w-md p-8 text-center">
        <p>
          {status === 'loading'
            ? '正在打开笔记本…'
            : '暂时无法打开这条对话，请重试。'}
        </p>
        {status === 'failed' ? (
          <button
            className="mt-4 rounded-full border border-line px-5 py-2 focus-visible:ring-2 focus-visible:ring-accent"
            onClick={() => {
              setStatus('loading');
              setRetry((value) => value + 1);
            }}
          >
            重试
          </button>
        ) : null}
      </section>
    </main>
  );
}
