'use client';

import { submitCanvasAction } from '@/app/learn/actions';
import type { AssetItem } from '@/features/assets/assets-drawer';
import { AssetsDrawer } from '@/features/assets/assets-drawer';
import { CanvasPanel } from '@/features/canvas/canvas-panel';
import { ChatPanel } from '@/features/chat/chat-panel';
import {
  canvasOpenedMessage,
  continueTextMessage,
  gradedMessage,
  initialTeacherMessages,
  nextMessageId,
  replyToStudent,
  type ChatMessage,
  type TeacherMessage,
} from '@/features/chat/demo-teacher-script';
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
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
} from 'react';
import { Sheet } from './sheet';
import { TopBar } from './top-bar';

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

type DrawerKind = 'assets' | 'studio' | 'progress' | null;

/** 桌面协作态对话列的宽度百分比边界；保证对话永远可读、Canvas 永远可用。 */
const CHAT_PCT_DEFAULT = 40;
const CHAT_PCT_MIN = 28;
const CHAT_PCT_MAX = 62;

/**
 * 学习页大脑：持有布局状态机（Chat-only / Chat+Canvas / 抽屉互斥）、可信判分
 * 提交状态（幂等指纹重试，自旧 CanvasProgressWorkspace 迁移）与演示对话流。
 * 布局状态机是纯 UI 状态，与教学脊柱状态机无关；可信判分和掌握度仍全部来自
 * Server Action，见 docs/01-product/student-ui-spec.md。
 */
