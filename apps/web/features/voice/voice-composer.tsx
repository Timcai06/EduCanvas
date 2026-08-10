'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ComponentProps,
} from 'react';
import {
  Composer,
  type ComposerVoiceControl,
} from '@/features/composer/composer';
import { useVoiceCapabilityQuery } from './voice-capability-client';
import {
  voiceCapabilityReasonLabel,
  type VoiceCapabilityCheck,
} from './voice-capability';
import {
  createVoiceBrowserRuntime,
  type VoiceBrowserRuntime,
} from './voice-browser-runtime';
import { useVoiceSession } from './use-voice-session';
import type {
  VoiceSessionErrorCode,
  VoiceSessionMode,
} from './voice-session-controller';

type BaseComposerProps = Omit<ComponentProps<typeof Composer>, 'voice'>;

export interface VoiceComposerRuntimeProps extends BaseComposerProps {
  readonly notebookId: string;
  readonly capabilityChecks: readonly VoiceCapabilityCheck[];
  readonly runtime: VoiceBrowserRuntime;
  readonly capabilityLoading?: boolean;
}

const ERROR_LABELS: Readonly<Record<VoiceSessionErrorCode, string>> = {
  PERMISSION_DENIED: '没有麦克风权限，请在浏览器设置中允许后重试',
  NO_AUDIO_INPUT: '没有找到可用的麦克风',
  AUDIO_CONTEXT_FAILED: '浏览器暂时无法启动音频输入',
  CAPTURE_FAILED: '语音采集失败，请重试',
  CONSUMER_FAILED: '语音数据处理失败，请重试',
  INVALID_STATE: '语音会话状态异常，请重新开始',
  INVALID_OPTIONS: '语音采集配置无效',
  TICKET_FAILED: '语音授权失败，请重新登录后重试',
  CONNECTION_FAILED: '实时语音连接失败，请检查网络',
  PROTOCOL_ERROR: '语音服务返回了无法识别的数据',
  ABORTED: '语音会话已中断',
  MODEL_FAILED: '语音识别暂时失败，请重试',
  UNKNOWN: '语音暂时不可用，请稍后重试',
};

/** 可注入 runtime 的完整 V17 组合；生产与 fixture E2E 共用同一 UI/路由逻辑。 */
export function VoiceComposerRuntime({
  notebookId,
  capabilityChecks,
  runtime,
  capabilityLoading = false,
  ...composerProps
}: VoiceComposerRuntimeProps) {
  const [mode, setMode] = useState<VoiceSessionMode>('short-utterance');
  const [captions, setCaptions] = useState<readonly string[]>([]);
  const onSend = composerProps.onSend;
  const busy = composerProps.busy;
  const handleFinalText = useCallback(
    (text: string) => {
      const normalized = text.trim();
      if (normalized) onSend(normalized);
    },
    [onSend],
  );
  const handleCaptionAppend = useCallback((text: string) => {
    const normalized = text.trim();
    if (!normalized) return;
    setCaptions((current) => [...current, normalized]);
  }, []);
  const session = useVoiceSession({
    mode,
    notebookId,
    capabilityChecks,
    createCapture: runtime.createCapture,
    createClient: runtime.createClient,
    onFinalText: handleFinalText,
    onCaptionAppend: handleCaptionAppend,
  });
  const cancelSession = session.cancel;
  useEffect(() => {
    if (busy) cancelSession();
  }, [busy, cancelSession]);

  const reason = capabilityLoading
    ? '正在检查语音能力…'
    : session.error
      ? ERROR_LABELS[session.error]
      : session.capability.reason
        ? voiceCapabilityReasonLabel(session.capability.reason)
        : null;
  const voice: ComposerVoiceControl = {
    enabled: session.capability.enabled && !busy,
    mode,
    status: session.status,
    partialText: session.partialText,
    captions,
    reason,
    onModeChange: setMode,
    onStart: session.start,
    onStop: session.stop,
    onCancel: session.cancel,
  };
  return <Composer {...composerProps} voice={voice} />;
}

/** 生产组合：服务端能力查询 + 浏览器惰性 runtime。 */
export function VoiceComposer(
  props: BaseComposerProps & { readonly notebookId: string },
) {
  const capability = useVoiceCapabilityQuery();
  const runtime = useMemo(
    () => createVoiceBrowserRuntime(capability.websocketUrl),
    [capability.websocketUrl],
  );
  return (
    <VoiceComposerRuntime
      {...props}
      capabilityChecks={capability.checks}
      capabilityLoading={capability.loading}
      runtime={runtime}
    />
  );
}
