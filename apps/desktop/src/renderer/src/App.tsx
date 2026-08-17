import { useEffect, useRef, useState } from 'react';
import { createPetSubmitGate, submitPetText } from './pet-mvp-text';
import {
  petTransientResetDelay,
  petUiStateForAuthTransition,
  petUiStateForFailureCode,
  petUiStateForTurnAction,
  petVisualForState,
  type PetUiState,
} from './pet-visual-state';
import { PET_VISUALS, PetDesktopShell, type PetAppProps } from './pet-view';
import { PetChatPanel } from './pet-chat-panel';
import { recordVoice } from './voice-recorder';
import { playSpeech } from './speech-player';
import { bindVoiceTurn, runVoiceSession } from './voice-session';
import {
  isBusyState,
  latestAssistantReply,
  voiceSnapshotState,
} from './voice-view-state';
import type { DesktopAuthStatus } from '../../shared/desktop-auth';
import type {
  DesktopChatHistorySnapshot,
  DesktopChatSource,
} from '../../shared/chat-history';
import type { DesktopConversationDirectorySnapshot } from '../../shared/conversation-directory';
import { applyAssistantProjection } from './assistant-stream';
import type { DesktopAssistantProjection } from '../../shared/assistant-projection';
import { openDesktopResult } from './result-actions';
import './styles.css';
export default function App({
  initialChatCollapsed = false,
  view = 'pet',
}: PetAppProps = {}) {
  const expandedView = view === 'chat';
  const [text, setText] = useState('');
  const [chatCollapsed, setChatCollapsed] = useState(initialChatCollapsed);
  const [state, setState] = useState<PetUiState>('ready');
  const [visualState, setVisualState] = useState<PetUiState>('greeting');
  const [authState, setAuthState] = useState<
    DesktopAuthStatus['state'] | 'checking'
  >('checking');
  const [message, setMessage] = useState(
    '你好，我在这里。输入一句话和我聊聊吧。',
  );
  const [history, setHistory] = useState<DesktopChatHistorySnapshot>({
    revision: 0,
    conversationId: null,
    messages: [],
    hasMore: false,
    nextCursor: null,
    loading: false,
  });
  const [directory, setDirectory] =
    useState<DesktopConversationDirectorySnapshot>({
      revision: 0,
      loading: false,
      conversations: [],
      currentConversationId: null,
      error: null,
    });
  const [pendingResume, setPendingResume] = useState<string | null>(null);
  const [canStop, setCanStop] = useState(false);
  const requestIdRef = useRef<string | null>(null);
  const historyRef = useRef<DesktopChatHistorySnapshot>(history);
  const operationLeaseRef = useRef<string | null>(null);
  const operationControllerRef = useRef<AbortController | null>(null);
  const submitGateRef = useRef(createPetSubmitGate());
  const authStateRef = useRef<DesktopAuthStatus['state'] | null>(null);
  const historyEndRef = useRef<HTMLDivElement | null>(null);
  const petVisual = petVisualForState(visualState);
  const petAsset = PET_VISUALS[petVisual];
  const lastAssistantReply = latestAssistantReply(history);
  const busy = isBusyState(state);

  const publishVisual = (next: PetUiState): void => {
    setVisualState(next);
    window.desktopPet.setVisual(next);
  };
  const appendHistory = async (
    role: 'user' | 'assistant' | 'system',
    content: string,
    source: DesktopChatSource,
    clientMessageId?: string,
  ): Promise<void> => {
    const next = await window.desktopChat.append({
      role,
      content,
      source,
      clientMessageId,
    });
    setHistory((current) =>
      next.revision >= current.revision ? next : current,
    );
  };
  useEffect(() => {
    const accept = (next: DesktopChatHistorySnapshot): void =>
      setHistory((current) =>
        next.revision >= current.revision ? next : current,
      );
    const unsubscribe = window.desktopChat.onHistory(accept);
    void window.desktopChat.getHistory().then(accept);
    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    const accept = (next: DesktopConversationDirectorySnapshot): void =>
      setDirectory((current) =>
        next.revision >= current.revision ? next : current,
      );
    const unsubscribe = window.desktopConversation.onState(accept);
    void window.desktopConversation.getState().then(accept);
    return unsubscribe;
  }, []);

  useEffect(() => {
    const unsubscribe = window.desktopPet.onVisual((next) => {
      setVisualState(next);
    });
    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    historyRef.current = history;
  }, [history]);

  useEffect(() => {
    const acceptProjection = (projection: DesktopAssistantProjection): void => {
      if (projection.conversationId !== historyRef.current.conversationId)
        return;
      if (projection.type === 'accepted') {
        // Stop 只在服务端接受后可用（DP05）。
        setCanStop(true);
        return;
      }
      if (projection.type === 'tool') {
        setMessage(
          projection.status === 'started'
            ? (projection.summary ?? '正在处理学习任务')
            : 'EduCanvas 正在回复…',
        );
      }
      if (projection.type === 'final') setCanStop(false);
      setHistory((current) => {
        const next = applyAssistantProjection(current, projection);
        return next ?? current;
      });
    };
    const unsubscribe = window.desktopAssistant.onEvent(acceptProjection);
    return unsubscribe;
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
    const accept = (status: DesktopAuthStatus): void => {
      setAuthState(status.state);
      const previousAuthState = authStateRef.current;
      authStateRef.current = status.state;
      if (status.state === 'signed_in') {
        setState('ready');
        const authVisual = petUiStateForAuthTransition(
          previousAuthState,
          status.state,
        );
        if (authVisual) publishVisual(authVisual);
        setMessage('已经连接 EduCanvas，可以开始聊天。');
      } else if (status.state === 'error') {
        setState('auth-failed');
        publishVisual('auth-failed');
        setMessage(status.message);
      }
    };
    const unsubscribe = window.desktopAuth.onStatus(accept);
    void window.desktopAuth.getStatus().then(accept);
    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    const delay = petTransientResetDelay(visualState);
    if (delay === null) return;
    const timeout = setTimeout(() => {
      setVisualState((current) =>
        current === visualState ? 'ready' : current,
      );
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
    setAuthState(auth.state);
    if (auth.state === 'signed_in') return true;
    setState('authorizing');
    publishVisual('authorizing');
    setMessage('请在浏览器完成登录与授权，然后回到这里继续。');
    if (auth.state !== 'authorizing') {
      const next = await window.desktopAuth.signIn();
      setAuthState(next.state);
    }
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
    setPendingResume(null);
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
      if (!directory.currentConversationId) {
        setMessage('请先选择一个对话。');
        return;
      }
      leaseToken = await acquireOperation();
      if (!leaseToken) return;

      const requestId = crypto.randomUUID();
      const clientMessageId = `desktop:${crypto.randomUUID()}`;
      requestIdRef.current = requestId;
      setState('sending');
      publishVisual('sending');
      setCanStop(false);
      setMessage('EduCanvas 正在回复…');
      await appendHistory('user', prompt, 'text', clientMessageId);
      const result = await submitPetText(
        prompt,
        requestId,
        window.desktopAssistant.turn,
        clientMessageId,
      );
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
        if (result.code === 'interrupted') setPendingResume(clientMessageId);
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
    if (!directory.currentConversationId) {
      setMessage('请先选择一个对话。');
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
    const voiceId = `desktop:${crypto.randomUUID()}`;
    let terminalState: PetUiState = 'ready';
    try {
      const result = await runVoiceSession(
        {
          record: recordVoice,
          transcribe: window.desktopVoice.transcribe,
          turn: bindVoiceTurn(window.desktopAssistant.turn, voiceId),
          synthesize: (text, requestId, assistantMessageId) =>
            window.desktopVoice.synthesize(text, requestId, assistantMessageId),
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
            if (snapshot.error) setMessage(snapshot.error);
            else if (snapshot.notice) setMessage(snapshot.notice);
            else if (snapshot.phase === 'listening')
              setMessage('正在听你说话…');
            else if (snapshot.phase === 'transcribing')
              setMessage('正在识别语音…');
            else if (snapshot.phase === 'thinking')
              setMessage('EduCanvas 正在思考…');
            else if (snapshot.phase === 'speaking')
              setMessage(snapshot.reply ?? '正在播报回答…');
          },
        },
      );
      if (result.outcome === 'success') setMessage(result.reply);
      else if (result.outcome === 'cancelled')
        setMessage('已停止。你可以继续输入。');
      else if (result.code === 'interrupted') setPendingResume(voiceId);
    } finally {
      if (operationControllerRef.current === controller)
        operationControllerRef.current = null;
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
      const speech = await window.desktopVoice.synthesize(
        lastAssistantReply,
        requestId,
      );
      requestIdRef.current = null;
      if (!speech.ok) {
        if (speech.code === 'aborted' || controller.signal.aborted) return;
        const failureState =
          speech.code === 'unauthenticated' ? 'auth-failed' : 'backend-failed';
        terminalState = failureState;
        setState(failureState);
        publishVisual(failureState);
        setMessage(speech.message);
        return;
      }
      const playback = await playSpeech(speech.bytes, {
        signal: controller.signal,
      });
      if (playback === 'failed') setMessage('语音播报失败，文字回复仍可查看。');
    } finally {
      if (operationControllerRef.current === controller)
        operationControllerRef.current = null;
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
    setPendingResume(null);
    setCanStop(false);
    setState('ready');
    publishVisual('ready');
    setMessage('已停止。你可以继续输入。');
  };

  const resumePending = async (): Promise<void> => {
    const clientMessageId = pendingResume;
    if (!clientMessageId) return;
    const submitToken = submitGateRef.current.enter();
    if (!submitToken) return;
    let leaseToken: string | null = null;
    try {
      if (!(await requireAuth())) return;
      leaseToken = await acquireOperation();
      if (!leaseToken) return;
      setState('sending');
      publishVisual('sending');
      setCanStop(false);
      setMessage('正在续传…');
      const result = await window.desktopOperation.resume(clientMessageId);
      if (result.ok) {
        setPendingResume(null);
        setState('ready');
        publishVisual('ready');
        setMessage('已恢复回答。');
      } else {
        const failureState = petUiStateForFailureCode(result.code);
        setState(failureState);
        publishVisual(failureState);
        setMessage(result.message);
        if (result.code !== 'interrupted') setPendingResume(null);
      }
    } finally {
      releaseOperation(leaseToken);
      submitGateRef.current.leave(submitToken);
    }
  };

  const chatPanel = (
    <PetChatPanel
      expandedView={expandedView}
      state={state}
      authState={authState}
      message={message}
      history={history}
      historyEndRef={historyEndRef}
      text={text}
      busy={busy}
      canStop={canStop}
      lastAssistantReply={lastAssistantReply}
      setText={setText}
      collapse={() => setChatCollapsed(true)}
      submit={submit}
      signIn={async () => {
        await requireAuth();
      }}
      startVoice={startVoice}
      speakLatest={speakLatest}
      cancel={cancel}
      resume={resumePending}
      canResume={pendingResume !== null}
      directory={directory}
      selectConversation={async (conversationId) => {
        const next = await window.desktopConversation.select(conversationId);
        setDirectory(next);
        setMessage('已切换对话。');
      }}
      createConversation={async (notebookId, title) => {
        const next = await window.desktopConversation.create({
          notebookId,
          title,
        });
        setDirectory(next);
        setMessage(next.error ?? '新对话已创建。');
      }}
      openResult={(target) => openDesktopResult(target).then(setMessage)}
    />
  );

  if (expandedView)
    return <main className="expanded-chat-shell">{chatPanel}</main>;

  return (
    <PetDesktopShell
      chatCollapsed={chatCollapsed}
      chatPanel={chatPanel}
      petVisual={petVisual}
      petAsset={petAsset}
      expandChat={() => setChatCollapsed(false)}
    />
  );
}
