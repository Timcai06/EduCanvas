import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  cleanups: [] as Array<() => void>,
  hidden: false,
  reduced: false,
  documentListeners: new Map<string, Set<EventListener>>(),
  mediaListeners: new Set<EventListener>(),
  selectorTargets: [] as unknown[],
  timelines: [] as Array<{
    options: Record<string, unknown>;
    fromTo: ReturnType<typeof vi.fn>;
    kill: ReturnType<typeof vi.fn>;
    pause: ReturnType<typeof vi.fn>;
    resume: ReturnType<typeof vi.fn>;
    to: ReturnType<typeof vi.fn>;
  }>,
}));

vi.mock('react', () => ({
  useEffect: (effect: () => void | (() => void)) => {
    const cleanup = effect();
    if (cleanup) harness.cleanups.push(cleanup);
  },
  useRef: <T,>(initial: T) => ({ current: initial }),
  useState: <T,>(initial: T) => [initial, vi.fn()] as const,
}));

vi.mock('@gsap/react', () => ({
  useGSAP: (effect: () => void | (() => void)) => {
    const cleanup = effect();
    if (cleanup) harness.cleanups.push(cleanup);
    return {
      contextSafe: <T extends (...args: never[]) => unknown>(fn: T) => fn,
    };
  },
}));

vi.mock('@/features/theme/motion', () => ({
  motionDuration: () => 0.3,
}));

vi.mock('gsap/MorphSVGPlugin', () => ({ default: {} }));

vi.mock('gsap', () => {
  const timeline = (options: Record<string, unknown> = {}) => {
    const value = {
      options,
      fromTo: vi.fn(),
      kill: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      to: vi.fn(),
    };
    value.fromTo.mockImplementation((target: unknown) => {
      harness.selectorTargets.push(target);
      return value;
    });
    value.to.mockImplementation((target: unknown) => {
      harness.selectorTargets.push(target);
      return value;
    });
    harness.timelines.push(value);
    const onComplete = options.onComplete;
    if (typeof onComplete === 'function') onComplete();
    return value;
  };

  return {
    default: {
      fromTo: vi.fn((target: unknown) => {
        harness.selectorTargets.push(target);
        return { kill: vi.fn() };
      }),
      getProperty: vi.fn(() => 0),
      matchMedia: vi.fn(() => {
        const cleanups: Array<() => void> = [];
        return {
          add: (query: string, effect: () => void | (() => void)) => {
            const matches = query.includes('no-preference')
              ? !harness.reduced
              : harness.reduced;
            if (!matches) return;
            const cleanup = effect();
            if (cleanup) cleanups.push(cleanup);
          },
          revert: vi.fn(() =>
            cleanups.splice(0).forEach((cleanup) => cleanup()),
          ),
        };
      }),
      quickTo: vi.fn(() => vi.fn()),
      registerPlugin: vi.fn(),
      set: vi.fn((target: unknown) => harness.selectorTargets.push(target)),
      timeline,
    },
  };
});

import { useLiveVoiceMotion } from './use-live-voice-motion';

function installBrowserFakes() {
  const fakeDocument = {
    get hidden() {
      return harness.hidden;
    },
    addEventListener: vi.fn((type: string, listener: EventListener) => {
      const listeners = harness.documentListeners.get(type) ?? new Set();
      listeners.add(listener);
      harness.documentListeners.set(type, listeners);
    }),
    removeEventListener: vi.fn((type: string, listener: EventListener) => {
      harness.documentListeners.get(type)?.delete(listener);
    }),
  };
  const fakeWindow = {
    matchMedia: vi.fn(() => ({
      matches: harness.reduced,
      addEventListener: vi.fn((_type: string, listener: EventListener) => {
        harness.mediaListeners.add(listener);
      }),
      removeEventListener: vi.fn((_type: string, listener: EventListener) => {
        harness.mediaListeners.delete(listener);
      }),
    })),
  };
  vi.stubGlobal('document', fakeDocument);
  vi.stubGlobal('window', fakeWindow);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
}

function createRootRef() {
  const morphTarget = {};
  const orbWrap = {
    getBoundingClientRect: () => ({
      height: 300,
      width: 300,
      x: 200,
      y: 100,
    }),
  };
  const reactiveOrb = {};
  const root = {
    querySelector: vi.fn((selector: string) => {
      if (selector === '[data-live-morph]') return morphTarget;
      if (selector === '[data-live-orb-wrap]') return orbWrap;
      if (selector === '[data-live-orb-reactive]') return reactiveOrb;
      return null;
    }),
  };
  return { rootRef: { current: root as unknown as HTMLElement }, root };
}

