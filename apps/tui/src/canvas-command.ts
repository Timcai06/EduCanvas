import type { GatewayConversationEntry } from '@educanvas/gateway-client';
import type { GatewayHandoffCredential } from '@educanvas/gateway-core';
import type { CanvasResource } from '@educanvas/canvas-protocol';
import { openTuiCanvasResource } from './canvas-client';
import {
  createTuiCanvasList,
  renderTuiCanvasList,
  renderTuiCanvasOpen,
} from './canvas-renderer';

export interface TuiCanvasGatewayPort {
  listCanvasResources(notebookId: string): Promise<readonly CanvasResource[]>;
  createHandoff(conversationId: string): Promise<GatewayHandoffCredential>;
}

export class TuiCanvasCommand {
  private resources: readonly CanvasResource[] = [];

  constructor(
    private readonly client: TuiCanvasGatewayPort,
    private readonly webBaseUrl: string,
    private readonly openWeb: (url: string) => void,
    private readonly writeOut: (text: string) => void,
    private readonly writeError: (text: string) => void,
  ) {}

  reset(): void {
    this.resources = [];
  }

  async handle(
    line: string,
    conversation: GatewayConversationEntry,
  ): Promise<boolean> {
    if (line !== '/canvas' && !line.startsWith('/canvas ')) return false;
    try {
      if (this.resources.length === 0) {
        this.resources = await this.client.listCanvasResources(
          conversation.notebookId,
        );
      }
      const target = line.slice('/canvas'.length).trim();
      if (!target) {
        this.writeOut(
          `${renderTuiCanvasList(
            createTuiCanvasList(this.resources, conversation.notebookId),
          )}  /canvas <编号> 打开\n\n`,
        );
        return true;
      }
      if (!/^\d+$/.test(target)) {
        this.writeError('请输入 /canvas <编号>。\n');
        return true;
      }
      const resource = this.resources[Number(target) - 1];
      if (!resource) {
        this.writeError('这个 Canvas 资源不存在或不可用。\n');
        return true;
      }
      const result = await openTuiCanvasResource({
        resource,
        currentNotebookId: conversation.notebookId,
        conversationId: conversation.conversationId,
        webBaseUrl: this.webBaseUrl,
        issueHandoff: (conversationId) =>
          this.client.createHandoff(conversationId),
      });
      if (result.kind === 'web_handoff') this.openWeb(result.url);
      this.writeOut(renderTuiCanvasOpen(result));
      return true;
    } catch {
      this.writeError('Canvas 资源读取失败，请稍后重试。\n');
      return true;
    }
  }
}
