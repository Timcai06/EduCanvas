'use client';

import { submitCanvasAction } from '@/app/learn/actions';
import type { AssetItem } from '@/features/assets/assets-drawer';
import { AssetsDrawer } from '@/features/assets/assets-drawer';
import { loadAssets } from '@/features/assets/asset-client';
import { AssetUploadPanel } from '@/features/assets/asset-upload-panel';
import { CanvasPanel } from '@/features/canvas/canvas-panel';
import { HtmlPreviewPanel } from '@/features/canvas/html-preview-panel';
import { ChatPanel } from '@/features/chat/chat-panel';
import { useTeachingTurn } from '@/features/chat/use-teaching-turn';
import { Composer } from '@/features/composer/composer';
import type { PlusMenuActionId } from '@/features/composer/plus-menu';
import type {
  CanvasFeedbackDTO,
  CanvasSubmissionDraft,
  CanvasSubmissionInput,
  LearningPageDTO,
} from '@/features/learning/learning-contracts';
import { ProgressDrawer } from '@/features/progress/progress-drawer';
import { StudioDrawer } from '@/features/studio/studio-drawer';
import { CANVAS_INTERACTION_SCHEMA_VERSION } from '@educanvas/canvas-protocol';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { Sheet } from '../shared/sheet';
import { EmptyChatHero } from './empty-chat-hero';
import {
  PENDING_FIRST_MENU_ACTION_KEY,
  PENDING_FIRST_PROMPT_KEY,
} from './first-prompt';
import { TopBar } from './top-bar';
import { LearningRail } from './learning-rail';

interface RetryableSubmission {
  fingerprint: string;
  input: CanvasSubmissionInput;
}

function createSubmissionInput(
  draft: CanvasSubmissionDraft,
): CanvasSubmissionInput {
  const eventBase = {
    schemaVersion: CANVAS_INTERACTION_SCHEMA_VERSION,
    eventId: crypto.randomUUID(),
    artifactId: draft.artifactId,
    occurredAt: new Date().toISOString(),
  };

  if (draft.type === 'quiz_answer_submitted') {
    return {
      ...eventBase,
      type: draft.type,
      payload: { ...draft.payload },
    };
  }

  return {
    ...eventBase,
    type: draft.type,
    payload: {
      assignments: draft.payload.assignments.map((assignment) => ({
        ...assignment,
      })),
    },
  };
}

type DrawerKind = 'assets' | 'studio' | 'progress' | 'sessions' | null;

const AI_UNAVAILABLE_MESSAGE = 'AI 老师暂时无法连接，请稍后重试。';

/* K12 页仍基于 lesson_sessions,通用产物入口(思维导图)待 /learn 并入统一界面后开放 */
const LEARN_MENU_ACTIONS: readonly PlusMenuActionId[] = [
  'upload_file',
  'upload_image',
  'create_demo',
];

/** 桌面协作态对话列的宽度百分比边界；保证对话永远可读、Canvas 永远可用。 */
const CHAT_PCT_DEFAULT = 40;
const CHAT_PCT_MIN = 28;
const CHAT_PCT_MAX = 62;

/**
 * K12 垂直学习页的大脑：持有布局状态机（Chat-only / Chat+Canvas / 抽屉互斥）、可信判分
 * 提交状态（幂等指纹重试，自旧 CanvasProgressWorkspace 迁移）与消息展示。
 * 布局状态机是纯 UI 状态，与教学脊柱状态机无关；可信判分和掌握度仍全部来自
 * Server Action，见 docs/01-product/student-ui-spec.md。
 *
 * 该组件不是平台级 PlatformShell。通用 Chat、Space、Studio 与 Agent 切换应在独立
 * Shell 中组合，K12 Progress、课程标题和判分通过 Vertical Agent slot 注入，避免
 * 继续把新模态和新 Agent 状态堆到本组件。
 */
interface LearnWorkspaceProps {
  initialData: LearningPageDTO;
  sessionActions?: {
    onNewSession?: () => void | Promise<void>;
    onResumeSession?: (sessionId: string) => void | Promise<void>;
  };
}

/** A session switch remounts all session-local UI state on the same /learn URL. */
export function LearnWorkspace(props: LearnWorkspaceProps) {
  return (
    <LearnWorkspaceSession
      key={props.initialData.currentSessionId ?? 'no-session'}
      {...props}
    />
  );
}

