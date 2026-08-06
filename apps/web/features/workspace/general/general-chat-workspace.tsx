'use client';

import type { InitialChatMessageDTO } from '@/features/chat/messages';
import { ArtifactConfirmSheet } from '@/features/canvas/artifact-generation-flow';
import { CanvasResourceOpenStatus } from '@/features/canvas/canvas-resource-open-status';
import { motionDuration } from '@/features/theme/motion';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { Flip } from 'gsap/Flip';
import { useRef } from 'react';
import { useSidebarState } from './use-sidebar-state';
import { AgentBusyOverlay } from '../shared/agent-busy-overlay';
import { GeneralAssetEntrySheets } from './general-asset-entry-sheets';
import { GeneralWorkspaceLayout } from './general-workspace-layout';
import { WorkspaceSurfaceSlot } from './workspace-surface-slot';
import { useGeneralWorkspaceController } from './use-general-workspace-controller';
import { GENERAL_ASSET_ENDPOINT } from './general-chat-config';

gsap.registerPlugin(useGSAP, Flip);

/**
 * 组合层（W02）：请求、会话恢复与状态转换收敛在 `useGeneralWorkspaceController`；
 * 页面框架收敛在 `GeneralWorkspaceLayout`；工作面渲染收敛在 `ConversationPane` +
 * `WorkspaceSurfaceSlot`。本组件只负责：
 * - 创建 DOM 引用并注入控制器；
 * - 播放落地 → 对话的输入坞 Flip 位移；
 * - 渲染不属于页面框架的全屏层（Agent 氛围、落地全屏工作面、sheets、无障碍播报）。
 */
export function GeneralChatWorkspace({
  initialMessages,
  conversationId,
  notebookTitle,
  nickname,
}: {
  initialMessages: readonly InitialChatMessageDTO[];
  conversationId: string;
  notebookTitle: string | null;
  nickname?: string | null;
}) {
  const composerDockRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const mainRef = useRef<HTMLElement>(null);
  const ctrl = useGeneralWorkspaceController({
    initialMessages,
    conversationId,
    nickname,
    composerDockRef,
    scrollRef,
    nearBottom,
  });
  const { open: sidebarOpen, toggle: toggleSidebar } = useSidebarState();

  /* 落地 → 对话：输入坞 Flip 位移落到吸底位置；reduced-motion 直接跳变。 */
  useGSAP(
    () => {
      const media = gsap.matchMedia();
      media.add('(prefers-reduced-motion: no-preference)', () => {
        const flipState = ctrl.flipStateRef.current;
        if (flipState && !ctrl.isLanding) {
          ctrl.flipStateRef.current = null;
          Flip.from(flipState, {
            duration: motionDuration('slow'),
            ease: 'power3.inOut',
            scale: false,
          });
        }
      });
      media.add('(prefers-reduced-motion: reduce)', () => {
        ctrl.flipStateRef.current = null;
      });
      return () => media.revert();
    },
    { scope: mainRef, dependencies: [ctrl.isLanding] },
  );

  /* 资源验证中间态：验证成功前/失败时显示打开状态，不属于任一工作面。 */
  const resourceOpenStatus =
    ctrl.studioOpenActions.pendingKind ||
    ctrl.studioOpenActions.validationError ? (
      <CanvasResourceOpenStatus
        pendingKind={ctrl.studioOpenActions.pendingKind}
        error={ctrl.studioOpenActions.validationError}
        onRetry={ctrl.studioOpenActions.retry}
        onClose={ctrl.studioOpenActions.close}
      />
    ) : null;

  return (
    <div className="flex h-dvh flex-col bg-canvas text-ink">
      <GeneralWorkspaceLayout
        ctrl={ctrl}
        notebookTitle={notebookTitle}
        conversationId={conversationId}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={toggleSidebar}
        mainRef={mainRef}
        resourceOpenStatus={resourceOpenStatus}
      />
      {/* Agent 工作态全屏氛围层：老师思考到给出回复期间浮起边缘流光，绑 turn.busy */}
      <AgentBusyOverlay active={ctrl.turn.busy} />
      {ctrl.isLanding ? resourceOpenStatus : null}
      {ctrl.isLanding ? (
        /* 落地态没有分栏槽位,全屏打开。必须在 main(isolate 堆叠上下文)之外,
           否则内部 z-40 压不过兄弟 header 的 z-20;也不能进带 transform 的 hero。 */
        <WorkspaceSurfaceSlot {...ctrl.surfaceSlotProps} fullscreen />
      ) : null}

      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {ctrl.turn.announcement?.text ?? ctrl.sourceNotice?.message ?? ''}
      </p>
      {ctrl.artifactFlow.generation?.phase === 'confirm' ? (
        <ArtifactConfirmSheet
          kind={ctrl.artifactFlow.generation.kind}
          defaultTitle={ctrl.artifactFlow.generation.title}
          sourceCount={ctrl.selectedAudioSources.length}
          onConfirm={(title) => {
            const openWhenReady = ctrl.canvasSelected;
            ctrl.setCanvasSelected(false);
            void ctrl.artifactFlow.confirm(
              ctrl.artifactFlow.generation!.kind,
              title,
              ctrl.selectedAudioSources,
              { openWhenReady },
            );
          }}
          onClose={ctrl.artifactFlow.dismiss}
        />
      ) : null}
      <GeneralAssetEntrySheets
        active={ctrl.assetPanel}
        endpoint={GENERAL_ASSET_ENDPOINT}
        onClose={() => ctrl.setAssetPanel(null)}
        onAdded={(asset) => {
          ctrl.setAssets((current) => [
            { ...asset, enabled: asset.selectable },
            ...current.filter((item) => item.id !== asset.id),
          ]);
          ctrl.setAssetPanel(null);
        }}
      />
    </div>
  );
}
