import type { StoredDesktopSession } from './desktop-session-store';
import type {
  DesktopImagePreviewResult,
  DesktopOpenResult,
} from '../shared/result-action';
import { isDesktopResultTarget } from '../shared/result-action';
import { GatewayClient } from '@educanvas/gateway-client';
import type { GatewayImagePreview } from '@educanvas/gateway-client';
import type { GatewayHandoffTarget } from '@educanvas/gateway-core';
import type { DesktopResultTarget } from '../shared/chat-history';
import type { IpcMain } from 'electron';

interface HandoffCredential {
  token: string;
}

/**
 * 把桌面受限资源目标映射为 gateway 一次性凭证目标（DP08）。
 * - artifact → artifact target；
 * - asset/web citation → resource(source) target（resourceId = assetId）；
 * - knowledge → null（conversation 级：知识来源不是 Canvas 资源，切对话即可）。
 */
export function mapDesktopTargetToGatewayTarget(
  target: DesktopResultTarget | null,
): GatewayHandoffTarget | null {
  if (!target) return null;
  if (target.kind === 'artifact')
    return {
      kind: 'artifact',
      artifactId: target.artifactId,
      versionId: target.versionId,
    };
  if (target.kind === 'asset' || target.kind === 'web')
    return {
      kind: 'resource',
      resourceKind: 'source',
      resourceId: target.assetId,
      versionId: target.assetVersionId,
    };
  return null;
}

/**
 * DP07 使用现有 Conversation handoff 打开 Web；DP08 把已校验 target
 * 下沉到一次性凭证，实现 Message/Artifact/Resource 精确定位。
 */
export function createResultOpener(options: {
  getSession(): Promise<StoredDesktopSession | null>;
  currentConversationId(): string | null;
  issueHandoff(
    session: StoredDesktopSession,
    conversationId: string,
    target: GatewayHandoffTarget | null,
  ): Promise<HandoffCredential>;
  readImagePreview(
    session: StoredDesktopSession,
    conversationId: string,
    target: Extract<DesktopResultTarget, { kind: 'asset' }>,
  ): Promise<GatewayImagePreview>;
  openExternal(url: string): Promise<void>;
}) {
  return {
    async open(
      target: DesktopResultTarget | null = null,
    ): Promise<DesktopOpenResult> {
      const session = await options.getSession();
      const conversationId = options.currentConversationId();
      if (!session || !conversationId) {
        return { ok: false, message: '请先登录并选择一个对话。' };
      }
      try {
        const gatewayTarget = mapDesktopTargetToGatewayTarget(target);
        const credential = await options.issueHandoff(
          session,
          conversationId,
          gatewayTarget,
        );
        const url = new URL('/open', session.webBaseUrl);
        url.searchParams.set('token', credential.token);
        await options.openExternal(url.toString());
        return { ok: true };
      } catch {
        return { ok: false, message: '暂时无法打开，请稍后重试。' };
      }
    },
    async preview(
      target: DesktopResultTarget,
    ): Promise<DesktopImagePreviewResult> {
      if (target.kind !== 'asset')
        return { ok: false, message: '此内容没有可用的图片预览。' };
      const session = await options.getSession();
      const conversationId = options.currentConversationId();
      if (!session || !conversationId) {
        return { ok: false, message: '请先登录并选择一个对话。' };
      }
      try {
        const preview = await options.readImagePreview(
          session,
          conversationId,
          target,
        );
        return {
          ok: true,
          dataUrl: `data:${preview.mimeType};base64,${Buffer.from(preview.bytes).toString('base64')}`,
        };
      } catch {
        return { ok: false, message: '图片预览暂时不可用。' };
      }
    },
  };
}

export function registerDesktopResultActions(options: {
  ipcMain: Pick<IpcMain, 'handle'>;
  isDesktopSender(senderId: number): boolean;
  getSession(): Promise<StoredDesktopSession | null>;
  currentConversationId(): string | null;
  openExternal(url: string): Promise<void>;
}): void {
  const opener = createResultOpener({
    ...options,
    issueHandoff: (session, conversationId, target) =>
      new GatewayClient(session.gatewayBaseUrl, session.token).createHandoff(
        conversationId,
        target ?? undefined,
      ),
    readImagePreview: (session, conversationId, target) =>
      new GatewayClient(session.gatewayBaseUrl, session.token).getImagePreview({
        conversationId,
        assetId: target.assetId,
        assetVersionId: target.assetVersionId,
      }),
  });
  options.ipcMain.handle('result:open', async (event, target: unknown) => {
    if (!options.isDesktopSender(event.sender.id))
      throw new Error('Untrusted renderer');
    if (!isDesktopResultTarget(target))
      throw new Error('Invalid result target');
    // DP08 把已校验 target 下沉到一次性凭证以精确定位；无效目标在边界即拒绝。
    return opener.open(target);
  });
  options.ipcMain.handle('result:preview', async (event, target: unknown) => {
    if (!options.isDesktopSender(event.sender.id))
      throw new Error('Untrusted renderer');
    if (!isDesktopResultTarget(target) || target.kind !== 'asset')
      throw new Error('Invalid image preview target');
    return opener.preview(target);
  });
}