export function LearnWorkspace({ initialData }: { initialData: LearningPageDTO }) {
  const [progress, setProgress] = useState(initialData.progress);
  const [feedback, setFeedback] = useState<CanvasFeedbackDTO | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const retryableSubmission = useRef<RetryableSubmission | null>(null);

  const [messages, setMessages] = useState<readonly ChatMessage[]>(() =>
    initialTeacherMessages(),
  );
  const [isTyping, setIsTyping] = useState(false);
  const [canvasOpen, setCanvasOpen] = useState(false);
  const [canvasFull, setCanvasFull] = useState(false);
  const [drawer, setDrawer] = useState<DrawerKind>(null);
  const [chatPct, setChatPct] = useState(CHAT_PCT_DEFAULT);
  const [assets, setAssets] = useState<readonly AssetItem[]>([
    {
      id: 'courseware-3',
      label: '课件 · 图像是怎么被认出来的',
      kind: '课程资料',
      enabled: true,
    },
    {
      id: 'courseware-cats',
      label: '猫狗图片集',
      kind: '课程资料',
      enabled: false,
    },
  ]);

  const studentCount = useRef(0);
  const replyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const savedScrollTop = useRef(0);
  const splitRef = useRef<HTMLDivElement>(null);

  useEffect(
    () => () => {
      if (replyTimer.current) clearTimeout(replyTimer.current);
    },
    [],
  );

  /* 新消息或打字指示出现时贴底，学生视线不需要追消息 */
  useEffect(() => {
    const container = chatScrollRef.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, [messages, isTyping]);

  const appendTeacher = useCallback((incoming: TeacherMessage[]) => {
    setIsTyping(true);
    if (replyTimer.current) clearTimeout(replyTimer.current);
    replyTimer.current = setTimeout(() => {
      setIsTyping(false);
      setMessages((current) => [...current, ...incoming]);
    }, 600);
  }, []);

  const openCanvas = useCallback(
    (withTeacherFollowUp: boolean) => {
      if (window.matchMedia('(max-width: 1023px)').matches) {
        savedScrollTop.current = chatScrollRef.current?.scrollTop ?? 0;
      }
      setDrawer(null);
      setCanvasOpen(true);
      if (withTeacherFollowUp) appendTeacher([canvasOpenedMessage()]);
    },
    [appendTeacher],
  );

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
      setMessages((current) => [
        ...current,
        { id: nextMessageId(), role: 'student', text },
      ]);
      const replies = replyToStudent(text, {
        canvasOpen,
        replyCount: studentCount.current,
      });
      studentCount.current += 1;
      appendTeacher(replies);
    },
    [appendTeacher, canvasOpen],
  );

  const handleMenuAction = useCallback(
    (action: PlusMenuActionId) => {
      if (action === 'pick_course_material') {
        setDrawer('assets');
        return;
      }
      if (action === 'create_demo') {
        if (canvasOpen) return;
        appendTeacher([
          {
            id: nextMessageId(),
            role: 'teacher',
            text: '好，我们打开互动演示：把每个特征分给猫或狗。准备好了就开始吧。',
            suggestsCanvas: true,
          },
        ]);
        return;
      }
      /* 其余能力尚未建设：用教学语言告知，不出现技术错误或伪装成功 */
      appendTeacher([
        {
          id: nextMessageId(),
          role: 'teacher',
          text: '这个功能我还在准备中，很快就能用了。现在我们可以先聊聊，或者打开互动演示练一练。',
        },
      ]);
    },
    [appendTeacher, canvasOpen],
  );

  const handleToggleAsset = useCallback((id: string) => {
    setAssets((current) =>
      current.map((asset) =>
        asset.id === id ? { ...asset, enabled: !asset.enabled } : asset,
      ),
    );
  }, []);

  const handleSubmit = useCallback(
    (draft: CanvasSubmissionDraft) => {
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
            appendTeacher([
              gradedMessage(
                result.feedback.correctItems,
                result.feedback.attemptedItems,
              ),
            ]);
            return;
          }
          setErrorMessage(result.message);
        } catch {
          setErrorMessage('提交暂时失败，请检查网络后重试。');
        }
      });
    },
    [appendTeacher],
  );

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
  const splitActive = canvasOpen && !canvasFull;

  return (
    <div className="flex h-dvh flex-col bg-canvas text-ink">
      <TopBar
        courseTitle="人工智能通识 · 图像是怎么被认出来的"
        stageLabel="练习"
        masteryPercent={progress?.masteryPercent ?? null}
        onOpenStudio={() => setDrawer('studio')}
        onOpenProgress={() => setDrawer('progress')}
      />
      <div ref={splitRef} className="flex min-h-0 flex-1">
        <div
          className="flex min-h-0 min-w-0 flex-col"
          style={{
            flexBasis: splitActive ? `${chatPct}%` : '100%',
            flexGrow: splitActive ? 0 : 1,
            flexShrink: 0,
          }}
        >
          <div
            ref={chatScrollRef}
            className="min-h-0 flex-1 overflow-y-auto"
            aria-label="AI教师对话"
            role="region"
          >
            <ChatPanel
              messages={messages}
              isTyping={isTyping}
              canvasOpen={canvasOpen}
              artifactTitle={initialData.artifact.title}
              onOpenCanvas={() => openCanvas(!canvasOpen)}
              onContinueText={() => appendTeacher([continueTextMessage()])}
            />
          </div>
          <Composer
            chips={enabledAssets.map((asset) => ({
              id: asset.id,
              label: asset.label,
            }))}
            busy={isTyping || isPending}
            statusText={
              isPending ? '老师正在批改…' : isTyping ? '老师正在输入…' : null
            }
            onSend={handleSend}
            onRemoveChip={handleToggleAsset}
            onMenuAction={handleMenuAction}
          />
        </div>
        {splitActive ? (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="调整对话与演示的宽度"
            tabIndex={0}
            onPointerDown={handleDividerPointerDown}
            onKeyDown={(event) => {
              if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                event.preventDefault();
                const delta = event.key === 'ArrowLeft' ? -3 : 3;
                setChatPct((current) =>
                  Math.min(CHAT_PCT_MAX, Math.max(CHAT_PCT_MIN, current + delta)),
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
        ) : null}
      </div>
      {drawer === 'assets' ? (
        <Sheet label="本课资料" onClose={() => setDrawer(null)}>
          <AssetsDrawer assets={assets} onToggle={handleToggleAsset} />
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
                status: artifactCompleted ? '已完成' : '已生成',
              },
            ]}
            onOpen={() => {
              setDrawer(null);
              openCanvas(false);
            }}
          />
        </Sheet>
      ) : null}
      {drawer === 'progress' ? (
        <Sheet label="学习进度" onClose={() => setDrawer(null)}>
          <ProgressDrawer progress={progress} />
        </Sheet>
      ) : null}
    </div>
  );
}
