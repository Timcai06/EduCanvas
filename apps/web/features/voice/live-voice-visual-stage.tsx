'use client';

import {
  FileArrowUp,
  FilePdf,
  FileText,
  Image as ImageIcon,
  LinkSimple,
  MagicWand,
  SpinnerGap,
  VideoCamera,
  Waveform,
} from '@phosphor-icons/react';
import { useRef, useState, type WheelEvent } from 'react';
import {
  MAX_LIVE_CONTEXT_ASSETS,
  liveVoiceAssetStatusLabel,
  type LiveVoiceArtifactItem,
  type LiveVoiceCitationItem,
  type LiveVoiceContextAsset,
  type LiveVoiceToolItem,
} from './live-voice-context';
import { LiveVoiceImagePreview } from './live-voice-image-preview';

function resolveLiveToolStatusLabel(
  status: LiveVoiceToolItem['status'],
): string {
  if (status === 'running') return '执行中';
  if (status === 'failed') return '失败';
  return '已完成';
}

function resolveLiveArtifactStatusLabel(
  status: LiveVoiceArtifactItem['status'],
): string {
  if (status === 'generating' || status === 'proposed') return '生成中';
  if (status === 'failed') return '生成失败';
  if (status === 'cancelled') return '已取消';
  if (status === 'archived') return '已归档';
  return '已生成';
}

export interface LiveVoiceVisualStageProps {
  readonly assets: readonly LiveVoiceContextAsset[];
  readonly artifacts: readonly LiveVoiceArtifactItem[];
  readonly citations: readonly LiveVoiceCitationItem[];
  readonly tools: readonly LiveVoiceToolItem[];
  readonly onToggleAsset?: (assetId: string) => void;
  readonly onUploadAsset?: (
    file: File,
    kind: 'image' | 'document',
  ) => Promise<void>;
  readonly onOpenAsset?: (
    asset: LiveVoiceContextAsset,
    trigger: HTMLButtonElement,
  ) => void;
  readonly onOpenArtifact?: (
    artifactId: string,
    title: string,
    trigger: HTMLButtonElement,
  ) => void;
}

function AssetKindIcon({
  kind,
  label,
  size = 17,
}: {
  kind: LiveVoiceContextAsset['kind'];
  label?: string;
  size?: number;
}) {
  if (kind === 'image') return <ImageIcon size={size} />;
  if (kind === 'link') return <LinkSimple size={size} />;
  if (kind === 'audio') return <Waveform size={size} />;
  if (kind === 'video') return <VideoCamera size={size} />;
  return label?.toLowerCase().endsWith('.pdf') ? (
    <FilePdf size={size} />
  ) : (
    <FileText size={size} />
  );
}

/** 鼠标纵向滚轮在资料带仍可横移；到达两端后把滚动交还给外层卡片。 */
export function scrollLiveVoiceContextRail(
  event: Pick<
    WheelEvent<HTMLDivElement>,
    'currentTarget' | 'deltaX' | 'deltaY' | 'preventDefault'
  >,
): void {
  const rail = event.currentTarget;
  if (
    rail.scrollWidth <= rail.clientWidth ||
    Math.abs(event.deltaY) <= Math.abs(event.deltaX)
  ) {
    return;
  }
  const next = Math.max(
    0,
    Math.min(
      rail.scrollWidth - rail.clientWidth,
      rail.scrollLeft + event.deltaY,
    ),
  );
  if (next === rail.scrollLeft) return;
  event.preventDefault();
  rail.scrollLeft = next;
}

