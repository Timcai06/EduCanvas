import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => {
  let stateCursor = 0;
  let refCursor = 0;
  let states: unknown[] = [];
  let refs: Array<{ current: unknown }> = [];
  let effects: Array<() => void | (() => void)> = [];

  return {
    reset() {
      stateCursor = 0;
      refCursor = 0;
      states = [];
      refs = [];
      effects = [];
    },
    beginRender() {
      stateCursor = 0;
      refCursor = 0;
      effects = [];
    },
    useState(initial: unknown) {
      const index = stateCursor++;
      if (!(index in states)) {
        states[index] = typeof initial === 'function' ? initial() : initial;
      }
      return [
        states[index],
        (next: unknown) => {
          states[index] =
            typeof next === 'function'
              ? (next as (value: unknown) => unknown)(states[index])
              : next;
        },
      ];
    },
    useRef(initial: unknown) {
      const index = refCursor++;
      refs[index] ??= { current: initial };
      return refs[index];
    },
    useEffect(effect: () => void | (() => void)) {
      effects.push(effect);
    },
    runEffect() {
      const effect = effects.at(-1);
      if (!effect) throw new Error('expected a captured effect');
      return effect();
    },
    setRef(value: unknown) {
      const ref = refs[0];
      if (!ref) throw new Error('expected a captured ref');
      ref.current = value;
    },
  };
});

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useEffect: hooks.useEffect,
    useRef: hooks.useRef,
    useState: hooks.useState,
  };
});

import {
  LiveVoiceAnswerReader,
  shouldShowLiveAnswerReader,
} from './live-voice-answer-reader';

function findElement(
  node: ReactNode,
  predicate: (element: ReactElement) => boolean,
): ReactElement | null {
  if (!isValidElement(node)) return null;
  if (predicate(node)) return node;
  for (const child of Children.toArray(
    (node.props as { children?: ReactNode }).children,
  )) {
    const match = findElement(child, predicate);
    if (match) return match;
  }
  return null;
}

function renderReader(text = '解释'.repeat(100)) {
  hooks.beginRender();
  return LiveVoiceAnswerReader({ text, streaming: true });
}

type ReaderBodyProps = {
  onScroll: (event: { currentTarget: TestScroller }) => void;
  onWheel: (event: { deltaY: number }) => void;
};

type TestScroller = {
  clientHeight: number;
  scrollHeight: number;
  scrollTop: number;
  scrollTo: ReturnType<typeof vi.fn>;
};

function readerBody(tree: ReactNode) {
  const body = findElement(
    tree,
    (element) =>
      (element.props as { className?: string }).className ===
      'live-voice-answer-reader__body',
  );
  if (!body) throw new Error('expected reader body');
  return body as ReactElement<ReaderBodyProps>;
}

describe('shouldShowLiveAnswerReader', () => {
  it('短口语回答继续留在中央字幕', () => {
    expect(shouldShowLiveAnswerReader('这是一个简短回答。')).toBe(false);
  });

  it('长回答或结构化回答进入阅读面', () => {
    expect(shouldShowLiveAnswerReader('解释'.repeat(100))).toBe(true);
    expect(shouldShowLiveAnswerReader('## 结论\n\n- 第一项\n- 第二项')).toBe(
      true,
    );
  });
});

describe('LiveVoiceAnswerReader scroll following', () => {
  beforeEach(() => hooks.reset());

  it('程序化滚动产生的中间 scroll 事件不会关闭 follow', () => {
    const scroller: TestScroller = {
      clientHeight: 200,
      scrollHeight: 1_000,
      scrollTop: 0,
      scrollTo: vi.fn(),
    };
    let tree = renderReader();
    hooks.setRef(scroller);
    hooks.runEffect();
    expect(scroller.scrollTop).toBe(1_000);

    scroller.scrollTop = 300;
    readerBody(tree).props.onScroll({ currentTarget: scroller });

    tree = renderReader('解释'.repeat(110));
    scroller.scrollHeight = 1_200;
    hooks.runEffect();
    expect(scroller.scrollTop).toBe(1_200);
    expect(
      findElement(tree, (element) => element.type === 'button'),
    ).toBeNull();
  });

  it('用户向上滚动会关闭 follow，后续增量不再抢回底部', () => {
    const scroller: TestScroller = {
      clientHeight: 200,
      scrollHeight: 1_000,
      scrollTop: 0,
      scrollTo: vi.fn(),
    };
    let tree = renderReader();
    hooks.setRef(scroller);
    hooks.runEffect();

    scroller.scrollTop = 500;
    readerBody(tree).props.onWheel({ deltaY: -12 });
    tree = renderReader('解释'.repeat(110));
    scroller.scrollHeight = 1_200;
    hooks.runEffect();

    expect(scroller.scrollTop).toBe(500);
    expect(
      findElement(tree, (element) => element.type === 'button'),
    ).not.toBeNull();
  });
});
