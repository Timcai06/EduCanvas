import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';
import type { TurnResult } from '../shared/turn-result';
import type { Rect } from '../shared/pet-clamp';
import type { DragPoint } from '../shared/pet-drag';

// renderer 侧类型：window.desktopAssistant / window.desktopPet 由此声明
// （含此文件的编译单元即全 project 可见）
declare global {
  interface Window {
    desktopAssistant: {
      turn(text: string, signal?: AbortSignal): Promise<TurnResult>;
      onToast(callback: (message: string) => void): () => void;
    };
    desktopPet: {
      dragMove(p: DragPoint): Promise<void>;
      moveBy(dx: number, dy: number): Promise<Rect>;
      getBounds(): Promise<Rect>;
    };
  }
}

/**
 * contextBridge 暴露给 renderer 的 API。
 * desktopAssistant：P2/P3 语音 turn 复用 proxy 时仍需要，保留。
 * desktopPet：桌宠窗口动作（拖动/踱步/位置查询）。
 * reduced motion 由 renderer 用 matchMedia('(prefers-reduced-motion: reduce)') 直接读取
 * （electron 43 已移除 nativeTheme.shouldUseReducedMotion，matchMedia 是 Chromium 原生 OS 设置）。
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

contextBridge.exposeInMainWorld('desktopPet', {
  dragMove(p: DragPoint): Promise<void> {
    return ipcRenderer.invoke('pet:drag-move', p);
  },
  moveBy(dx: number, dy: number): Promise<Rect> {
    return ipcRenderer.invoke('pet:move-by', dx, dy);
  },
  getBounds(): Promise<Rect> {
    return ipcRenderer.invoke('pet:get-bounds');
  },
});
