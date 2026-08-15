import type { ReactElement, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => {
  let cursor = 0;
  let refCursor = 0;
  let states: unknown[] = [];
  let refs: Array<{ current: unknown }> = [];

  return {
    reset() {
      cursor = 0;
      refCursor = 0;
      states = [];
      refs = [];
    },
    beginRender() {
      cursor = 0;
      refCursor = 0;
    },
    useState(initial: unknown) {
      const index = cursor++;
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
      if (!(index in refs)) refs[index] = { current: initial };
      return refs[index];
    },
  };
});

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useEffect: vi.fn(),
    useRef: hooks.useRef,
    useState: hooks.useState,
  };
});

vi.mock('react-dom', () => ({
  createPortal: (children: ReactNode) => children,
}));

vi.mock('./use-live-voice-motion', () => ({ useLiveVoiceMotion: vi.fn() }));
vi.mock('./live-voice-orb', () => ({ LiveVoiceOrb: () => null }));
vi.mock('./live-voice-answer-reader', () => ({
  LiveVoiceAnswerReader: () => null,
  shouldShowLiveAnswerReader: () => false,
}));
vi.mock('./live-voice-resource-preview', () => ({
  LiveVoiceResourcePreview: (props: unknown) => (
    <div data-preview={JSON.stringify(props)} />
  ),
}));
vi.mock('./live-voice-visual-stage', () => ({
  LiveVoiceVisualStage: (props: unknown) => (
    <div data-stage={JSON.stringify(props)} />
  ),
}));

import { LiveVoicePanel } from './live-voice-panel';
import { LiveVoiceResourcePreview } from './live-voice-resource-preview';
import { LiveVoiceVisualStage } from './live-voice-visual-stage';

type ElementWithProps = ReactElement<Record<string, unknown>>;

function findElement(
  node: ReactNode,
  predicate: (element: ElementWithProps) => boolean,
): ElementWithProps | null {
  if (!node || typeof node !== 'object' || !('props' in node)) return null;
  const element = node as ElementWithProps;
  if (predicate(element)) return element;
  const children = element.props.children;
  for (const child of Array.isArray(children) ? children : [children]) {
    const found = findElement(child, predicate);
    if (found) return found;
  }
  return null;
}

function renderPanel(onClose: () => void, onToggleMute: () => void) {
  hooks.beginRender();
  return LiveVoicePanel({
    scopeKey: 'notebook-a',
    phase: 'listening',
    statusLabel: '正在聆听',
    muted: false,
    userSubtitle: null,
    assistantMessageId: null,
    assistantText: null,
    assistantStatus: null,
    assistantSubtitle: null,
    assets: [],
    artifacts: [],
    onClose,
    onToggleMute,
  });
}

function stage(root: ReactNode): ElementWithProps {
  const result = findElement(
    root,
    (element) => element.type === LiveVoiceVisualStage,
  );
  if (!result) throw new Error('expected LiveVoiceVisualStage');
  return result;
}

function preview(root: ReactNode): ElementWithProps {
  const result = findElement(
    root,
    (element) => element.type === LiveVoiceResourcePreview,
  );
  if (!result) throw new Error('expected LiveVoiceResourcePreview');
  return result;
}

describe('Live Voice resource continuity interactions', () => {
  beforeEach(() => {
    hooks.reset();
    vi.restoreAllMocks();
  });

  it.each([
    ['Source', 'onOpenAsset', 'source-a'],
    ['只读 Artifact', 'onOpenArtifact', 'artifact-a'],
  ] as const)(
    '%s 打开和关闭只改变预览，不退出或污染会话控制',
    (_name, action, id) => {
      const onClose = vi.fn();
      const onToggleMute = vi.fn();
      const trigger = { focus: vi.fn() } as unknown as HTMLButtonElement;
      const rafCallbacks: FrameRequestCallback[] = [];
      vi.stubGlobal(
        'requestAnimationFrame',
        (callback: FrameRequestCallback) => {
          rafCallbacks.push(callback);
          return rafCallbacks.length;
        },
      );

      let root = renderPanel(onClose, onToggleMute);
      if (action === 'onOpenAsset') {
        const open = stage(root).props[action] as (
          asset: {
            id: string;
            versionId: string;
            label: string;
            kind: 'image';
            scope: 'space';
            status: 'ready';
            enabled: boolean;
            selectable: boolean;
            previewUrl: string;
          },
          trigger: HTMLButtonElement,
        ) => void;
        open(
          {
            id,
            versionId: 'version-a',
            label: '函数讲义',
            kind: 'image',
            scope: 'space',
            status: 'ready',
            enabled: true,
            selectable: true,
            previewUrl: '/api/v1/chat/assets/source-a/file',
          },
          trigger,
        );
      } else {
        const open = stage(root).props[action] as (
          resourceId: string,
          title: string,
          trigger: HTMLButtonElement,
        ) => void;
        open(id, '函数讲义', trigger);
      }

      root = renderPanel(onClose, onToggleMute);
      const openedPreview = preview(root);
      expect(openedPreview.props.target).toEqual(
        action === 'onOpenAsset'
          ? {
              kind: 'source',
              id,
              title: '函数讲义',
              versionId: 'version-a',
              previewUrl: '/api/v1/chat/assets/source-a/file',
            }
          : { kind: 'artifact', id, title: '函数讲义' },
      );
      expect(onClose).not.toHaveBeenCalled();
      expect(onToggleMute).not.toHaveBeenCalled();

      (openedPreview.props.onClose as () => void)();
      expect(onClose).not.toHaveBeenCalled();
      expect(onToggleMute).not.toHaveBeenCalled();
      expect(rafCallbacks).toHaveLength(1);
      rafCallbacks[0]!(0);
      expect(trigger.focus).toHaveBeenCalledOnce();

      root = renderPanel(onClose, onToggleMute);
      expect(
        findElement(
          root,
          (element) => element.type === LiveVoiceResourcePreview,
        ),
      ).toBeNull();
    },
  );

  it('Escape 有预览时只返回 Live；第二次 Escape 才请求退出会话', () => {
    const onClose = vi.fn();
    const onToggleMute = vi.fn();
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn(() => 1),
    );

    let root = renderPanel(onClose, onToggleMute);
    (
      stage(root).props.onOpenAsset as (
        asset: {
          id: string;
          versionId: string;
          label: string;
          kind: 'image';
          scope: 'space';
          status: 'ready';
          enabled: boolean;
          selectable: boolean;
          previewUrl: string;
        },
        trigger: HTMLButtonElement,
      ) => void
    )(
      {
        id: 'source-a',
        versionId: 'version-a',
        label: '讲义',
        kind: 'image',
        scope: 'space',
        status: 'ready',
        enabled: true,
        selectable: true,
        previewUrl: '/api/v1/chat/assets/source-a/file',
      },
      { focus: vi.fn() } as unknown as HTMLButtonElement,
    );

    root = renderPanel(onClose, onToggleMute);
    const dialog = findElement(root, (element) => element.type === 'dialog');
    if (!dialog) throw new Error('expected Live Voice dialog');
    const preventDefault = vi.fn();
    (dialog.props.onCancel as (event: { preventDefault(): void }) => void)({
      preventDefault,
    });
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
    expect(onToggleMute).not.toHaveBeenCalled();

    root = renderPanel(onClose, onToggleMute);
    const returnedDialog = findElement(
      root,
      (element) => element.type === 'dialog',
    );
    if (!returnedDialog) throw new Error('expected Live Voice dialog');
    (
      returnedDialog.props.onCancel as (event: {
        preventDefault(): void;
      }) => void
    )({ preventDefault: vi.fn() });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
