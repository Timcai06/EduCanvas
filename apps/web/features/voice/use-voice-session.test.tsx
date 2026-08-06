import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
// vitest 默认 node 环境（无 window/WebSocket/location）：
// 导入成功即证明模块顶层不读取浏览器全局。
import {
  useVoiceSession,
  type UseVoiceSessionOptions,
} from './use-voice-session';

const healthyChecks = [
  { key: 'model' as const, healthy: true },
  { key: 'connection' as const, healthy: true },
  { key: 'consent' as const, healthy: true },
  { key: 'retention' as const, healthy: true },
  { key: 'deletion-worker' as const, healthy: true },
];

function makeOptions(
  overrides: Partial<UseVoiceSessionOptions> = {},
): UseVoiceSessionOptions {
  return {
    mode: 'short-utterance',
    notebookId: 'nb-1',
    capabilityChecks: healthyChecks,
    createCapture: () => ({
      state: 'idle',
      start: vi.fn().mockResolvedValue({ status: 'recording' }),
      stop: vi.fn(),
      cancel: vi.fn(),
      cleanup: vi.fn(),
    }),
    createClient: () => ({
      start: vi.fn().mockResolvedValue(undefined),
      sendChunk: vi.fn(),
      finish: vi.fn(),
      cancel: vi.fn(),
      disconnect: vi.fn(),
    }),
    onFinalText: vi.fn(),
    ...overrides,
  };
}

function Probe({ options }: { options: UseVoiceSessionOptions }) {
  const session = useVoiceSession(options);
  return (
    <div
      data-status={session.status}
      data-enabled={String(session.capability.enabled)}
      data-reason={session.capability.reason ?? ''}
      data-partial={session.partialText}
      data-error={session.error ?? ''}
    >
      {session.partialText}
    </div>
  );
}

describe('useVoiceSession SSR 安全', () => {
  it('node 环境导入不抛错且初始渲染零副作用（idle、未启动任何浏览器 API）', () => {
    const html = renderToStaticMarkup(<Probe options={makeOptions()} />);
    expect(html).toContain('data-status="idle"');
    expect(html).toContain('data-enabled="true"');
    expect(html).toContain('data-partial=""');
    expect(html).toContain('data-error=""'); // 无错误（空值属性仍在，值为空）
    expect(html).not.toContain('data-error="PERMISSION');
  });

  it('能力不健康时入口禁用并携带稳定原因（可读文案映射可用）', () => {
    const options = makeOptions({
      capabilityChecks: healthyChecks.map((check) =>
        check.key === 'consent' ? { ...check, healthy: false } : check,
      ),
    });
    const html = renderToStaticMarkup(<Probe options={options} />);
    expect(html).toContain('data-enabled="false"');
    expect(html).toContain('data-reason="CONSENT_NOT_GRANTED"');
  });

  it('模型缺失时禁用且 reason 为 MODEL_UNAVAILABLE', () => {
    const options = makeOptions({
      capabilityChecks: healthyChecks.map((check) =>
        check.key === 'model' ? { ...check, healthy: false } : check,
      ),
    });
    const html = renderToStaticMarkup(<Probe options={options} />);
    expect(html).toContain('data-enabled="false"');
    expect(html).toContain('data-reason="MODEL_UNAVAILABLE"');
  });

  it('控制层源码不含浏览器全局读取与直接全局 WebSocket 构造', () => {
    const sources = [
      'voice-session-controller.ts',
      'use-voice-session.ts',
      'voice-capability.ts',
    ]
      .map((name) =>
        readFileSync(new URL(`./${name}`, import.meta.url), 'utf8'),
      )
      .join('\n');
    expect(sources.match(/(?:window|document|location)\s*\./g)).toBeNull();
    expect(sources).not.toContain('new WebSocket(');
  });
});
