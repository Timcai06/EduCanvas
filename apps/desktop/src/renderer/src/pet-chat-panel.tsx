import { useMemo, useState, type RefObject } from 'react';
import type {
  DesktopChatHistorySnapshot,
  DesktopChatMessage,
} from '../../shared/chat-history';
import type { PetUiState } from './pet-visual-state';
import { ExpandIcon, MicIcon, SpeakerIcon } from './pet-view';
import type { DesktopConversationDirectorySnapshot } from '../../shared/conversation-directory';
import type { DesktopResultTarget } from '../../shared/chat-history';
import { MessageResultCards } from './message-result-cards';
import type { DesktopAuthStatus } from '../../shared/desktop-auth';
import type { DesktopAttachmentRef } from '../../shared/desktop-attachment';

function AttachmentIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
    >
      <rect x="3.5" y="4.5" width="13" height="15" rx="3" />
      <circle cx="8" cy="9" r="1.25" />
      <path d="m5.5 17 3.8-4 2.8 2.7 1.6-1.7 2.8 3" />
      <path d="M19.5 8v6M16.5 11h6" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12h13M13 7l5 5-5 5" />
    </svg>
  );
}

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
  const [isComposing, setIsComposing] = useState(false);
  const current = directory.conversations.find(
    (item) => item.conversationId === directory.currentConversationId,
  );
  const lastAssistantMessage = history.messages.findLast(
    (item) => item.role === 'assistant',
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
    <form
      className="pet-chat__composer"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="pet-chat__editor">
        {pendingAttachment && (
          <div className="attachment-preview" role="status">
            <span className="attachment-preview__icon" aria-hidden="true">
              <AttachmentIcon />
            </span>
            <span className="attachment-preview__copy">
              <strong title={pendingAttachment.displayName}>
                {pendingAttachment.displayName}
              </strong>
              <small>
                {pendingAttachment.mimeType.startsWith('image/')
                  ? '图片已就绪'
                  : 'PDF 已就绪'}
              </small>
            </span>
            <button
              type="button"
              className="attachment-preview__remove"
              aria-label={`移除附件 ${pendingAttachment.displayName}`}
              title="移除附件"
              onClick={clearAttachment}
            >
              ×
            </button>
          </div>
        )}
        <textarea
          aria-label="输入消息"
          value={text}
          rows={expandedView ? 3 : 2}
          maxLength={4_000}
          disabled={busy}
          placeholder={
            pendingAttachment ? '补充你想了解的内容…' : '问问我任何问题…'
          }
          onChange={(event) => setText(event.currentTarget.value)}
          onCompositionStart={() => setIsComposing(true)}
          onCompositionEnd={() => setIsComposing(false)}
          onKeyDown={(event) => {
            if (
              event.key === 'Enter' &&
              !event.shiftKey &&
              !isComposing &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              void submit();
            }
          }}
        />
        <div className="pet-chat__actions">
          <button
            className="attachment-action"
            type="button"
            aria-label={attachmentBusy ? '正在上传附件' : '添加图片或 PDF'}
            title={attachmentBusy ? '正在上传附件' : '添加图片或 PDF'}
            disabled={
              busy || attachmentBusy || !directory.currentConversationId
            }
            onClick={() => void pickAttachment()}
          >
            <AttachmentIcon />
            <span>{attachmentBusy ? '上传中…' : '图片 / PDF'}</span>
          </button>
          <span className="pet-chat__action-spacer" />
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
            onPointerEnter={() => {
              if (lastAssistantMessage)
                prepareSpeech(lastAssistantMessage.id, lastAssistantReply);
            }}
            onPointerLeave={cancelSpeechPreparation}
            onFocus={() => {
              if (lastAssistantMessage)
                prepareSpeech(lastAssistantMessage.id, lastAssistantReply);
            }}
            onBlur={cancelSpeechPreparation}
            onClick={state === 'speaking' ? cancel : () => void speakLatest()}
          >
            <SpeakerIcon />
          </button>
          {busy && state !== 'authorizing' ? (
            <button
              className="send-action is-stop"
              type="button"
              disabled={!canStop}
              onClick={cancel}
            >
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
                aria-label="发送消息"
                title="发送消息"
                disabled={
                  (!text.trim() && !pendingAttachment) ||
                  !directory.currentConversationId
                }
              >
                <SendIcon />
              </button>
            </>
          )}
        </div>
      </div>
    </form>
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
