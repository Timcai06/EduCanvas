/**
 * useVoiceSession（V17-B）— VoiceSessionController 的 React 薄壳。
 *
 * ## 职责
 *
 * 把控制器生命周期接进 React：状态订阅、能力闸门、卸载/模式切换清理。
 * 控制器与全部浏览器 API（getUserMedia / WebSocket / ticket 请求）都只在
 * 用户调用 `start()`（点击）之后创建——SSR 顶层安全：hook 初始渲染零副作用，
 * `useEffect` 只负责清理与撤回，SSR 阶段不执行。
 *
 * ## 能力闸门
 *
 * `capabilityChecks` 由完整 V17 注入（服务端配置/同意/健康探测）；任一维度
 * 不健康时 `capability.enabled === false`，`start()` 直接 no-op；能力在会话
 * 运行中被撤销（如监护人撤回同意）时立即 dispose 运行中会话。
 *
 * ## 模式切换
 *
 * `mode` 变化时 dispose 当前会话（停止采集、断开连接、清理引用），下次
 * `start()` 按新模式重建。本 hook 不实现 Composer 接线、不创建 Turn。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  evaluateTranscriptionCapability,
  evaluateVoiceCapability,
  type VoiceCapabilityCheck,
  type VoiceCapabilityState,
} from './voice-capability';
import type { AudioCapture } from './capture/audio-capture';
import {
  VoiceSessionController,
  type VoiceSessionCaptureHandlers,
  type VoiceSessionClientHandlers,
  type VoiceSessionErrorCode,
  type VoiceSessionStatus,
  type VoiceSessionTranscriptionClient,
} from './voice-session-controller';
import { VoiceSessionLifecycle } from './voice-session-lifecycle';

export interface UseVoiceSessionOptions {
  readonly notebookId: string;
  /** 不落盘实时识别的基础设施健康检查（模型/连接）。 */
  readonly capabilityChecks: readonly VoiceCapabilityCheck[];
  /** Live 需要 ASR + TTS；Dictation 只需要 ASR。 */
  readonly capabilityKind?: 'live' | 'transcription';
  /** capture 工厂（点击后调用；浏览器 API 只在那一刻发生）。 */
  readonly createCapture: (
    handlers: VoiceSessionCaptureHandlers,
  ) => AudioCapture;
  /** client 工厂（点击后调用）。 */
  readonly createClient: (
    handlers: VoiceSessionClientHandlers,
  ) => VoiceSessionTranscriptionClient;
  /** Live final 文本（一次）；组合层负责调用现有 Turn。 */
  readonly onFinalText?: (text: string) => void;
}

export interface UseVoiceSessionState {
  readonly status: VoiceSessionStatus;
  readonly partialText: string;
  readonly error: VoiceSessionErrorCode | null;
  readonly inputLevel: number;
  readonly capability: VoiceCapabilityState;
  /** 用户点击：启动会话（能力禁用时 no-op）。 */
  readonly start: () => void;
  /** 结束输入并等待 final。 */
  readonly stop: () => void;
  /** 放弃会话。 */
  readonly cancel: () => void;
}

export function useVoiceSession(
  options: UseVoiceSessionOptions,
): UseVoiceSessionState {
  const [status, setStatus] = useState<VoiceSessionStatus>('idle');
  const [partialText, setPartialText] = useState('');
  const [error, setError] = useState<VoiceSessionErrorCode | null>(null);
  const [inputLevel, setInputLevel] = useState(0);
  // 会话生命周期引用管理（多轮 start / 终态释放 / 卸载清理）。useState
  // 惰性初始化保证实例稳定且不在渲染期触碰 ref。
  const [lifecycle] = useState(() => new VoiceSessionLifecycle());

  const capability = useMemo(
    () =>
      options.capabilityKind === 'transcription'
        ? evaluateTranscriptionCapability(options.capabilityChecks)
        : evaluateVoiceCapability(options.capabilityChecks),
    [options.capabilityChecks, options.capabilityKind],
  );

  // 能力被撤销（含监护人撤回同意）：立即停止运行中会话并释放引用。
  useEffect(() => {
    lifecycle.handleCapability(capability.enabled);
  }, [capability.enabled, lifecycle]);

  // 卸载：停止采集、断开连接、清理引用。
  useEffect(
    () => () => {
      lifecycle.dispose();
    },
    [lifecycle],
  );

  const start = useCallback(() => {
    if (!capability.enabled) return;
    // 新会话不污染上一轮：先清空上一轮的 partial/error 展示状态。
    setError(null);
    setPartialText('');
    const controller = lifecycle.startIfEnabled(
      capability.enabled,
      () =>
        new VoiceSessionController({
          notebookId: options.notebookId,
          createCapture: options.createCapture,
          createClient: options.createClient,
          onPartialText: setPartialText,
          onInputLevel: setInputLevel,
          onFinalText: options.onFinalText,
          onStatusChange: (next) => {
            setStatus(next);
            // 终态（stopped/cancelled/failed）后释放活跃引用，允许同一
            // 组件再次 start 新会话。
            lifecycle.handleStatus(next);
          },
          onError: setError,
        }),
    );
    if (controller === null) return; // 已有活跃会话（未终态）
    // 浏览器 API 从这里开始发生（用户点击之后）。
    void controller.start();
  }, [
    capability.enabled,
    lifecycle,
    options.notebookId,
    options.createCapture,
    options.createClient,
    options.onFinalText,
  ]);

  const stop = useCallback(() => {
    lifecycle.activeController?.stop();
  }, [lifecycle]);

  const cancel = useCallback(() => {
    lifecycle.activeController?.cancel();
  }, [lifecycle]);

  return {
    status,
    partialText,
    error,
    inputLevel,
    capability,
    start,
    stop,
    cancel,
  };
}
