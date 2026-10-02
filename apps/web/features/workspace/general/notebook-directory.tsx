'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { startNewGeneralChatAction } from '@/app/actions';
interface Notebook {
  id: string;
  title: string;
  kind: string;
}
interface Conversation {
  id: string;
  title: string | null;
  spaceId: string;
  agentProfileId: string;
}
const control =
  'min-h-11 rounded-xl border border-line bg-surface px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50';
export function NotebookDirectory({
  notebookId,
  conversationId,
}: {
  notebookId: string;
  conversationId?: string;
}) {
  const router = useRouter();
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [canCreate, setCanCreate] = useState(false);
  const [canManage, setCanManage] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      fetch('/api/v1/notebooks', { signal: controller.signal }),
      fetch(`/api/v1/notebooks/${notebookId}/conversations`, {
        signal: controller.signal,
      }),
    ])
      .then(async ([books, chats]) => {
        if (!books.ok || !chats.ok) throw new Error('unavailable');
        const [directory, children] = await Promise.all([
          books.json(),
          chats.json(),
        ]);
        if (controller.signal.aborted) return;
        setNotebooks(directory.notebooks);
        setConversations(children.conversations);
        setCanCreate(children.canCreate);
        setCanManage(children.canManage);
        setError(null);
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError('暂时无法读取笔记本，请重新加载。');
      });
    return () => controller.abort();
  }, [notebookId, revision]);
  async function createConversation() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/v1/notebooks/${notebookId}/conversations`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        },
      );
      if (!response.ok) throw new Error('unavailable');
      const data = await response.json();
      router.push(
        `/notebook/${notebookId}/conversation/${data.conversation.id}`,
      );
    } catch {
      setError('新建对话失败，请重试。');
    } finally {
      setBusy(false);
    }
  }
  async function rename(
    kind: 'notebook' | 'conversation',
    id: string,
    previous: string,
  ) {
    const title = window
      .prompt(kind === 'notebook' ? '命名笔记本' : '命名对话', previous)
      ?.normalize('NFC')
      .trim();
    if (!title || title === previous) return;
    if (title.length > 120) {
      setError('名称应为1到120个字符。');
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(
        kind === 'notebook'
          ? `/api/v1/notebooks/${id}`
          : `/api/v1/chat/conversations/${id}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title }),
        },
      );
      if (!response.ok) throw new Error('unavailable');
      setRevision((value) => value + 1);
      router.refresh();
    } catch {
      setError('名称未能保存，请重试。');
    } finally {
      setBusy(false);
    }
  }
  async function archive(id: string) {
    if (!window.confirm('归档这条对话？其他对话和笔记本资料会保留。')) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/v1/chat/conversations/${id}`, {
        method: 'DELETE',
      });
      if (!response.ok) throw new Error('unavailable');
      if (id === conversationId) router.push(`/notebook/${notebookId}/plans`);
      else setRevision((value) => value + 1);
    } catch {
      setError('归档对话失败，请重试。');
    } finally {
      setBusy(false);
    }
  }
  return (
    <nav aria-label="笔记本与对话" className="flex flex-col gap-3 p-3">
      <label
        className="text-xs font-medium text-ink-muted"
        htmlFor="notebook-selector"
      >
        当前笔记本
      </label>
      <select
        id="notebook-selector"
        className={control}
        value={notebookId}
        onChange={(event) => router.push(`/notebook/${event.target.value}`)}
      >
        <option value={notebookId}>
          {notebooks.find((book) => book.id === notebookId)?.title ??
            '当前笔记本'}
        </option>
        {notebooks
          .filter((book) => book.id !== notebookId)
          .map((book) => (
            <option key={book.id} value={book.id}>
              {book.title}
              {book.kind === 'course' ? ' · 课程' : ''}
            </option>
          ))}
      </select>
      <div className="flex gap-2">
        <button
          className={control}
          onClick={() => void startNewGeneralChatAction()}
        >
          新建笔记本
        </button>
        {canManage ? (
          <button
            disabled={busy}
            className={control}
            onClick={() =>
              void rename(
                'notebook',
                notebookId,
                notebooks.find((book) => book.id === notebookId)?.title ?? '',
              )
            }
          >
            命名笔记本
          </button>
        ) : null}
      </div>
      <Link className={control} href={`/notebook/${notebookId}/plans`}>
        学习目标与计划
      </Link>
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold text-ink-muted">本笔记本的对话</h2>
        {canCreate ? (
          <button
            className={control}
            disabled={busy}
            onClick={() => void createConversation()}
          >
            {busy ? '处理中…' : '新建对话'}
          </button>
        ) : null}
      </div>
      <ul className="space-y-1">
        {conversations.map((chat) => (
          <li key={chat.id} className="rounded-xl border border-line/60 p-2">
            <Link
              aria-current={chat.id === conversationId ? 'page' : undefined}
              className={`block min-h-11 rounded-lg px-2 py-3 text-sm focus-visible:ring-2 focus-visible:ring-accent ${chat.id === conversationId ? 'bg-accent-soft font-semibold text-accent-strong' : 'hover:bg-surface'}`}
              href={
                chat.agentProfileId === 'general'
                  ? `/notebook/${notebookId}/conversation/${chat.id}`
                  : `/notebook/${notebookId}/learn`
              }
            >
              {chat.title ??
                (chat.agentProfileId === 'general'
                  ? '未命名对话'
                  : '课程学习对话')}
            </Link>
            {canManage ? (
              <div className="flex gap-3 px-2">
                <button
                  disabled={busy}
                  className="min-h-8 text-xs text-ink-muted focus-visible:ring-2 focus-visible:ring-accent"
                  onClick={() =>
                    void rename('conversation', chat.id, chat.title ?? '')
                  }
                >
                  命名对话
                </button>
                <button
                  disabled={busy}
                  className="min-h-8 text-xs text-ink-muted focus-visible:ring-2 focus-visible:ring-accent"
                  onClick={() => void archive(chat.id)}
                >
                  归档对话
                </button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {!conversations.length ? (
        <p className="text-sm text-ink-muted">还没有对话。新建一条开始讨论。</p>
      ) : null}
      {error ? (
        <div role="alert">
          <p className="text-sm text-cinnabar">{error}</p>
          <button
            className={control}
            onClick={() => setRevision((value) => value + 1)}
          >
            重新加载
          </button>
        </div>
      ) : null}
    </nav>
  );
}
