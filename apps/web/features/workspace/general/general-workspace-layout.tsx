'use client';

import { startNewGeneralChatAction } from '@/app/actions';
import { OfflineBanner } from '@/features/chat/offline-banner';
import { StudioOverlay } from '@/features/studio/studio-overlay';
import { StudioWorkspace } from '@/features/studio/studio-workspace';
import type { ReactNode, RefObject } from 'react';
import { ConversationSidebar } from './conversation-sidebar';
import { ConversationPane } from './conversation-pane';
import { WorkspaceSurfaceSlot } from './workspace-surface-slot';
import { GeneralWorkspaceHeader } from './general-workspace-header';
import type { useGeneralWorkspaceController } from './use-general-workspace-controller';
import { DeskRestRail } from './desk-rest-rail';

/**
 * 页面框架（W02）：header + sidebar + main + studio overlay 的纯布局组件。
 *
 * 不发起数据请求，只按 `useGeneralWorkspaceController` 返回的状态与动作渲染：
 * - main 内按 surface 判别联合渲染唯一工作面（对话/分栏槽位/验证中间态）；
 * - studio overlay 在 surface=studio 时打开；
 * - `mainRef` 由组合层创建，供落地 → 对话 Flip 位移的 scope；
 * - `resourceOpenStatus` 由组合层计算传入（landing 全屏层也在组合层渲染，
 *   保持与原 DOM 顺序一致的层叠关系）。
 */
export type GeneralWorkspaceController = ReturnType<
  typeof useGeneralWorkspaceController
>;

/**
 * Studio 打开资源即关闭 overlay：把焦点还给 banner 里的 Studio trigger，
 * 让随后挂载的 Canvas 把它当作 opener。否则焦点掉到 body，Canvas 关闭后
 * 键盘用户会失去操作入口（W06-1）。选择器与 StudioOverlay 归还逻辑一致。
 */
function restoreStudioOpenerFocus(): void {
  document
    .querySelector<HTMLButtonElement>('[aria-controls="notebook-studio-layer"]')
    ?.focus();
}

/**
 * React 必须先提交 Studio overlay 的卸载，背景 trigger 才不再 inert。
 * 下一帧先恢复 opener，再打开资源，让 Canvas 捕获稳定且仍挂载的焦点来源。
 */
function openResourceAfterStudioCloses(openResource: () => void): void {
  window.requestAnimationFrame(() => {
    restoreStudioOpenerFocus();
    openResource();
  });
}

export interface GeneralWorkspaceLayoutProps {
  readonly ctrl: GeneralWorkspaceController;
  readonly notebookTitle: string | null;
  readonly conversationId: string;
  readonly notebookId: string;
  readonly sidebarOpen: boolean;
  readonly onToggleSidebar: () => void;
  readonly mainRef: RefObject<HTMLElement | null>;
  readonly resourceOpenStatus: ReactNode | null;
}

export function GeneralWorkspaceLayout({
  ctrl,
  notebookTitle,
  conversationId,
  notebookId,
  sidebarOpen,
  onToggleSidebar,
  mainRef,
  resourceOpenStatus,
}: GeneralWorkspaceLayoutProps) {
  const { surface } = ctrl;

  return (
    <>
      <GeneralWorkspaceHeader
        notebookTitle={notebookTitle}
        conversationId={conversationId}
        sidebarOpen={sidebarOpen}
        studioOpen={surface.type === 'studio'}
        onToggleSidebar={onToggleSidebar}
        onOpenStudio={() => {
          if (surface.type === 'studio') {
            ctrl.workspace.closeStudio();
            return;
          }
          ctrl.openStudio();
        }}
      />

      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        <ConversationSidebar
          open={sidebarOpen}
          onClose={onToggleSidebar}
          activeConversationId={conversationId}
          onNewNotebook={() => void startNewGeneralChatAction()}
        />
        {/* isolate 堆叠上下文会困住内部 z-40 的 modal，压不过兄弟 header 的 z-20：main 抬到 z-30（同落地态，见组合层全屏 Canvas 注释）。 */}
        <main
          ref={mainRef}
          className="relative isolate z-30 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
        >
          {!ctrl.online ? (
            <div className="relative z-10 shrink-0 pt-1">
              <OfflineBanner />
            </div>
          ) : null}
          {ctrl.isLanding ? (
            <ConversationPane
              {...ctrl.conversationPaneProps}
              notebookId={notebookId}
              isLanding
            />
          ) : (
            <div className="relative z-10 flex min-h-0 flex-1">
              <ConversationPane
                {...ctrl.conversationPaneProps}
                notebookId={notebookId}
                isLanding={false}
              />
              {resourceOpenStatus ? (
                resourceOpenStatus
              ) : (
                <WorkspaceSurfaceSlot
                  {...ctrl.surfaceSlotProps}
                  fullscreen={false}
                />
              )}
            </div>
          )}
        </main>
        <DeskRestRail
          positions={ctrl.surfacePositions}
          onOpen={ctrl.openRestingSurface}
        />
        {surface.type === 'studio' ? (
          <StudioOverlay onClose={() => ctrl.workspace.closeStudio()}>
            <StudioWorkspace
              assets={ctrl.notebookSources}
              outputs={ctrl.studioItems}
              onOpenSource={(asset) => {
                ctrl.workspace.closeStudio();
                ctrl.artifactFlow.closeCanvas();
                openResourceAfterStudioCloses(() =>
                  ctrl.studioOpenActions.actions.openSource(asset.id),
                );
              }}
              onOpenOutput={(artifactId) => {
                ctrl.workspace.closeStudio();
                openResourceAfterStudioCloses(() =>
                  ctrl.studioOpenActions.actions.openArtifact(artifactId),
                );
              }}
              onToggleSource={ctrl.sources.toggle}
              onRenameSource={ctrl.sources.rename}
              onDeleteSource={ctrl.sources.remove}
            />
          </StudioOverlay>
        ) : null}
      </div>
    </>
  );
}