export function LiveVoiceVisualStage({
  assets,
  artifacts,
  citations,
  tools,
  onToggleAsset,
  onUploadAsset,
  onOpenAsset,
  onOpenArtifact,
}: LiveVoiceVisualStageProps) {
  const [activeAssetId, setActiveAssetId] = useState<string | null>(
    assets.find((asset) => asset.enabled)?.id ?? assets[0]?.id ?? null,
  );
  const [pendingAsset, setPendingAsset] = useState<{
    label: string;
    kind: 'image' | 'document';
  } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const documentInputRef = useRef<HTMLInputElement>(null);
  const uploadedAsset = pendingAsset
    ? [...assets]
        .reverse()
        .find(
          (asset) =>
            asset.label === pendingAsset.label &&
            asset.kind === pendingAsset.kind,
        )
    : undefined;
  const activeAsset =
    assets.find((asset) => asset.id === activeAssetId) ??
    uploadedAsset ??
    assets.find((asset) => asset.enabled) ??
    assets[0];
  const enabledAssetCount = assets.filter((asset) => asset.enabled).length;

  const upload = (
    files: FileList | readonly File[] | null,
    kind: 'image' | 'document',
  ) => {
    const pendingFiles = files ? Array.from(files) : [];
    if (!pendingFiles.length || !onUploadAsset || uploading) return;
    const newestFile = pendingFiles.at(-1);
    if (!newestFile) return;
    setActiveAssetId(null);
    setPendingAsset({ label: newestFile.name, kind });
    setUploading(true);
    setUploadError(false);
    void Promise.all(pendingFiles.map((file) => onUploadAsset(file, kind)))
      .catch(() => setUploadError(true))
      .finally(() => setUploading(false));
  };

  return (
    <aside data-live-visual-stage className="live-voice-visual-stage">
      <div className="live-voice-context-head">
        <span>
          本轮上下文
          <strong>{enabledAssetCount}</strong>
        </span>
        {onUploadAsset ? (
          <div className="live-voice-upload-actions">
            <input
              ref={imageInputRef}
              type="file"
              multiple
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              onChange={(event) => {
                upload(event.currentTarget.files, 'image');
                event.currentTarget.value = '';
              }}
            />
            <input
              ref={documentInputRef}
              type="file"
              accept="application/pdf,text/markdown,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.md,.markdown,.txt,.docx"
              className="sr-only"
              onChange={(event) => {
                upload(event.currentTarget.files, 'document');
                event.currentTarget.value = '';
              }}
            />
            <button
              type="button"
              disabled={uploading}
              onClick={() => imageInputRef.current?.click()}
              aria-label="在 Live 中添加图片"
            >
              <ImageIcon size={15} />
              <span>图片</span>
            </button>
            <button
              type="button"
              disabled={uploading}
              onClick={() => documentInputRef.current?.click()}
              aria-label="在 Live 中添加文档"
            >
              {uploading ? (
                <SpinnerGap className="animate-spin" size={15} />
              ) : (
                <FileArrowUp size={15} />
              )}
              <span>文档</span>
            </button>
          </div>
        ) : null}
      </div>

      {assets.length > 0 ? (
        <div
          className="live-voice-context-rail"
          role="list"
          aria-label="Live 资料"
          onWheel={scrollLiveVoiceContextRail}
        >
          {assets.map((asset) => (
            <button
              key={asset.id}
              type="button"
              role="listitem"
              data-live-stage-asset={asset.id}
              data-active={asset.enabled || undefined}
              data-focused={activeAsset?.id === asset.id || undefined}
              disabled={
                !asset.selectable &&
                asset.status !== 'processing' &&
                asset.status !== 'pending'
              }
              onClick={() => {
                setPendingAsset(null);
                setActiveAssetId(asset.id);
              }}
              title={`${asset.label} · ${liveVoiceAssetStatusLabel(asset)}`}
            >
              <AssetKindIcon kind={asset.kind} label={asset.label} />
              <span>{asset.label}</span>
              <i aria-hidden="true" />
            </button>
          ))}
        </div>
      ) : (
        <p className="live-voice-context-empty">
          可在对话中添加图片或文档，再用语音围绕它讨论。
        </p>
      )}
      {uploadError ? (
        <p role="alert" className="live-voice-upload-error">
          文件暂时无法加入本轮上下文，请稍后重试。
        </p>
      ) : null}

      {activeAsset ? (
        <section
          className="live-voice-resource-workspace"
          aria-label="资料工作台"
        >
          {activeAsset.kind === 'image' && activeAsset.previewUrl ? (
            <LiveVoiceImagePreview
              key={`${activeAsset.id}:${activeAsset.versionId ?? 'current'}`}
              src={activeAsset.previewUrl}
              alt={activeAsset.label}
            />
          ) : (
            <div className="live-voice-resource-workspace__document">
              <span aria-hidden="true">
                <AssetKindIcon
                  kind={activeAsset.kind}
                  label={activeAsset.label}
                  size={32}
                />
              </span>
            </div>
          )}

          <div className="live-voice-resource-workspace__meta">
            <div>
              <p>{activeAsset.label}</p>
              <span>{liveVoiceAssetStatusLabel(activeAsset)}</span>
            </div>
            <div>
              {activeAsset.selectable && onToggleAsset ? (
                <button
                  type="button"
                  aria-pressed={activeAsset.enabled}
                  onClick={() => onToggleAsset(activeAsset.id)}
                >
                  {activeAsset.enabled ? '移出本轮' : '加入本轮'}
                </button>
              ) : null}
              {onOpenAsset && activeAsset.status === 'ready' ? (
                <button
                  type="button"
                  onClick={(event) =>
                    onOpenAsset(activeAsset, event.currentTarget)
                  }
                >
                  打开预览
                </button>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}
      {enabledAssetCount > MAX_LIVE_CONTEXT_ASSETS ? (
        <p role="alert" className="live-voice-upload-error">
          本轮已选择 {enabledAssetCount} 份资料；最多可同时带入{' '}
          {MAX_LIVE_CONTEXT_ASSETS} 份，请取消少量资料后继续。
        </p>
      ) : null}

      {tools.length > 0 || artifacts.length > 0 || citations.length > 0 ? (
        <div className="live-voice-output-stack" aria-live="polite">
          {tools.map((tool) => (
            <p key={tool.id} data-status={tool.status}>
              {tool.status === 'running' ? (
                <SpinnerGap className="animate-spin" size={14} />
              ) : (
                <MagicWand size={14} />
              )}
              {tool.label}
              <small> · {resolveLiveToolStatusLabel(tool.status)}</small>
            </p>
          ))}
          {artifacts.map((artifact) => (
            <button
              key={artifact.id}
              type="button"
              disabled={
                artifact.status === 'generating' ||
                artifact.status === 'proposed' ||
                artifact.status === 'failed' ||
                artifact.status === 'cancelled' ||
                artifact.status === 'archived'
              }
              onClick={(event) =>
                onOpenArtifact?.(
                  artifact.id,
                  artifact.title,
                  event.currentTarget,
                )
              }
            >
              {artifact.previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={artifact.previewUrl} alt="" />
              ) : (
                <MagicWand size={15} />
              )}
              <span>{artifact.title}</span>
              <small>{resolveLiveArtifactStatusLabel(artifact.status)}</small>
            </button>
          ))}
          {citations.length > 0 ? (
            <div className="live-voice-citations">
              {citations.slice(-3).map((citation) => (
                <span key={citation.id}>
                  {citation.label}
                  {citation.pageStart ? ` · P${citation.pageStart}` : ''}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </aside>
  );
}