function LearnWorkspaceSession({
  initialData,
  sessionActions,
}: LearnWorkspaceProps) {
  const [progress, setProgress] = useState(initialData.progress);
  const [feedback, setFeedback] = useState<CanvasFeedbackDTO | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const retryableSubmission = useRef<RetryableSubmission | null>(null);

  const teachingTurn = useTeachingTurn(initialData.initialMessages);
  const sendTeachingTurn = teachingTurn.send;
  const messages = teachingTurn.messages;
  const [chatError, setChatError] = useState<string | null>(null);
  const [canvasOpen, setCanvasOpen] = useState(false);
  const [canvasFull, setCanvasFull] = useState(false);
  const [drawer, setDrawer] = useState<DrawerKind>(null);
  const [chatPct, setChatPct] = useState(CHAT_PCT_DEFAULT);
  const [assets, setAssets] = useState<readonly AssetItem[]>([]);
  const [uploadKind, setUploadKind] = useState<AssetItem['kind'] | null>(null);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewFull, setPreviewFull] = useState(false);

  const pendingPromptConsumed = useRef(false);
  const pendingMenuActionConsumed = useRef(false);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const nearChatBottom = useRef(true);
  const justSentMessage = useRef(false);
  const savedScrollTop = useRef(0);
  const splitRef = useRef<HTMLDivElement>(null);

  /* 只在学生原本位于底部或刚发送时跟随流式内容，不抢走向上阅读的位置。 */
  useEffect(() => {
    const container = chatScrollRef.current;
    if (container && (nearChatBottom.current || justSentMessage.current)) {
      container.scrollTop = container.scrollHeight;
      nearChatBottom.current = true;
    }
    justSentMessage.current = false;
  }, [messages]);

  useEffect(() => {
    let active = true;
    void loadAssets()
      .then((loaded) => {
        if (active) setAssets(loaded);
      })
      .catch((reason: unknown) => {
        if (active) {
          setChatError(
            reason instanceof Error ? reason.message : '暂时无法读取资料。',
          );
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const openCanvas = useCallback(() => {
    if (window.matchMedia('(max-width: 1023px)').matches) {
      savedScrollTop.current = chatScrollRef.current?.scrollTop ?? 0;
    }
    setDrawer(null);
    setChatError(null);
    /* 判分 Canvas 与沙箱预览共用同一个分栏宿主槽位,互斥展开 */
    setPreviewHtml(null);
    setPreviewFull(false);
    setCanvasOpen(true);
  }, []);

  const closeCanvas = useCallback(() => {
    setCanvasOpen(false);
    setCanvasFull(false);
    /* 关闭后恢复打开前的对话滚动位置（移动端全屏遮挡期间不应丢上下文） */
    requestAnimationFrame(() => {
      const container = chatScrollRef.current;
      if (container && savedScrollTop.current > 0) {
        container.scrollTop = savedScrollTop.current;
      }
    });
  }, []);

  const handleSend = useCallback(
    (text: string) => {
      setChatError(null);
      justSentMessage.current = true;
      const parts = assets.flatMap((asset) =>
        asset.enabled && asset.versionId
          ? [
              {
                type: 'asset_ref' as const,
                reference: {
                  assetId: asset.id,
                  versionId: asset.versionId,
                  kind: asset.kind,
                },
                usage: 'attachment' as const,
                label: asset.label,
              },
            ]
          : [],
      );
      void sendTeachingTurn(text, undefined, parts).then((accepted) => {
        if (!accepted) return;
        setAssets((current) =>
          current.map((asset) =>
            asset.scope === 'turn' ? { ...asset, enabled: false } : asset,
          ),
        );
      });
    },
    [assets, sendTeachingTurn],
  );

  useEffect(() => {
    if (pendingPromptConsumed.current) return;
    pendingPromptConsumed.current = true;
    const pendingPrompt = sessionStorage.getItem(PENDING_FIRST_PROMPT_KEY);
    if (!pendingPrompt) return;
    sessionStorage.removeItem(PENDING_FIRST_PROMPT_KEY);
    queueMicrotask(() => handleSend(pendingPrompt));
  }, [handleSend]);

  const handleMenuAction = useCallback(
    (action: PlusMenuActionId) => {
      if (action === 'pick_course_material') {
        setDrawer('assets');
        return;
      }
      if (action === 'upload_file' || action === 'upload_image') {
        setDrawer(null);
        setUploadKind(action === 'upload_image' ? 'image' : 'document');
        return;
      }
      if (action === 'create_demo') {
        if (!canvasOpen) openCanvas();
        return;
      }
      setChatError('这项功能尚未开放。');
    },
    [canvasOpen, openCanvas],
  );

  useEffect(() => {
    if (pendingMenuActionConsumed.current) return;
    pendingMenuActionConsumed.current = true;
    const pendingAction = sessionStorage.getItem(
      PENDING_FIRST_MENU_ACTION_KEY,
    ) as PlusMenuActionId | null;
    if (!pendingAction) return;
    sessionStorage.removeItem(PENDING_FIRST_MENU_ACTION_KEY);
    queueMicrotask(() => handleMenuAction(pendingAction));
  }, [handleMenuAction]);

  const handleToggleAsset = useCallback((id: string) => {
    setAssets((current) =>
      current.map((asset) =>
        asset.id === id && asset.selectable
          ? { ...asset, enabled: !asset.enabled }
          : asset,
      ),
    );
  }, []);

  const handleSubmit = useCallback((draft: CanvasSubmissionDraft) => {
    const fingerprint = JSON.stringify(draft);
    const previous = retryableSubmission.current;
    const input =
      previous?.fingerprint === fingerprint
        ? previous.input
        : createSubmissionInput(draft);

    retryableSubmission.current = { fingerprint, input };
    setErrorMessage(null);

    startTransition(async () => {
      try {
        const result = await submitCanvasAction(input);
        if (result.status === 'success') {
          retryableSubmission.current = null;
          setFeedback(result.feedback);
          setProgress(result.progress);
          return;
        }
        setErrorMessage(result.message);
      } catch {
        setErrorMessage('提交暂时失败，请检查网络后重试。');
      }
    });
  }, []);

  /* 拖拽中缝调整对话/Canvas 比例；键盘用左右方向键微调 */
  const handleDividerPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const container = splitRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const onMove = (moveEvent: PointerEvent) => {
        const pct = ((moveEvent.clientX - rect.left) / rect.width) * 100;
        setChatPct(Math.min(CHAT_PCT_MAX, Math.max(CHAT_PCT_MIN, pct)));
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [],
  );

  const enabledAssets = assets.filter((asset) => asset.enabled);
  const artifactCompleted =
    feedback !== null && feedback.correctItems === feedback.attemptedItems;
  const previewOpen = previewHtml !== null;
  const splitActive =
    (canvasOpen && !canvasFull) || (previewOpen && !previewFull);
  const isLanding = messages.length === 0 && !canvasOpen;

  return (
    <div
      data-learning-workspace
      className="flex h-dvh flex-col bg-canvas text-ink"
    >
      <TopBar
        courseTitle={initialData.study.topic}
        stageLabel={null}
        masteryPercent={progress?.masteryPercent ?? null}
        onOpenStudio={() => setDrawer('studio')}
        onOpenProgress={() => setDrawer('progress')}
        onOpenSessions={() => setDrawer('sessions')}
        quiet={isLanding}
      />
      <div className="flex min-h-0 flex-1">
        <LearningRail
          sessions={initialData.initialSessions}
          currentSessionId={initialData.currentSessionId}
          mobileOpen={drawer === 'sessions'}
          onMobileClose={() => setDrawer(null)}
          onNewSession={
            sessionActions?.onNewSession
              ? () => void sessionActions.onNewSession?.()
              : undefined
          }
          onResumeSession={
            sessionActions?.onResumeSession
              ? (sessionId) => void sessionActions.onResumeSession?.(sessionId)
              : undefined
          }
        />
        <div ref={splitRef} className="flex min-h-0 min-w-0 flex-1">
          <div
            className="flex min-h-0 min-w-0 flex-col"
            style={{
              flexBasis: splitActive ? `${chatPct}%` : '100%',
              flexGrow: splitActive ? 0 : 1,
              flexShrink: 0,
            }}
          >
            {isLanding ? (
              <EmptyChatHero>
                <Composer
                  chips={enabledAssets.map((asset) => ({
                    id: asset.id,
                    label: asset.label,
                  }))}
                  busy={false}
                  statusText={null}
                  onSend={handleSend}
                  onRemoveChip={handleToggleAsset}
                  onMenuAction={handleMenuAction}
                  availableMenuActions={LEARN_MENU_ACTIONS}
                  variant="landing"
                />
              </EmptyChatHero>
            ) : (
              <>
                <div
                  ref={chatScrollRef}
                  className="min-h-0 flex-1 overflow-y-auto"
                  aria-label="AI教师对话"
                  role="region"
                  onScroll={(event) => {
                    const container = event.currentTarget;
                    nearChatBottom.current =
                      container.scrollHeight -
                        container.scrollTop -
                        container.clientHeight <=
                      96;
                  }}
                >
                  <ChatPanel
                    messages={messages}
                    canvasOpen={canvasOpen}
                    artifactTitle={initialData.artifact.title}
                    onOpenCanvas={openCanvas}
                    onContinueText={() => setChatError(AI_UNAVAILABLE_MESSAGE)}
                    onRetry={(messageId) => teachingTurn.retry(messageId)}
                    onPreviewHtml={({ source }) => {
                      setCanvasOpen(false);
                      setCanvasFull(false);
                      setDrawer(null);
                      setPreviewHtml(source);
                    }}
                  />
                </div>
                <Composer
                  chips={enabledAssets.map((asset) => ({
                    id: asset.id,
                    label: asset.label,
                  }))}
                  busy={teachingTurn.busy || isPending}
                  statusText={
                    teachingTurn.statusText ??
                    (isPending ? '老师正在批改…' : chatError)
                  }
                  statusTone={
                    chatError && !teachingTurn.busy && !isPending
                      ? 'error'
                      : 'info'
                  }
                  onSend={handleSend}
                  onRemoveChip={handleToggleAsset}
                  onMenuAction={handleMenuAction}
                  availableMenuActions={LEARN_MENU_ACTIONS}
                  stopAvailable={teachingTurn.stopAvailable}
                  onStop={() => void teachingTurn.stop()}
                />
              </>
            )}
          </div>
          {splitActive ? (
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="调整对话与演示的宽度"
              aria-valuemin={CHAT_PCT_MIN}
              aria-valuemax={CHAT_PCT_MAX}
              aria-valuenow={Math.round(chatPct)}
              aria-valuetext={`对话区域占 ${Math.round(chatPct)}%`}
              tabIndex={0}
              onPointerDown={handleDividerPointerDown}
              onKeyDown={(event) => {
                if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                  event.preventDefault();
                  const delta = event.key === 'ArrowLeft' ? -3 : 3;
                  setChatPct((current) =>
                    Math.min(
                      CHAT_PCT_MAX,
                      Math.max(CHAT_PCT_MIN, current + delta),
                    ),
                  );
                }
              }}
              className="hidden w-1.5 shrink-0 cursor-col-resize rounded-full transition-colors hover:bg-accent/25 focus-visible:bg-accent/40 focus-visible:outline-none lg:block"
            />
          ) : null}
          {canvasOpen ? (
            <CanvasPanel
              artifact={initialData.artifact}
              feedback={feedback}
              errorMessage={errorMessage}
              isPending={isPending}
              isFull={canvasFull}
              onSubmit={handleSubmit}
              onCollapse={closeCanvas}
              onToggleFull={() => setCanvasFull((value) => !value)}
            />
          ) : previewHtml !== null ? (
            <HtmlPreviewPanel
              source={previewHtml}
              isFull={previewFull}
              onToggleFull={() => setPreviewFull((value) => !value)}
              onClose={() => {
                setPreviewHtml(null);
                setPreviewFull(false);
              }}
            />
          ) : null}
        </div>
      </div>
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {teachingTurn.announcement ? (
          <span key={teachingTurn.announcement.id}>
            {teachingTurn.announcement.text}
          </span>
        ) : null}
      </p>
      {drawer === 'assets' ? (
        <Sheet label="知识与媒体资产" onClose={() => setDrawer(null)}>
          <AssetsDrawer assets={assets} onToggle={handleToggleAsset} />
        </Sheet>
      ) : null}
      {uploadKind ? (
        <Sheet
          label={uploadKind === 'image' ? '添加图片' : '添加PDF'}
          onClose={() => setUploadKind(null)}
        >
          <AssetUploadPanel
            kind={uploadKind}
            onUploaded={(asset) => {
              setAssets((current) => [
                { ...asset, enabled: asset.selectable },
                ...current.filter((item) => item.id !== asset.id),
              ]);
              setUploadKind(null);
            }}
          />
        </Sheet>
      ) : null}
      {drawer === 'studio' ? (
        <Sheet label="本课产物" onClose={() => setDrawer(null)}>
          <StudioDrawer
            outputs={[
              {
                id: initialData.artifact.artifactId,
                title: initialData.artifact.title,
                kind: '互动分类',
                status: artifactCompleted ? '已完成' : '本课预置',
              },
            ]}
            onOpen={() => {
              setDrawer(null);
              openCanvas();
            }}
          />
        </Sheet>
      ) : null}
      {drawer === 'progress' ? (
        <Sheet label="学习进度" onClose={() => setDrawer(null)}>
          <ProgressDrawer progress={progress} study={initialData.study} />
        </Sheet>
      ) : null}
    </div>
  );
}
