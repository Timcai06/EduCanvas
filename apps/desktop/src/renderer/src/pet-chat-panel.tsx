import { useMemo, useState, type RefObject } from 'react';
import type {
  DesktopChatHistorySnapshot,
  DesktopChatMessage,
} from '../../shared/chat-history';
import type { PetUiState } from './pet-visual-state';
import { ExpandIcon, SpeakerIcon } from './pet-view';
import type { DesktopConversationDirectorySnapshot } from '../../shared/conversation-directory';
import type { DesktopResultTarget } from '../../shared/chat-history';
import { MessageResultCards } from './message-result-cards';
import type { DesktopAuthStatus } from '../../shared/desktop-auth';
import type { DesktopAttachmentRef } from '../../shared/desktop-attachment';
import { AttachmentIcon, PetChatComposer } from './pet-chat-composer';

export function PetChatPanel(props: {
  expandedView: boolean;
  state: PetUiState;
  authState: DesktopAuthStatus['state'] | 'checking';
  message: string;
  history: DesktopChatHistorySnapshot;
  historyEndRef: RefObject<HTMLDivElement | null>;
  text: string;
  busy: boolean;
  canStop: boolean;
  lastAssistantReply: string;
  speakingMessageId: string | null;
  setText(value: string): void;
  collapse(): void;
  submit(): Promise<void>;
  signIn(): Promise<void>;
  startVoice(): Promise<void>;
  speakLatest(): Promise<void>;
  speakMessage(messageId: string, text: string): Promise<void>;
  prepareSpeech(messageId: string, text: string): void;
  cancelSpeechPreparation(): void;
  cancel(): void;
  resume(): Promise<void>;
  canResume: boolean;
  directory: DesktopConversationDirectorySnapshot;
  selectConversation(conversationId: string): Promise<void>;
  createConversation(
    notebookId: string | undefined,
    title: string,
  ): Promise<void>;
  openResult(target: DesktopResultTarget): Promise<void> | void;
  pendingAttachment: DesktopAttachmentRef | null;
  attachmentBusy: boolean;
  pickAttachment(): Promise<void>;
  clearAttachment(): void;
}) {
  const {
    expandedView,
    state,
    authState,
    message,
    history,
    historyEndRef,
    text,
    busy,
    canStop,
    lastAssistantReply,
    speakingMessageId,
    setText,
    collapse,
    submit,
    signIn,
    startVoice,
    speakLatest,
    speakMessage,
    prepareSpeech,
    cancelSpeechPreparation,
    cancel,
    resume,
    canResume,
    directory,
    selectConversation,
    createConversation,
    openResult,
    pendingAttachment,
    attachmentBusy,
    pickAttachment,
    clearAttachment,
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
      <span
        className={`pet-chat__dot${busy ? ' is-active' : ''}`}
        aria-hidden="true"
      />
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
          <article
            className={`chat-message is-${item.role}${
              item.status === 'streaming' ? ' is-streaming' : ''
            }`}
            key={item.id}
            aria-hidden={item.status === 'streaming'}
          >
            <span>
              {item.role === 'user'
                ? '你'
                : item.role === 'assistant'
                  ? 'EduCanvas'
                  : '提示'}
            </span>
            {item.role === 'user' && item.source === 'voice' && (
              <small className="chat-message__source">语音输入</small>
            )}
            {item.role === 'user' && item.attachment && (
              <small
                className="chat-message__attachment"
                title={item.attachment.displayName}
              >
                <AttachmentIcon />
                {item.attachment.displayName}
              </small>
            )}
            <p>
              {item.content}
              {item.status === 'streaming' ? '▍' : ''}
            </p>
            {item.role === 'assistant' &&
              item.status === 'completed' &&
              item.content.trim() &&
              (() => {
                const selected =
                  state === 'speaking' && speakingMessageId === item.id;
                return (
                  <button
                    className={`chat-message__speak${selected ? ' is-active' : ''}`}
                    type="button"
                    aria-label={selected ? '停止朗读' : '朗读此回答'}
                    title={selected ? '停止朗读' : '朗读此回答'}
                    disabled={busy && !selected}
                    onPointerEnter={() => prepareSpeech(item.id, item.content)}
                    onPointerLeave={cancelSpeechPreparation}
                    onFocus={() => prepareSpeech(item.id, item.content)}
                    onBlur={cancelSpeechPreparation}
                    onClick={() =>
                      selected
                        ? cancel()
                        : void speakMessage(item.id, item.content)
                    }
                  >
                    <SpeakerIcon />
                  </button>
                );
              })()}
            {item.role === 'assistant' && (
              <MessageResultCards message={item} openResult={openResult} />
            )}
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
    <PetChatComposer
      expandedView={expandedView}
      state={state}
      history={history}
      text={text}
      busy={busy}
      canStop={canStop}
      lastAssistantReply={lastAssistantReply}
      setText={setText}
      submit={submit}
      startVoice={startVoice}
      speakLatest={speakLatest}
      prepareSpeech={prepareSpeech}
      cancelSpeechPreparation={cancelSpeechPreparation}
      cancel={cancel}
      resume={resume}
      canResume={canResume}
      directory={directory}
      pendingAttachment={pendingAttachment}
      attachmentBusy={attachmentBusy}
      pickAttachment={pickAttachment}
      clearAttachment={clearAttachment}
    />
  );

  const authGate = (
    <div className="pet-chat__auth-gate">
      <button
        className="send-action pet-chat__login"
        type="button"
        disabled={authState === 'authorizing'}
        onClick={() => void signIn()}
      >
        {authState === 'authorizing' ? '登录中…' : '请先登录'}
      </button>
    </div>
  );

  const authControl =
    authState === 'checking' ? (
      <div
        className="pet-chat__auth-gate"
        role="status"
        aria-label="正在检查登录状态"
        aria-busy="true"
      />
    ) : (
      authGate
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
            disabled={busy || creating}
            onClick={() => {
              const notebookId =
                current?.notebookId ?? writableNotebooks[0]?.notebookId;
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
      <div className="pet-chat__body">
        {!expandedView && (
          <p
            className="conversation-current"
            title={current?.title ?? undefined}
          >
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
      </div>
      {authState === 'signed_in' ? composer : authControl}
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
