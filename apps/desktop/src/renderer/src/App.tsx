import { useEffect, useMemo, useRef, useState } from 'react';
import { createPetSubmitGate, submitPetText } from './pet-mvp-text';
import {
  petTransientResetDelay,
  petUiStateForAuthTransition,
  petUiStateForFailureCode,
  petUiStateForTurnAction,
  petVisualForState,
  type PetUiState,
  type PetVisual,
} from './pet-visual-state';
import { recordVoice } from './voice-recorder';
import { playSpeech } from './speech-player';
import { runVoiceSession, type VoiceSessionSnapshot } from './voice-session';
import idlePetUrl from '../../../assets/pet/idle.png';
import thinkingPetUrl from '../../../assets/pet/thinking.png';
import celebratingPetUrl from '../../../assets/pet/celebrating.png';
import loginFailedPetUrl from '../../../assets/pet/login-failed.png';
import backendOfflinePetUrl from '../../../assets/pet/backend-offline.png';
import confusedPetUrl from '../../../assets/pet/confused.png';
import listeningPetUrl from '../../../assets/pet/listening.png';
import speakingPetUrl from '../../../assets/pet/speaking.png';
import greetingPetUrl from '../../../assets/pet/greeting.png';
import type { DesktopAuthStatus } from '../../shared/desktop-auth';
import type {
  DesktopChatHistorySnapshot,
  DesktopChatMessage,
  DesktopChatSource,
} from '../../shared/chat-history';
import './styles.css';

const PET_VISUALS: Record<PetVisual, { src: string; alt: string }> = {
  idle: { src: idlePetUrl, alt: 'EduCanvas 桌宠' },
  greeting: { src: greetingPetUrl, alt: 'EduCanvas 桌宠正在打招呼' },
  listening: { src: listeningPetUrl, alt: 'EduCanvas 桌宠正在听你说话' },
  thinking: { src: thinkingPetUrl, alt: 'EduCanvas 桌宠正在思考' },
  speaking: { src: speakingPetUrl, alt: 'EduCanvas 桌宠正在播报回答' },
  celebrating: { src: celebratingPetUrl, alt: 'EduCanvas 桌宠正在庆祝' },
  'login-failed': { src: loginFailedPetUrl, alt: 'EduCanvas 桌宠提示登录失败' },
  'backend-offline': { src: backendOfflinePetUrl, alt: 'EduCanvas 桌宠提示服务未连接' },
  confused: { src: confusedPetUrl, alt: 'EduCanvas 桌宠没有理解输入' },
};

function voiceSnapshotState(snapshot: VoiceSessionSnapshot): PetUiState {
  if (snapshot.phase === 'starting' || snapshot.phase === 'listening') return 'listening';
  if (snapshot.phase === 'transcribing' || snapshot.phase === 'thinking') return 'sending';
  if (snapshot.phase === 'speaking') return 'speaking';
  if (snapshot.phase === 'error') {
    if (snapshot.error?.includes('登录')) return 'auth-failed';
    if (snapshot.error?.includes('服务') || snapshot.error?.includes('连接')) return 'backend-failed';
    return 'confused';
  }
  return 'ready';
}

function MicIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M6.5 11a5.5 5.5 0 0 0 11 0M12 16.5V21M9 21h6"/></svg>;
}

function SpeakerIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4Z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11"/></svg>;
}

function ExpandIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/></svg>;
}

