'use client';

import {
  FilePdf,
  Image as ImageIcon,
  LinkSimple,
  SpinnerGap,
  Microphone,
  VideoCamera,
} from '@phosphor-icons/react';
import type { CanvasResource } from '@educanvas/canvas-protocol';
import { EmptyState } from '@/components/ui/empty-state';
import { assetFailureMessage, assetProcessingMessage } from './asset-status';

export interface AssetItem {
  id: string;
  versionId: string | null;
  label: string;
  kind: 'image' | 'document' | 'link' | 'audio' | 'video';
  scope: 'turn' | 'space';
  status: 'pending' | 'processing' | 'ready' | 'failed' | 'tombstoned';
  processing: {
    status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
    attempts: number;
    failureCode: string | null;
    createdAt: string;
    startedAt: string | null;
    completedAt: string | null;
  } | null;
  enabled: boolean;
  selectable: boolean;
  /**
   * 服务端授权后的统一资源描述。为 null 有两种情况：调用的是尚未附加该字段的
   * 旧端点，或该资产的 MIME 没有对应 Renderer。两种情况下 UI 都必须退化为
   * 「只读、无动作」，绝不能自行推断可以删除或下载。
   */
  resource: CanvasResource | null;
}

/**
 * 只展示当前工作区持久化的真实Asset；选择状态决定下一轮消息引用，不改变Asset归属。
 */
export function AssetsDrawer({
  assets,
  onToggle,
}: {
  assets: readonly AssetItem[];
  onToggle: (id: string) => void;
}) {
  return (
    <div className="space-y-5">
      <p id="assets-availability" className="text-sm text-ink-muted">
        这些资料属于当前工作区；勾选决定下一轮使用哪些来源。
        PDF、Word、Markdown和TXT会提取文字；音频和视频会尝试转录为文字；图片能否被直接读取取决于当前所用模型，不支持时发送会明确提示。
      </p>
      {assets.length === 0 ? (
        <EmptyState
          title="还没有资料"
          description="上传图片、文档或网页链接，建立这个笔记本自己的来源集合。"
          icon={<FilePdf size={18} />}
        />
      ) : (
        <ul className="space-y-2">
          {assets.map((asset) => (
            <li key={asset.id}>
              <label
                className={`flex min-h-12 items-center gap-3 rounded-2xl border border-line px-4 py-2.5 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent ${
                  asset.selectable
                    ? 'cursor-pointer hover:bg-surface'
                    : 'cursor-not-allowed opacity-70'
                }`}
              >
                <input
                  type="checkbox"
                  checked={asset.enabled}
                  disabled={!asset.selectable}
                  aria-describedby="assets-availability"
                  onChange={() => onToggle(asset.id)}
                  className="size-4 accent-accent"
                />
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-surface-strong text-ink-muted">
                  {asset.status === 'processing' ||
                  asset.status === 'pending' ? (
                    <SpinnerGap className="animate-spin" size={18} />
                  ) : asset.kind === 'link' ? (
                    <LinkSimple size={18} />
                  ) : asset.kind === 'image' ? (
                    <ImageIcon size={18} />
                  ) : asset.kind === 'audio' ? (
                    <Microphone size={18} />
                  ) : asset.kind === 'video' ? (
                    <VideoCamera size={18} />
                  ) : (
                    <FilePdf size={18} />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink">
                    {asset.label}
                  </span>
                  <span className="block text-xs text-ink-muted">
                    {asset.kind === 'image'
                      ? '图片'
                      : asset.kind === 'link'
                        ? '网页'
                        : asset.kind === 'audio'
                          ? '音频'
                          : asset.kind === 'video'
                            ? '视频'
                            : '文档'}{' '}
                    · {asset.scope === 'space' ? '笔记本来源' : '仅本轮'} ·{' '}
                    {asset.status === 'ready'
                      ? '已就绪'
                      : asset.status === 'failed'
                        ? assetFailureMessage(
                            asset.processing?.failureCode ?? null,
                          )
                        : assetProcessingMessage(
                            asset.processing?.createdAt ?? null,
                          )}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <div className="rounded-2xl bg-surface p-4 text-sm text-ink-muted">
        所有附件都先经过类型、大小、所有权和处理状态校验；浏览器不会接触对象存储地址。
      </div>
    </div>
  );
}
