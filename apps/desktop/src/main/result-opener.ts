import type { StoredDesktopSession } from './desktop-session-store';
import type { DesktopOpenResult } from '../shared/result-action';
import { isDesktopResultTarget } from '../shared/result-action';
import { GatewayClient } from '@educanvas/gateway-client';
import type { IpcMain } from 'electron';

interface HandoffCredential {
  token: string;
}

/**
 * DP07 使用现有 Conversation handoff 打开 Web；DP08 再把已校验 target
 * 下沉到一次性凭证，实现 Message/Artifact/Resource 精确定位。
 */
export function createResultOpener(options: {
  getSession(): Promise<StoredDesktopSession | null>;
  currentConversationId(): string | null;
  issueHandoff(
    session: StoredDesktopSession,
    conversationId: string,
  ): Promise<HandoffCredential>;
  openExternal(url: string): Promise<void>;
}) {
  return {
    async open(): Promise<DesktopOpenResult> {
      const session = await options.getSession();
      const conversationId = options.currentConversationId();
      if (!session || !conversationId) {
        return { ok: false, message: '请先登录并选择一个对话。' };
      }
      try {
        const credential = await options.issueHandoff(session, conversationId);
        const url = new URL('/open', session.webBaseUrl);
        url.searchParams.set('token', credential.token);
        await options.openExternal(url.toString());
        return { ok: true };
      } catch {
        return { ok: false, message: '暂时无法打开，请稍后重试。' };
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
    issueHandoff: (session, conversationId) =>
      new GatewayClient(session.gatewayBaseUrl, session.token).createHandoff(
        conversationId,
      ),
  });
  options.ipcMain.handle('result:open', async (event, target: unknown) => {
    if (!options.isDesktopSender(event.sender.id))
      throw new Error('Untrusted renderer');
    if (!isDesktopResultTarget(target))
      throw new Error('Invalid result target');
    // DP07 使用当前 Conversation handoff；DP08 把 target 下沉到凭证以精确定位。
    return opener.open();
  });
}
