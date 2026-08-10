'use client';

import type {
  StreamingTranscriptionSegmentState,
  StreamingTranscriptionSnapshot,
} from '@educanvas/agent-core';
import { useMemo, useState } from 'react';
import { VoiceComposerRuntime } from './voice-composer';
import type { VoiceBrowserRuntime } from './voice-browser-runtime';

const HEALTHY_CHECKS = [
  { key: 'model' as const, healthy: true },
  { key: 'connection' as const, healthy: true },
];

function segment(
  segmentId: string,
  status: 'active' | 'final',
  text: string,
): StreamingTranscriptionSegmentState {
  return {
    segmentId,
    status,
    text,
    failureCode: null,
    sequence: 0,
    endpointSeen: status === 'final',
    lastEventType: status === 'final' ? 'final' : 'partial',
  };
}

function snapshot(
  segments: readonly StreamingTranscriptionSegmentState[],
): StreamingTranscriptionSnapshot {
  return {
    operationId: 'voice-fixture-operation',
    segments,
    combinedText: segments.map((item) => item.text).join(' '),
  };
}

function createFixtureRuntime(): VoiceBrowserRuntime {
  return {
    createCapture: () => ({
      state: 'idle',
      start: async () => ({ status: 'recording' as const }),
      stop: () => undefined,
      cancel: () => undefined,
      cleanup: () => undefined,
    }),
    createClient: (handlers) => ({
      async start() {
        handlers.onSnapshot(
          snapshot([segment('voice-fixture-segment-1', 'active', '正在识别')]),
        );
      },
      sendChunk: () => undefined,
      finish() {
        handlers.onSnapshot(
          snapshot([
            segment('voice-fixture-segment-1', 'final', '第一句完成'),
            segment('voice-fixture-segment-2', 'final', '第二句完成'),
          ]),
        );
        handlers.onTerminal({ reason: 'final' });
      },
      cancel: () => handlers.onTerminal({ reason: 'cancelled' }),
      disconnect: () => undefined,
    }),
  };
}

/** 仅供受门禁 design-qa route 使用；证明 final 到既有 onSend 的次数语义。 */
export function VoiceComposerFixture() {
  const runtime = useMemo(() => createFixtureRuntime(), []);
  const [submitted, setSubmitted] = useState<readonly string[]>([]);
  return (
    <div className="w-full max-w-3xl">
      <VoiceComposerRuntime
        notebookId="voice-fixture-notebook"
        capabilityChecks={HEALTHY_CHECKS}
        runtime={runtime}
        chips={[]}
        busy={false}
        statusText={null}
        onSend={(text) => setSubmitted((current) => [...current, text])}
        onRemoveChip={() => undefined}
        onMenuAction={() => undefined}
      />
      <dl className="mt-5 rounded-xl border border-line bg-card p-4 text-sm">
        <div className="flex justify-between gap-4">
          <dt>既有 Turn 提交次数</dt>
          <dd data-voice-turn-count>{submitted.length}</dd>
        </div>
        <div className="mt-2 flex justify-between gap-4">
          <dt>最近提交</dt>
          <dd data-voice-last-turn>{submitted.at(-1) ?? '无'}</dd>
        </div>
      </dl>
    </div>
  );
}
