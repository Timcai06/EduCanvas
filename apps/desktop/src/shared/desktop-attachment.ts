/**
 * 桌面附件（DP10）：renderer 与 main 共享的受限投影。
 *
 * 附件来自 main 进程系统文件对话框 → gateway 上传 → ready-wait，随后随
 * `assistant:turn` 以 `asset_ref` part 发出。notebookId 绑定 pick 时刻的
 * 会话，切换 notebook 后 renderer 必须清空 pending attachment。
 */
export interface DesktopAttachmentRef {
  assetId: string;
  /** ready 后的当前版本；服务端归属校验保证该版本在当前 notebook 内。 */
  versionId: string;
  /** `image` | `document` 等 asset kind，用于构造 `asset_ref.reference.kind`。 */
  kind: string;
  mimeType: string;
  displayName: string;
  notebookId: string;
}

export type DesktopAttachmentPickResult =
  | { ok: true; attachment: DesktopAttachmentRef }
  | { ok: false; message: string };