export default function App({
  initialChatCollapsed = false,
  view = 'pet',
}: {
  initialChatCollapsed?: boolean;
  view?: 'pet' | 'chat';
} = {}) {
  const expandedView = view === 'chat';
  const [text, setText] = useState('');
  const [chatCollapsed, setChatCollapsed] = useState(initialChatCollapsed);
  const [state, setState] = useState<PetUiState>('ready');
  const [visualState, setVisualState] = useState<PetUiState>('greeting');
  const [message, setMessage] = useState('你好，我在这里。输入一句话和我聊聊吧。');
  const [history, setHistory] = useState<DesktopChatHistorySnapshot>({ revision: 0, messages: [] });
  const requestIdRef = useRef<string | null>(null);
  const operationLeaseRef = useRef<string | null>(null);
  const operationControllerRef = useRef<AbortController | null>(null);
  const submitGateRef = useRef(createPetSubmitGate());
  const authStateRef = useRef<DesktopAuthStatus['state'] | null>(null);
  const historyEndRef = useRef<HTMLDivElement | null>(null);
  const petVisual = petVisualForState(visualState);
  const petAsset = PET_VISUALS[petVisual];
  const lastAssistantReply = useMemo(
    () => [...history.messages].reverse().find(({ role }) => role === 'assistant')?.content ?? '',
    [history.messages],
  );
  const busy = ['authorizing', 'listening', 'sending', 'speaking'].includes(state);

  const publishVisual = (next: PetUiState): void => {
    setVisualState(next);
    window.desktopPet.setVisual(next);
  };
  const appendHistory = async (
    role: 'user' | 'assistant' | 'system',
    content: string,
    source: DesktopChatSource,
  ): Promise<void> => {
    const next = await window.desktopChat.append({ role, content, source });
    setHistory((current) => (next.revision >= current.revision ? next : current));
  };

  useEffect(() => {
    const accept = (next: DesktopChatHistorySnapshot): void =>
      setHistory((current) => (next.revision >= current.revision ? next : current));
    const unsubscribe = window.desktopChat.onHistory(accept);
    void window.desktopChat.getHistory().then(accept);
    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    const unsubscribe = window.desktopPet.onVisual((next) => {
      setVisualState(next);
    });
    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(
    () => () => {
      operationControllerRef.current?.abort();
      const requestId = requestIdRef.current;
      if (requestId) {
        window.desktopAssistant.cancel(requestId);
        window.desktopVoice.cancel(requestId);
      }
      const lease = operationLeaseRef.current;
      if (lease) window.desktopOperation.release(lease);
    },
    [],
  );

  useEffect(() => {
    const unsubscribe = window.desktopAuth.onStatus((status) => {
        const previousAuthState = authStateRef.current;
        authStateRef.current = status.state;
        if (status.state === 'signed_in') {
          setState('ready');
          const authVisual = petUiStateForAuthTransition(previousAuthState, status.state);
          if (authVisual) publishVisual(authVisual);
          setMessage('已经连接 EduCanvas，可以开始聊天。');
        } else if (status.state === 'error') {
          setState('auth-failed');
          publishVisual('auth-failed');
          setMessage(status.message);
        }
      });
    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    const delay = petTransientResetDelay(visualState);
    if (delay === null) return;
    const timeout = setTimeout(() => {
      setVisualState((current) => (current === visualState ? 'ready' : current));
    }, delay);
    return () => clearTimeout(timeout);
  }, [visualState]);

  useEffect(() => {
    if (!expandedView) window.desktopPet.setChatExpanded(!chatCollapsed);
  }, [chatCollapsed, expandedView]);

  useEffect(() => {
    historyEndRef.current?.scrollIntoView({ block: 'end' });
  }, [history.messages.length]);

  const requireAuth = async (): Promise<boolean> => {
    const auth = await window.desktopAuth.getStatus();
    if (auth.state === 'signed_in') return true;
    setState('authorizing');
    publishVisual('authorizing');
    setMessage('请在浏览器完成登录与授权，然后回到这里继续。');
    if (auth.state !== 'authorizing') await window.desktopAuth.signIn();
    return false;
  };

  const acquireOperation = async (): Promise<string | null> => {
    const result = await window.desktopOperation.acquire();
    if (!result.ok) {
      setMessage(result.message);
      return null;
    }
    operationLeaseRef.current = result.token;
    return result.token;
  };

  const releaseOperation = (token: string | null): void => {
    if (!token) return;
    window.desktopOperation.release(token);
    if (operationLeaseRef.current === token) operationLeaseRef.current = null;
  };

  const submit = async (): Promise<void> => {
    const submitToken = submitGateRef.current.enter();
    if (!submitToken) return;
    let leaseToken: string | null = null;
    try {
      const prompt = text.trim();
      if (!prompt) {
        setState('confused');
        publishVisual('confused');
        setMessage('请输入内容。');
        return;
      }
      if (!(await requireAuth())) return;
      leaseToken = await acquireOperation();
      if (!leaseToken) return;

      const requestId = crypto.randomUUID();
      requestIdRef.current = requestId;
      setState('sending');
      publishVisual('sending');
      setMessage('EduCanvas 正在回复…');
      await appendHistory('user', prompt, 'text');
      const result = await submitPetText(prompt, requestId, window.desktopAssistant.turn);
      if (requestIdRef.current !== requestId) return;
      requestIdRef.current = null;
      if (result.ok) {
        setText('');
        setState('ready');
        publishVisual(petUiStateForTurnAction(result.action));
        setMessage(result.reply);
      } else {
        const failureState = petUiStateForFailureCode(result.code);
        setState(failureState);
        publishVisual(failureState);
        setMessage(result.error);
      }
    } finally {
      releaseOperation(leaseToken);
      submitGateRef.current.leave(submitToken);
    }
  };

  const startVoice = async (): Promise<void> => {
    const submitToken = submitGateRef.current.enter();
    if (!submitToken) return;
    if (!(await requireAuth())) {
      submitGateRef.current.leave(submitToken);
      return;
    }
    const leaseToken = await acquireOperation();
    if (!leaseToken) {
      submitGateRef.current.leave(submitToken);
      return;
    }
    const controller = new AbortController();
    operationControllerRef.current = controller;
    let transcriptAdded = false;
    let terminalState: PetUiState = 'ready';
    try {
      const result = await runVoiceSession(
        {
          record: recordVoice,
          transcribe: window.desktopVoice.transcribe,
          turn: (prompt, requestId) =>
            window.desktopAssistant.turn(prompt, requestId, 'voice'),
          synthesize: window.desktopVoice.synthesize,
          play: (bytes, signal) => playSpeech(bytes, { signal }),
          cancelRemote: (requestId) => {
            window.desktopVoice.cancel(requestId);
            window.desktopAssistant.cancel(requestId);
          },
          createRequestId: () => crypto.randomUUID(),
        },
        {
          signal: controller.signal,
          onChange(snapshot) {
            const nextState = voiceSnapshotState(snapshot);
            if (snapshot.phase === 'error') terminalState = nextState;
            setState(nextState);
            publishVisual(nextState);
            if (snapshot.transcript && !transcriptAdded) {
              transcriptAdded = true;
              void appendHistory('user', snapshot.transcript, 'voice');
            }
            if (snapshot.error) setMessage(snapshot.error);
            else if (snapshot.notice) setMessage(snapshot.notice);
            else if (snapshot.phase === 'listening') setMessage('正在听你说话…');
            else if (snapshot.phase === 'transcribing') setMessage('正在识别语音…');
            else if (snapshot.phase === 'thinking') setMessage('EduCanvas 正在思考…');
            else if (snapshot.phase === 'speaking') setMessage(snapshot.reply ?? '正在播报回答…');
          },
        },
      );
      if (result.outcome === 'success') setMessage(result.reply);
      else if (result.outcome === 'cancelled') setMessage('已停止。你可以继续输入。');
    } finally {
      if (operationControllerRef.current === controller) operationControllerRef.current = null;
      setState(terminalState);
      publishVisual(terminalState);
      releaseOperation(leaseToken);
      submitGateRef.current.leave(submitToken);
    }
  };

  const speakLatest = async (): Promise<void> => {
    if (!lastAssistantReply) return;
    const submitToken = submitGateRef.current.enter();
    if (!submitToken) return;
    if (!(await requireAuth())) {
      submitGateRef.current.leave(submitToken);
      return;
    }
    const leaseToken = await acquireOperation();
    if (!leaseToken) {
      submitGateRef.current.leave(submitToken);
      return;
    }
    const controller = new AbortController();
    operationControllerRef.current = controller;
    const requestId = crypto.randomUUID();
    requestIdRef.current = requestId;
    let terminalState: PetUiState = 'ready';
    setState('speaking');
    publishVisual('speaking');
    setMessage(lastAssistantReply);
    try {
      const speech = await window.desktopVoice.synthesize(lastAssistantReply, requestId);
      requestIdRef.current = null;
      if (!speech.ok) {
        if (speech.code === 'aborted' || controller.signal.aborted) return;
        const failureState = speech.code === 'unauthenticated' ? 'auth-failed' : 'backend-failed';
        terminalState = failureState;
        setState(failureState);
        publishVisual(failureState);
        setMessage(speech.message);
        return;
      }
      const playback = await playSpeech(speech.bytes, { signal: controller.signal });
      if (playback === 'failed') setMessage('语音播报失败，文字回复仍可查看。');
    } finally {
      if (operationControllerRef.current === controller) operationControllerRef.current = null;
      setState(terminalState);
      publishVisual(terminalState);
      releaseOperation(leaseToken);
      submitGateRef.current.leave(submitToken);
    }
  };

  const cancel = (): void => {
    operationControllerRef.current?.abort();
    operationControllerRef.current = null;
    const requestId = requestIdRef.current;
    if (requestId) {
      window.desktopAssistant.cancel(requestId);
      window.desktopVoice.cancel(requestId);
    }
    submitGateRef.current.cancel();
    requestIdRef.current = null;
    setState('ready');
    publishVisual('ready');
    setMessage('已停止。你可以继续输入。');
  };

  const historyView = (
    <div className="pet-chat__history" role="log" aria-label="对话历史" aria-live="polite">
      {history.messages.length === 0 ? (
        <p className="pet-chat__empty">还没有对话。</p>
      ) : (
        history.messages.map((item: DesktopChatMessage) => (
          <article className={`chat-message is-${item.role}`} key={item.id}>
            <span>{item.role === 'user' ? '你' : item.role === 'assistant' ? 'EduCanvas' : '提示'}</span>
            <p>{item.content}</p>
          </article>
        ))
      )}
      <div ref={historyEndRef} />
    </div>
  );

  const chatPanel = (
    <section className={`pet-chat${expandedView ? ' is-expanded-window' : ''}`} aria-label="桌宠聊天">
      <header>
        <span className="pet-chat__dot" aria-hidden="true" />
        <div><strong>EduCanvas</strong><span>{state === 'listening' ? '倾听中' : state === 'speaking' ? '播报中' : state === 'sending' ? '思考中' : '桌面助手'}</span></div>
        {!expandedView && <button className="pet-chat__icon" type="button" aria-label="放大对话框" title="在可缩放窗口中打开" onClick={() => window.desktopPet.openChatWindow()}><ExpandIcon /></button>}
        {!expandedView && <button className="pet-chat__collapse" type="button" aria-label="折叠对话框" aria-expanded="true" title="折叠对话框" onClick={() => setChatCollapsed(true)}>‹</button>}
        {!expandedView && <button className="pet-chat__hide" type="button" aria-label="隐藏桌宠" title="隐藏到托盘" onClick={() => window.desktopPet.hide()}>−</button>}
      </header>

      {historyView}

      {(history.messages.length === 0 || state !== 'ready') && (
        <p className="pet-chat__status" role="status">{message}</p>
      )}

      <form className="pet-chat__composer" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <textarea aria-label="输入消息" value={text} rows={expandedView ? 3 : 2} maxLength={4_000} disabled={busy} placeholder="输入一句话…" onChange={(event) => setText(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void submit(); } }} />
        <div className="pet-chat__actions">
          <button className={`voice-action${state === 'listening' ? ' is-active' : ''}`} type="button" aria-label={state === 'listening' ? '停止语音输入' : '开始语音输入'} title={state === 'listening' ? '停止语音输入' : '开始语音输入'} disabled={busy && state !== 'listening'} onClick={state === 'listening' ? cancel : () => void startVoice()}><MicIcon /></button>
          <button className={`voice-action${state === 'speaking' ? ' is-active' : ''}`} type="button" aria-label={state === 'speaking' ? '停止朗读' : '朗读最新回复'} title={state === 'speaking' ? '停止朗读' : '朗读最新回复'} disabled={!lastAssistantReply || (busy && state !== 'speaking')} onClick={state === 'speaking' ? cancel : () => void speakLatest()}><SpeakerIcon /></button>
          {busy && state !== 'authorizing' ? <button className="send-action is-stop" type="button" onClick={cancel}>停止</button> : <button className="send-action" type="submit" disabled={!text.trim()}>发送</button>}
        </div>
      </form>
    </section>
  );

  if (expandedView) return <main className="expanded-chat-shell">{chatPanel}</main>;

  return (
    <main className={`pet-mvp-shell${chatCollapsed ? ' is-chat-collapsed' : ''}`}>
      {!chatCollapsed && chatPanel}
      {chatCollapsed && <div className="pet-chat-slot" aria-hidden="true" />}
      <div className="pet-drag-region" title="按住我拖动">
        <img key={petVisual} src={petAsset.src} alt={petAsset.alt} draggable={false} />
        {chatCollapsed && <button className="pet-chat__expand" type="button" aria-label="展开对话框" aria-expanded="false" title="展开对话框" onClick={() => setChatCollapsed(false)}>›</button>}
        <span>按住拖动</span>
      </div>
    </main>
  );
}
