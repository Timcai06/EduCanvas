import { describe, expect, it } from 'vitest';
import {
  applyMutexEntry,
  hasConcurrentSurfaces,
  OPEN_ARTIFACT_KEEPS_HTML_PREVIEW,
  type WorkspaceMutexState,
} from './workspace-surface-contract';

function allOpen(): WorkspaceMutexState {
  return {
    sourceOpen: true,
    sourcePreviewFull: true,
    artifactOpen: true,
    previewHtmlOpen: true,
    studioOpen: true,
  };
}

describe('WorkspaceSurface characterization（W00 现状固定）', () => {
  it('打开 Source 清掉 source、artifact、previewHtml、studio（Studio onOpenSource 503-509）', () => {
    const next = applyMutexEntry(allOpen(), 'open_source');
    expect(next).toEqual({
      sourceOpen: false,
      sourcePreviewFull: false,
      artifactOpen: false,
      previewHtmlOpen: false,
      studioOpen: false,
    });
  });

  it('从消息打开 Artifact 清 source 与 previewHtml，保留 studio（onOpenArtifact 394-399）', () => {
    const next = applyMutexEntry(allOpen(), 'open_artifact_from_message');
    expect(next.sourceOpen).toBe(false);
    expect(next.sourcePreviewFull).toBe(false);
    expect(next.previewHtmlOpen).toBe(false);
    expect(next.artifactOpen).toBe(true);
    expect(next.studioOpen).toBe(true);
  });

  it('从 Studio 打开 Artifact 清 source 与 studio，保留 previewHtml（onOpenOutput 510-515）', () => {
    const next = applyMutexEntry(allOpen(), 'open_artifact_from_studio');
    expect(next.sourceOpen).toBe(false);
    expect(next.sourcePreviewFull).toBe(false);
    expect(next.studioOpen).toBe(false);
    expect(next.previewHtmlOpen).toBe(true);
  });

  it('从状态卡打开 Artifact 只清 source，保留 previewHtml 与 studio（onOpen 408-413）', () => {
    const next = applyMutexEntry(allOpen(), 'open_artifact_from_status_card');
    expect(next.sourceOpen).toBe(false);
    expect(next.sourcePreviewFull).toBe(false);
    expect(next.artifactOpen).toBe(true);
    expect(next.previewHtmlOpen).toBe(true);
    expect(next.studioOpen).toBe(true);
  });

  it('打开 HTML Preview 清 source，保留 artifact 与 studio（onPreviewHtml 389-393）', () => {
    const next = applyMutexEntry(allOpen(), 'open_html_preview');
    expect(next.sourceOpen).toBe(false);
    expect(next.sourcePreviewFull).toBe(false);
    expect(next.previewHtmlOpen).toBe(true);
    expect(next.artifactOpen).toBe(true);
    expect(next.studioOpen).toBe(true);
  });

  it('关闭 Source 清 source 与全屏（onClose 479-482）', () => {
    const next = applyMutexEntry(allOpen(), 'close_source');
    expect(next.sourceOpen).toBe(false);
    expect(next.sourcePreviewFull).toBe(false);
    expect(next.artifactOpen).toBe(true);
  });

  it('现状允许打开 Artifact 时保留 HTML Preview（不一致标记为契约事实）', () => {
    expect(OPEN_ARTIFACT_KEEPS_HTML_PREVIEW).toBe(true);
    const viaStatusCard = applyMutexEntry(
      allOpen(),
      'open_artifact_from_status_card',
    );
    expect(hasConcurrentSurfaces(viaStatusCard)).toBe(true);
  });

  it('打开 Source 后不会出现多个工作面同时开启', () => {
    const next = applyMutexEntry(allOpen(), 'open_source');
    expect(hasConcurrentSurfaces(next)).toBe(false);
  });
});
