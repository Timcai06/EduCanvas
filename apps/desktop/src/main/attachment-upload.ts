import type { GatewayAssetSnapshot } from '@educanvas/gateway-core';
import type { GatewayClient } from '@educanvas/gateway-client';
import type {
  DesktopAttachmentPickResult,
  DesktopAttachmentRef,
} from '../shared/desktop-attachment';

/**
 * 桌面上传附件并等待 ready（DP10）。
 *
 * main 进程走系统文件对话框选图（PNG/JPEG/WebP）或 PDF（≤25MB），经 bearer
 * 会话上传到当前 Notebook，再每 500ms 轮询资产状态直到 ready/failed/60s 超时。
 * 上传绑定到 pick 时刻的 notebookId：会话切换后旧附件不得随新会话发出
 * （notebook 归属由服务端 `requireNotebookAccess` 强制，客户端不再重复校验）。
 */

export const MAX_ATTACHMENT_UPLOAD_BYTES = 25 * 1024 * 1024;
export const ATTACHMENT_POLL_INTERVAL_MS = 500;
export const ATTACHMENT_POLL_TIMEOUT_MS = 60_000;

export interface DesktopAttachmentUploadDeps {
  showOpenDialog(): Promise<{ canceled: boolean; filePaths: string[] }>;
  /** 读入文件并构造带原始文件名/类型的 File；类型由服务端 magic bytes 复核。 */
  readFileAsUpload(path: string): Promise<File>;
  uploadAsset(
    client: GatewayClient,
    notebookId: string,
    file: File,
  ): Promise<GatewayAssetSnapshot>;
  getAsset(
    client: GatewayClient,
    assetId: string,
    notebookId: string,
  ): Promise<GatewayAssetSnapshot>;
  sleep(ms: number): Promise<void>;
  now(): number;
}

export function createAttachmentUpload(deps: DesktopAttachmentUploadDeps) {
  return {
    async pickAndUpload(
      client: GatewayClient,
      notebookId: string,
    ): Promise<DesktopAttachmentPickResult> {
      const picked = await deps.showOpenDialog();
      if (picked.canceled || picked.filePaths.length === 0) {
        return { ok: false, message: '已取消选择附件。' };
      }
      const file = await deps.readFileAsUpload(picked.filePaths[0]!);
      if (file.size <= 0 || file.size > MAX_ATTACHMENT_UPLOAD_BYTES) {
        return { ok: false, message: '附件不能为空或超过25MB。' };
      }
      let snapshot: GatewayAssetSnapshot;
      try {
        snapshot = await deps.uploadAsset(client, notebookId, file);
      } catch {
        return { ok: false, message: '上传失败，请检查网络后重试。' };
      }
      const deadline = deps.now() + ATTACHMENT_POLL_TIMEOUT_MS;
      while (true) {
        if (snapshot.descriptor.status === 'ready') {
          const versionId = snapshot.descriptor.currentVersionId;
          if (!versionId) {
            return { ok: false, message: '文件状态异常，请重新选择。' };
          }
          return {
            ok: true,
            attachment: {
              assetId: snapshot.descriptor.assetId,
              versionId,
              kind: snapshot.descriptor.kind,
              mimeType:
                snapshot.version?.mimeType ??
                snapshot.descriptor.mimeType ??
                '',
              displayName: snapshot.descriptor.displayName,
              notebookId,
            },
          };
        }
        if (snapshot.descriptor.status === 'failed') {
          return { ok: false, message: '文件处理失败，暂时无法使用。' };
        }
        if (deps.now() >= deadline) {
          return { ok: false, message: '文件处理超时，请稍后重试。' };
        }
        await deps.sleep(ATTACHMENT_POLL_INTERVAL_MS);
        try {
          snapshot = await deps.getAsset(
            client,
            snapshot.descriptor.assetId,
            notebookId,
          );
        } catch {
          return { ok: false, message: '查询文件状态失败，请稍后重试。' };
        }
      }
    },
  };
}
