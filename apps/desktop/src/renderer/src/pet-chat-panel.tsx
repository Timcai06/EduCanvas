import type { RefObject } from 'react';
import type {
  DesktopChatHistorySnapshot,
  DesktopChatMessage,
} from '../../shared/chat-history';
import type { PetUiState } from './pet-visual-state';
import { ExpandIcon, MicIcon, SpeakerIcon } from './pet-view';

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
  } = props;
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
              disabled={!text.trim()}
            >
              发送
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