function dispatchDocumentEvent(type: string) {
  harness.documentListeners
    .get(type)
    ?.forEach((listener) => listener(new Event(type)));
}

describe('useLiveVoiceMotion', () => {
  beforeEach(() => {
    harness.cleanups.splice(0).forEach((cleanup) => cleanup());
    harness.documentListeners.clear();
    harness.mediaListeners.clear();
    harness.selectorTargets.length = 0;
    harness.timelines.length = 0;
    harness.hidden = false;
    harness.reduced = false;
    vi.clearAllMocks();
    installBrowserFakes();
  });

  afterEach(() => {
    harness.cleanups.splice(0).forEach((cleanup) => cleanup());
    vi.unstubAllGlobals();
  });

  it('只创建一条无限 morph 循环且不再触及装饰 selector', () => {
    const { rootRef, root } = createRootRef();

    useLiveVoiceMotion(rootRef, 'speaking', 'assistant-1', 0.5, {
      thresholdPhase: 'voice',
      entryCapture: null,
    });

    expect(
      harness.timelines.filter((timeline) => timeline.options.repeat === -1),
    ).toHaveLength(1);
    expect(root.querySelector).toHaveBeenCalledWith('[data-live-morph]');
    expect(
      harness.selectorTargets.some(
        (target) =>
          typeof target === 'string' &&
          /ring|particle|field|aura-layer/.test(target),
      ),
    ).toBe(false);
  });

  it('隐藏页创建的 morph 循环初始暂停，并随可见性恢复和再暂停', () => {
    harness.hidden = true;
    const { rootRef } = createRootRef();

    useLiveVoiceMotion(rootRef, 'listening', 'user-1', 0, {
      thresholdPhase: 'voice',
      entryCapture: null,
    });

    const loop = harness.timelines.find(
      (timeline) => timeline.options.repeat === -1,
    );
    expect(loop?.options.paused).toBe(true);

    harness.hidden = false;
    dispatchDocumentEvent('visibilitychange');
    expect(loop?.resume).toHaveBeenCalledOnce();

    harness.hidden = true;
    dispatchDocumentEvent('visibilitychange');
    expect(loop?.pause).toHaveBeenCalledOnce();
  });

  it('卸载时移除 motion preference 与可见性监听并清理时间线', () => {
    const { rootRef } = createRootRef();

    useLiveVoiceMotion(rootRef, 'thinking', 'user-2', 0, {
      thresholdPhase: 'voice',
      entryCapture: null,
    });

    expect(harness.mediaListeners.size).toBe(1);
    expect(harness.documentListeners.get('visibilitychange')?.size).toBe(1);
    const timelines = [...harness.timelines];

    harness.cleanups.splice(0).forEach((cleanup) => cleanup());

    expect(harness.mediaListeners.size).toBe(0);
    expect(harness.documentListeners.get('visibilitychange')?.size).toBe(0);
    expect(
      timelines.some((timeline) => timeline.kill.mock.calls.length > 0),
    ).toBe(true);
  });

  it.each([
    ['entering', 'entered'],
    ['exiting', 'exited'],
  ] as const)(
    'reduced-motion 下 %s 门槛即时推进',
    (thresholdPhase, callback) => {
      harness.reduced = true;
      const { rootRef } = createRootRef();
      const onEntered = vi.fn();
      const onExited = vi.fn();

      useLiveVoiceMotion(rootRef, 'idle', 'hint', 0, {
        thresholdPhase,
        entryCapture: null,
        onEntered,
        onExited,
      });

      expect(onEntered).toHaveBeenCalledTimes(callback === 'entered' ? 1 : 0);
      expect(onExited).toHaveBeenCalledTimes(callback === 'exited' ? 1 : 0);
      expect(
        harness.timelines.filter((timeline) => timeline.options.repeat === -1),
      ).toHaveLength(0);
    },
  );

  it('非 reduced-motion 的入场与退场都连接完成回调', () => {
    const entering = createRootRef();
    const onEntered = vi.fn();
    useLiveVoiceMotion(entering.rootRef, 'idle', 'hint-enter', 0, {
      thresholdPhase: 'entering',
      entryCapture: null,
      onEntered,
    });
    expect(onEntered).toHaveBeenCalledOnce();

    const exiting = createRootRef();
    const onExited = vi.fn();
    useLiveVoiceMotion(exiting.rootRef, 'idle', 'hint-exit', 0, {
      thresholdPhase: 'exiting',
      entryCapture: null,
      onExited,
    });
    expect(onExited).toHaveBeenCalledOnce();
  });
});
