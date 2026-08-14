import { useMemo, useState, type RefObject } from 'react';
import type {
  DesktopChatHistorySnapshot,
  DesktopChatMessage,
} from '../../shared/chat-history';
import type { PetUiState } from './pet-visual-state';
import { ExpandIcon, MicIcon, SpeakerIcon } from './pet-view';
import type { DesktopConversationDirectorySnapshot } from '../../shared/conversation-directory';

export function PetChatPanel(props: {
  expandedView: boolean;
  state: PetUiState;
  message: string;
  history: DesktopChatHistorySnapshot;
  historyEndRef: RefObject<HTMLDivElement | null>;
  text: string;
  busy: boolean;
  lastAssistantReply: string;
  setText(value: string): void;
  collapse(): void;
  submit(): Promise<void>;
  startVoice(): Promise<void>;
  speakLatest(): Promise<void>;
  cancel(): void;
  loadEarlier(): Promise<void>;
  directory: DesktopConversationDirectorySnapshot;
  selectConversation(conversationId: string): Promise<void>;
  createConversation(notebookId: string, title: string): Promise<void>;
  reloadConversations(): Promise<void>;
}) {
  const {
    expandedView,
    state,
    message,
    history,
    historyEndRef,
    text,
    busy,
    lastAssistantReply,
    setText,
    collapse,
    submit,
    startVoice,
    speakLatest,
    cancel,
    loadEarlier,
    directory,
    selectConversation,
    createConversation,
    reloadConversations,
  } = props;
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const current = directory.conversations.find(
    (item) => item.conversationId === directory.currentConversationId,
  );
  const writableNotebooks = useMemo(
    () =>
      Array.from(
        new Map(
          directory.conversations
            .filter((item) => ['owner', 'editor'].includes(item.membershipRole))
            .map((item) => [item.notebookId, item]),
        ).values(),
      ),
    [directory.conversations],
  );
  const [newNotebookId, setNewNotebookId] = useState('');
  const headerState =
    state === 'listening'
      ? '倾听中'
      : state === 'speaking'
        ? '播报中'
        : state === 'sending'
          ? '思考中'
          : '桌面助手';

  return (
    <section
      className={`pet-chat${expandedView ? ' is-expanded-window' : ''}`}
      aria-label="桌宠聊天"
    >
      <header>
        <span className="pet-chat__dot" aria-hidden="true" />
        <div>
          <strong>EduCanvas</strong>
          <span>{headerState}</span>
        </div>
        {!expandedView && (
          <button
            className="pet-chat__icon"
            type="button"
            aria-label="放大对话框"
            title="在可缩放窗口中打开"
            onClick={() => window.desktopPet.openChatWindow()}
          >
            <ExpandIcon />
          </button>
        )}
        {!expandedView && (
          <button
            className="pet-chat__collapse"
            type="button"
            aria-label="折叠对话框"
            aria-expanded="true"
            title="折叠对话框"
            onClick={collapse}
          >
            ‹
          </button>
        )}
        {!expandedView && (
          <button
            className="pet-chat__hide"
            type="button"
            aria-label="隐藏桌宠"
            title="隐藏到托盘"
            onClick={() => window.desktopPet.hide()}
          >
            −
          </button>
        )}
      </header>

      {expandedView ? (
        <div className="conversation-toolbar" aria-label="当前对话">
          <select
            aria-label="选择对话"
            value={directory.currentConversationId ?? ''}
            disabled={directory.loading || busy}
            onChange={(event) =>
              void selectConversation(event.currentTarget.value)
            }
          >
            {directory.conversations.length === 0 && (
              <option value="">暂无对话</option>
            )}
            {directory.conversations.map((item) => (
              <option value={item.conversationId} key={item.conversationId}>
                {item.notebookTitle} · {item.title ?? '未命名对话'}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={busy || writableNotebooks.length === 0}
            onClick={() => {
              setNewNotebookId(
                current?.notebookId ?? writableNotebooks[0]?.notebookId ?? '',
              );
              setCreating((value) => !value);
            }}
          >
            新建对话
          </button>
          <button
            type="button"
            disabled={directory.loading}
            onClick={() => void reloadConversations()}
          >
            刷新
          </button>
        </div>
      ) : (
        <p className="conversation-current" title={current?.title ?? undefined}>
          {current
            ? `${current.notebookTitle} · ${current.title ?? '未命名对话'}`
            : '尚未选择对话'}
        </p>
      )}

      {expandedView && creating && (
        <form
          className="conversation-create"
          onSubmit={(event) => {
            event.preventDefault();
            const title = newTitle.trim();
            if (!title || !newNotebookId) return;
            void createConversation(newNotebookId, title).then(() => {
              setNewTitle('');
              setCreating(false);
            });
          }}
        >
          <select
            aria-label="新对话所属 Notebook"
            value={newNotebookId}
            onChange={(event) => setNewNotebookId(event.currentTarget.value)}
          >
            {writableNotebooks.map((item) => (
              <option key={item.notebookId} value={item.notebookId}>
                {item.notebookTitle}
              </option>
            ))}
          </select>
          <input
            aria-label="新对话名称"
            maxLength={300}
            autoFocus
            value={newTitle}
            onChange={(event) => setNewTitle(event.currentTarget.value)}
            placeholder="输入对话名称"
          />
          <button type="submit" disabled={!newTitle.trim()}>
            创建
          </button>
        </form>
      )}

      {directory.error && (
        <p className="conversation-error" role="alert">
          {directory.error}
        </p>
      )}

      {history.hasMore && (
        <button
          className="pet-chat__load-earlier"
          type="button"
          disabled={history.loading}
          onClick={() => void loadEarlier()}
        >
          {history.loading ? '加载中…' : '加载更早消息'}
        </button>
      )}

      <div
        className="pet-chat__history"
        role="log"
        aria-label="对话历史"
        aria-live="polite"
      >
        {history.messages.length === 0 ? (
          <p className="pet-chat__empty">还没有对话。</p>
        ) : (
          history.messages.map((item: DesktopChatMessage) => (
            <article className={`chat-message is-${item.role}`} key={item.id}>
              <span>
                {item.role === 'user'
                  ? '你'
                  : item.role === 'assistant'
                    ? 'EduCanvas'
                    : '提示'}
              </span>
              <p>{item.content}</p>
            </article>
          ))
        )}
        <div ref={historyEndRef} />
      </div>

      {(history.messages.length === 0 || state !== 'ready') && (
        <p className="pet-chat__status" role="status">
          {message}
        </p>
      )}

      <form
        className="pet-chat__composer"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <textarea
          aria-label="输入消息"
          value={text}
          rows={expandedView ? 3 : 2}
          maxLength={4_000}
          disabled={busy}
          aria-disabled={!directory.currentConversationId || busy}
          placeholder="输入一句话…"
          onChange={(event) => setText(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void submit();
            }
          }}
        />
        <div className="pet-chat__actions">
          <button
            className={`voice-action${state === 'listening' ? ' is-active' : ''}`}
            type="button"
            aria-label={state === 'listening' ? '停止语音输入' : '开始语音输入'}
            title={state === 'listening' ? '停止语音输入' : '开始语音输入'}
            disabled={busy && state !== 'listening'}
            onClick={state === 'listening' ? cancel : () => void startVoice()}
          >
            <MicIcon />
          </button>
          <button
            className={`voice-action${state === 'speaking' ? ' is-active' : ''}`}
            type="button"
            aria-label={state === 'speaking' ? '停止朗读' : '朗读最新回复'}
            title={state === 'speaking' ? '停止朗读' : '朗读最新回复'}
            disabled={!lastAssistantReply || (busy && state !== 'speaking')}
            onClick={state === 'speaking' ? cancel : () => void speakLatest()}
          >
            <SpeakerIcon />
          </button>
          {busy && state !== 'authorizing' ? (
            <button
              className="send-action is-stop"
              type="button"
              onClick={cancel}
            >
              停止
            </button>
          ) : (
            <button
              className="send-action"
              type="submit"
              disabled={!text.trim() || !directory.currentConversationId}
            >
              发送
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
