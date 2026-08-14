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
  resume(): Promise<void>;
  canResume: boolean;
  directory: DesktopConversationDirectorySnapshot;
  selectConversation(conversationId: string): Promise<void>;
  createConversation(notebookId: string, title: string): Promise<void>;
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
    resume,
    canResume,
    directory,
    selectConversation,
    createConversation,
  } = props;
  const [creating, setCreating] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
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
  const headerState =
    state === 'listening'
      ? '倾听中'
      : state === 'speaking'
        ? '播报中'
        : state === 'sending'
          ? '思考中'
          : '桌面助手';

  const header = (
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
  );

  const historyList = (
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
  );

  const statusLine = (history.messages.length === 0 || state !== 'ready') && (
    <p className="pet-chat__status" role="status">
      {message}
    </p>
  );

  const composer = (
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
          <button className="send-action is-stop" type="button" onClick={cancel}>
            停止
          </button>
        ) : (
          <>
            {canResume && (
              <button
                className="send-action is-resume"
                type="button"
                onClick={() => void resume()}
              >
                续传
              </button>
            )}
            <button
              className="send-action"
              type="submit"
              disabled={!text.trim() || !directory.currentConversationId}
            >
              发送
            </button>
          </>
        )}
      </div>
    </form>
  );

  const sidebar = expandedView ? (
    <aside
      className={`conversation-sidebar${sidebarCollapsed ? ' is-collapsed' : ''}`}
      aria-label="对话列表"
    >
      {sidebarCollapsed ? (
        <button
          className="conversation-sidebar__toggle"
          type="button"
          aria-label="展开对话列表"
          title="展开对话列表"
          onClick={() => setSidebarCollapsed(false)}
        >
          »
        </button>
      ) : (
        <>
          <div className="conversation-sidebar__header">
            <strong>对话</strong>
            <button
              className="conversation-sidebar__toggle"
              type="button"
              aria-label="收起对话列表"
              title="收起对话列表"
              onClick={() => setSidebarCollapsed(true)}
            >
              «
            </button>
          </div>
          <button
            className="conversation-sidebar__action"
            type="button"
            disabled={busy || creating || writableNotebooks.length === 0}
            onClick={() => {
              const notebookId =
                current?.notebookId ?? writableNotebooks[0]?.notebookId ?? '';
              if (!notebookId) return;
              setCreating(true);
              const now = new Date();
              const title = `新对话 ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
              void createConversation(notebookId, title).finally(() =>
                setCreating(false),
              );
            }}
          >
            {creating ? '创建中…' : '＋ 新建对话'}
          </button>
          <div className="conversation-sidebar__list">
            {directory.conversations.length === 0 ? (
              <p className="conversation-sidebar__empty">暂无对话</p>
            ) : (
              directory.conversations.map((item) => (
                <button
                  key={item.conversationId}
                  type="button"
                  className={`conversation-item${
                    item.conversationId === directory.currentConversationId
                      ? ' is-active'
                      : ''
                  }`}
                  disabled={busy}
                  aria-current={
                    item.conversationId === directory.currentConversationId
                      ? 'true'
                      : undefined
                  }
                  onClick={() => void selectConversation(item.conversationId)}
                >
                  <span className="conversation-item__title">
                    {item.title ?? '未命名对话'}
                  </span>
                  <span className="conversation-item__notebook">
                    {item.notebookTitle}
                  </span>
                </button>
              ))
            )}
          </div>
          {directory.error && (
            <p className="conversation-error" role="alert">
              {directory.error}
            </p>
          )}
        </>
      )}
    </aside>
  ) : null;

  const mainContent = (
    <>
      {header}
      {!expandedView && (
        <p className="conversation-current" title={current?.title ?? undefined}>
          {current
            ? `${current.notebookTitle} · ${current.title ?? '未命名对话'}`
            : '尚未选择对话'}
        </p>
      )}
      {!expandedView && directory.error && (
        <p className="conversation-error" role="alert">
          {directory.error}
        </p>
      )}
      {historyList}
      {statusLine}
      {composer}
    </>
  );

  return (
    <section
      className={`pet-chat${expandedView ? ' is-expanded-window' : ''}`}
      aria-label="桌宠聊天"
    >
      {sidebar}
      {expandedView ? (
        <div className="pet-chat__main">{mainContent}</div>
      ) : (
        mainContent
      )}
    </section>
  );
}
