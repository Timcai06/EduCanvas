import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';
import type { TurnResult } from '../shared/turn-result';

// renderer 侧类型：window.desktopAssistant 由此声明（含此文件的编译单元即全 project 可见）
declare global {
  interface Window {
    desktopAssistant: {
      turn(text: string, signal?: AbortSignal): Promise<TurnResult>;
      onToast(callback: (message: string) => void): () => void;
    };
  }
}

/**
 * contextBridge 暴露给 renderer 的唯一 API。
 * onToast：main 的 webContents.send('assistant:toast') → 回调；返回退订函数。
 */
contextBridge.exposeInMainWorld('desktopAssistant', {
  turn(text: string, signal?: AbortSignal): Promise<TurnResult> {
    // invoke 的最后一个参数支持 AbortSignal：abort 时 main 侧 event.signal 同步中止
    return ipcRenderer.invoke('assistant:turn', { text }, signal);
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
