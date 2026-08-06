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

export interface GeneralWorkspaceLayoutProps {
  readonly ctrl: GeneralWorkspaceController;
  readonly notebookTitle: string | null;
  readonly conversationId: string;
  readonly sidebarOpen: boolean;
  readonly onToggleSidebar: () => void;
  readonly mainRef: RefObject<HTMLElement | null>;
  readonly resourceOpenStatus: ReactNode | null;
}

export function GeneralWorkspaceLayout({
  ctrl,
  notebookTitle,
  conversationId,
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
        <main
          ref={mainRef}
          className="relative isolate flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
        >
          {!ctrl.online ? (
            <div className="relative z-10 shrink-0 pt-1">
              <OfflineBanner />
            </div>
          ) : null}
          {ctrl.isLanding ? (
            <ConversationPane {...ctrl.conversationPaneProps} isLanding />
          ) : (
            <div className="relative z-10 flex min-h-0 flex-1">
              <ConversationPane
                {...ctrl.conversationPaneProps}
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
        {surface.type === 'studio' ? (
          <StudioOverlay onClose={() => ctrl.workspace.closeStudio()}>
            <StudioWorkspace
              assets={ctrl.notebookSources}
              outputs={ctrl.studioItems}
              onOpenSource={(asset) => {
                ctrl.workspace.closeStudio();
                ctrl.artifactFlow.closeCanvas();
                ctrl.studioOpenActions.actions.openSource(asset.id);
              }}
              onOpenOutput={(artifactId) => {
                ctrl.workspace.closeStudio();
                ctrl.studioOpenActions.actions.openArtifact(artifactId);
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
