import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';
import type { TurnResult } from '../shared/turn-result';
import type {
  VoiceAudioInput,
  VoiceSpeechResult,
  VoiceTranscriptionResult,
} from '../shared/voice-result';
import type { DesktopAuthStatus } from '../shared/desktop-auth';
import type {
  DesktopChatHistorySnapshot,
  DesktopChatMessageInput,
} from '../shared/chat-history';
import type { PetVisualSignal } from '../shared/pet-visual-signal';

export type DesktopOperationLeaseResult =
  | { ok: true; token: string }
  | { ok: false; message: string };

let activeOperationLeaseToken: string | null = null;

// renderer 侧类型：window.desktopAssistant / window.desktopPet 由此声明
// （含此文件的编译单元即全 project 可见）
declare global {
  interface Window {
    desktopAuth: {
      getStatus(): Promise<DesktopAuthStatus>;
      signIn(): Promise<DesktopAuthStatus>;
      signOut(): Promise<DesktopAuthStatus>;
      onStatus(callback: (status: DesktopAuthStatus) => void): () => void;
    };
    desktopAssistant: {
      turn(
        text: string,
        requestId: string,
        source?: 'text' | 'voice',
      ): Promise<TurnResult>;
      cancel(requestId: string): void;
      onToast(callback: (message: string) => void): () => void;
    };
    desktopPet: {
      hide(): void;
      setChatExpanded(expanded: boolean): void;
      openChatWindow(): void;
      setVisual(state: PetVisualSignal): void;
      onVisual(callback: (state: PetVisualSignal) => void): () => void;
    };
    desktopChat: {
      getHistory(): Promise<DesktopChatHistorySnapshot>;
      append(input: DesktopChatMessageInput): Promise<DesktopChatHistorySnapshot>;
      onHistory(callback: (snapshot: DesktopChatHistorySnapshot) => void): () => void;
    };
    desktopOperation: {
      acquire(): Promise<DesktopOperationLeaseResult>;
      release(token: string): void;
    };
    desktopVoice: {
      transcribe(
        input: VoiceAudioInput,
        requestId: string,
      ): Promise<VoiceTranscriptionResult>;
      synthesize(text: string, requestId: string): Promise<VoiceSpeechResult>;
      cancel(requestId: string): void;
    };
  }
}

contextBridge.exposeInMainWorld('desktopAuth', {
  getStatus(): Promise<DesktopAuthStatus> {
    return ipcRenderer.invoke('auth:get-status');
  },
  signIn(): Promise<DesktopAuthStatus> {
    return ipcRenderer.invoke('auth:sign-in');
  },
  signOut(): Promise<DesktopAuthStatus> {
    return ipcRenderer.invoke('auth:sign-out');
  },
  onStatus(callback: (status: DesktopAuthStatus) => void): () => void {
    const listener = (_event: IpcRendererEvent, status: DesktopAuthStatus) =>
      callback(status);
    ipcRenderer.on('auth:status', listener);
    return () => ipcRenderer.removeListener('auth:status', listener);
  },
});

/**
 * contextBridge 暴露给 renderer 的 API。
 * desktopAssistant：P2/P3 语音 turn 复用 proxy 时仍需要，保留。
 * desktopPet：拖动由 Electron 原生 app-region 负责；此处只保留窗口生命周期控制。
 */
contextBridge.exposeInMainWorld('desktopAssistant', {
  turn(
    text: string,
    requestId: string,
    source: 'text' | 'voice' = 'text',
  ): Promise<TurnResult> {
    return ipcRenderer.invoke('assistant:turn', {
      text,
      requestId,
      source,
      leaseToken: activeOperationLeaseToken,
    });
  },
  cancel(requestId: string): void {
    ipcRenderer.send('operation:cancel', requestId);
  },
  onToast(callback: (message: string) => void): () => void {
    const listener = (_event: IpcRendererEvent, message: string): void =>
      callback(message);
    ipcRenderer.on('assistant:toast', listener);
    return () => {
      ipcRenderer.removeListener('assistant:toast', listener);
    };
  },
});

contextBridge.exposeInMainWorld('desktopPet', {
  hide(): void {
    ipcRenderer.send('pet:hide');
  },
  setChatExpanded(expanded: boolean): void {
    ipcRenderer.send('pet:set-chat-expanded', expanded);
  },
  openChatWindow(): void {
    ipcRenderer.send('chat:open-window');
  },
  setVisual(state: PetVisualSignal): void {
    ipcRenderer.send('pet:set-visual', state);
  },
  onVisual(callback: (state: PetVisualSignal) => void): () => void {
    const listener = (_event: IpcRendererEvent, state: PetVisualSignal): void => callback(state);
    ipcRenderer.on('pet:visual', listener);
    return () => ipcRenderer.removeListener('pet:visual', listener);
  },
});

contextBridge.exposeInMainWorld('desktopChat', {
  getHistory(): Promise<DesktopChatHistorySnapshot> {
    return ipcRenderer.invoke('chat:get-history');
  },
  append(input: DesktopChatMessageInput): Promise<DesktopChatHistorySnapshot> {
    return ipcRenderer.invoke('chat:append', input);
  },
  onHistory(callback: (snapshot: DesktopChatHistorySnapshot) => void): () => void {
    const listener = (_event: IpcRendererEvent, snapshot: DesktopChatHistorySnapshot): void =>
      callback(snapshot);
    ipcRenderer.on('chat:history', listener);
    return () => ipcRenderer.removeListener('chat:history', listener);
  },
});

contextBridge.exposeInMainWorld('desktopOperation', {
  async acquire(): Promise<DesktopOperationLeaseResult> {
    const result = await ipcRenderer.invoke('operation:acquire') as DesktopOperationLeaseResult;
    if (result.ok) activeOperationLeaseToken = result.token;
    return result;
  },
  release(token: string): void {
    if (activeOperationLeaseToken === token) activeOperationLeaseToken = null;
    ipcRenderer.send('operation:release', token);
  },
});

contextBridge.exposeInMainWorld('desktopVoice', {
  transcribe(
    input: VoiceAudioInput,
    requestId: string,
  ): Promise<VoiceTranscriptionResult> {
    return ipcRenderer.invoke('voice:transcribe', {
      input,
      requestId,
      leaseToken: activeOperationLeaseToken,
    });
  },
  synthesize(text: string, requestId: string): Promise<VoiceSpeechResult> {
    return ipcRenderer.invoke('voice:synthesize', {
      text,
      requestId,
      leaseToken: activeOperationLeaseToken,
    });
  },
  cancel(requestId: string): void {
    ipcRenderer.send('operation:cancel', requestId);
  },
});
