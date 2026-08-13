'use client';

import {
  FileArrowUp,
  FilePdf,
  Image as ImageIcon,
  LinkSimple,
  MagicWand,
  SpinnerGap,
  VideoCamera,
  Waveform,
} from '@phosphor-icons/react';
import { useRef, useState, type WheelEvent } from 'react';
import type { LiveVoiceAnnotationDraft } from './live-voice-bring-back';
import {
  MAX_LIVE_CONTEXT_ASSETS,
  liveVoiceAssetStatusLabel,
  type LiveVoiceArtifactItem,
  type LiveVoiceCitationItem,
  type LiveVoiceContextAsset,
  type LiveVoiceToolItem,
} from './live-voice-context';

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
    assetId: string,
    title: string,
    trigger: HTMLButtonElement,
  ) => void;
  readonly onOpenArtifact?: (
    artifactId: string,
    title: string,
    trigger: HTMLButtonElement,
  ) => void;
  readonly annotations?: readonly LiveVoiceAnnotationDraft[];
  readonly onAnnotateAsset?: (draft: LiveVoiceAnnotationDraft) => void;
}

function AssetKindIcon({ kind }: { kind: LiveVoiceContextAsset['kind'] }) {
  if (kind === 'image') return <ImageIcon size={17} />;
  if (kind === 'link') return <LinkSimple size={17} />;
  if (kind === 'audio') return <Waveform size={17} />;
  if (kind === 'video') return <VideoCamera size={17} />;
  return <FilePdf size={17} />;
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
  annotations = [],
  onAnnotateAsset,
}: LiveVoiceVisualStageProps) {
  const firstFocusable = assets.find(
    (asset) => asset.enabled && asset.status === 'ready',
  );
  const [focusedAssetId, setFocusedAssetId] = useState<string | null>(
    firstFocusable?.id ?? null,
  );
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const documentInputRef = useRef<HTMLInputElement>(null);
  const focusedAsset =
    assets.find((asset) => asset.id === focusedAssetId) ?? firstFocusable;
  const enabledAssetCount = assets.filter((asset) => asset.enabled).length;

  const upload = (file: File | undefined, kind: 'image' | 'document') => {
    if (!file || !onUploadAsset || uploading) return;
    setUploading(true);
    setUploadError(false);
    void onUploadAsset(file, kind)
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
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              onChange={(event) => {
                upload(event.currentTarget.files?.[0], 'image');
                event.currentTarget.value = '';
              }}
            />
            <input
              ref={documentInputRef}
              type="file"
              accept="application/pdf,text/markdown,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.md,.markdown,.txt,.docx"
              className="sr-only"
              onChange={(event) => {
                upload(event.currentTarget.files?.[0], 'document');
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
            </button>
          </div>
        ) : null}
      </div>

      {assets.length > 0 ? (
        <div
          className="live-voice-context-rail"
          role="list"
          aria-label="Live 上下文"
          onWheel={scrollLiveVoiceContextRail}
        >
          {assets.map((asset) => (
            <button
              key={asset.id}
              type="button"
              role="listitem"
              data-live-stage-asset={asset.id}
              data-active={asset.enabled || undefined}
              data-focused={focusedAsset?.id === asset.id || undefined}
              disabled={
                !asset.selectable &&
                asset.status !== 'processing' &&
                asset.status !== 'pending'
              }
              onClick={() => {
                setFocusedAssetId(asset.id);
                if (asset.selectable) onToggleAsset?.(asset.id);
              }}
              title={`${asset.label} · ${liveVoiceAssetStatusLabel(asset)}`}
            >
              <AssetKindIcon kind={asset.kind} />
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
      {enabledAssetCount > MAX_LIVE_CONTEXT_ASSETS ? (
        <p role="alert" className="live-voice-upload-error">
          本轮已选择 {enabledAssetCount} 份资料；最多可同时带入{' '}
          {MAX_LIVE_CONTEXT_ASSETS} 份，请取消少量资料后继续。
        </p>
      ) : null}

      {focusedAsset ? (
        <article data-live-focus-card className="live-voice-focus-card">
          {focusedAsset.kind === 'image' && focusedAsset.previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={focusedAsset.previewUrl} alt={focusedAsset.label} />
          ) : (
            <span className="live-voice-focus-icon">
              <AssetKindIcon kind={focusedAsset.kind} />
            </span>
          )}
          <div>
            <p>{focusedAsset.label}</p>
            <span>{liveVoiceAssetStatusLabel(focusedAsset)}</span>
          </div>
          {onOpenAsset && focusedAsset.status === 'ready' ? (
            <button
              type="button"
              onClick={(event) =>
                onOpenAsset(
                  focusedAsset.id,
                  focusedAsset.label,
                  event.currentTarget,
                )
              }
            >
              在 Live 中预览
            </button>
          ) : null}
        </article>
      ) : null}

      {focusedAsset?.kind === 'image' &&
      focusedAsset.previewUrl &&
      focusedAsset.status === 'ready' &&
      onAnnotateAsset ? (
        <div className="live-voice-annotation-wrap">
          <p>轻点图片，把这一处带回书案</p>
          <button
            type="button"
            className="live-voice-annotation-surface"
            aria-label={`在 ${focusedAsset.label} 上圈点`}
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              const centerX = (event.clientX - rect.left) / rect.width;
              const centerY = (event.clientY - rect.top) / rect.height;
              const width = 0.18;
              const height = 0.13;
              onAnnotateAsset({
                clientId: crypto.randomUUID(),
                resourceKind: 'source',
                resourceId: focusedAsset.id,
                resourceVersionId: focusedAsset.versionId ?? null,
                kind: 'circle',
                geometry: {
                  x: Math.max(0, Math.min(1 - width, centerX - width / 2)),
                  y: Math.max(0, Math.min(1 - height, centerY - height / 2)),
                  width,
                  height,
                },
              });
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={focusedAsset.previewUrl} alt="" />
            <svg viewBox="0 0 100 100" preserveAspectRatio="none">
              {annotations
                .filter(
                  (annotation) => annotation.resourceId === focusedAsset.id,
                )
                .map((annotation) => (
                  <ellipse
                    key={annotation.clientId}
                    cx={
                      (annotation.geometry.x +
                        (annotation.geometry.width ?? 0.18) / 2) *
                      100
                    }
                    cy={
                      (annotation.geometry.y +
                        (annotation.geometry.height ?? 0.13) / 2) *
                      100
                    }
                    rx={((annotation.geometry.width ?? 0.18) / 2) * 100}
                    ry={((annotation.geometry.height ?? 0.13) / 2) * 100}
                  />
                ))}
            </svg>
          </button>
        </div>
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
