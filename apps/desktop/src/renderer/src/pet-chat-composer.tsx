import { useState } from 'react';
import type { DesktopAttachmentRef } from '../../shared/desktop-attachment';
import type { DesktopChatHistorySnapshot } from '../../shared/chat-history';
import type { DesktopConversationDirectorySnapshot } from '../../shared/conversation-directory';
import type { PetUiState } from './pet-visual-state';
import { MicIcon, SpeakerIcon } from './pet-view';

export function AttachmentIcon() {
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

export function PetChatComposer(props: {
  expandedView: boolean;
  state: PetUiState;
  history: DesktopChatHistorySnapshot;
  text: string;
  busy: boolean;
  canStop: boolean;
  lastAssistantReply: string;
  setText(value: string): void;
  submit(): Promise<void>;
  startVoice(): Promise<void>;
  speakLatest(): Promise<void>;
  prepareSpeech(messageId: string, text: string): void;
  cancelSpeechPreparation(): void;
  cancel(): void;
  resume(): Promise<void>;
  canResume: boolean;
  directory: DesktopConversationDirectorySnapshot;
  pendingAttachment: DesktopAttachmentRef | null;
  attachmentBusy: boolean;
  pickAttachment(): Promise<void>;
  clearAttachment(): void;
}) {
  const {
    expandedView,
    state,
    history,
    text,
    busy,
    canStop,
    lastAssistantReply,
    setText,
    submit,
    startVoice,
    speakLatest,
    prepareSpeech,
    cancelSpeechPreparation,
    cancel,
    resume,
    canResume,
    directory,
    pendingAttachment,
    attachmentBusy,
    pickAttachment,
    clearAttachment,
  } = props;
  const [isComposing, setIsComposing] = useState(false);
  const lastAssistantMessage = history.messages.findLast(
    (item) => item.role === 'assistant',
  );

  return (
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
          disabled={busy && state !== 'speaking'}
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
}
