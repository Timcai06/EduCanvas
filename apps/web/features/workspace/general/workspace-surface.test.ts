import { describe, expect, it } from 'vitest';
import {
  activeTarget,
  INITIAL_SURFACE,
  isPending,
  workspaceSurfaceReducer,
  type WorkspaceSurface,
} from './workspace-surface';

describe('WorkspaceSurface reducer', () => {
  it('初始为 none，openSource 得到唯一 source 工作面', () => {
    const next = workspaceSurfaceReducer(INITIAL_SURFACE, {
      type: 'openSource',
      resourceId: 'src-1',
    });
    expect(next).toEqual({ type: 'source', resourceId: 'src-1', full: false });
  });

  it('open* 动作互斥：打开 artifact 会清掉已打开的 source', () => {
    const source = workspaceSurfaceReducer(INITIAL_SURFACE, {
      type: 'openSource',
      resourceId: 'src-1',
    });
    const next = workspaceSurfaceReducer(source, {
      type: 'openArtifact',
      artifactId: 'art-1',
    });
    expect(next).toEqual({
      type: 'artifact',
      artifactId: 'art-1',
      full: false,
    });
  });

  it('消除 characterization 不一致：打开 Artifact 时不再保留其它工作面（W01 收敛）', () => {
    // characterization 发现旧 status_card 入口打开 Artifact 会保留 HTML Preview
    // （workspace-surface-contract.ts OPEN_ARTIFACT_KEEPS_HTML_PREVIEW=true）。
    // W01 reducer 统一互斥：openArtifact 只留下 artifact 一个工作面。
    const html = workspaceSurfaceReducer(INITIAL_SURFACE, {
      type: 'openHtml',
      source: '<p>hi</p>',
    });
    const next = workspaceSurfaceReducer(html, {
      type: 'openArtifact',
      artifactId: 'art-9',
    });
    expect(next).toEqual({
      type: 'artifact',
      artifactId: 'art-9',
      full: false,
    });
  });

  it('openStudio 与主槽位互斥：从 source 打开 studio 得到 studio', () => {
    const source = workspaceSurfaceReducer(INITIAL_SURFACE, {
      type: 'openSource',
      resourceId: 'src-1',
    });
    const next = workspaceSurfaceReducer(source, { type: 'openStudio' });
    expect(next).toEqual({ type: 'studio' });
  });

  it('任何 open* 动作都不会让两个工作面同时存在', () => {
    const cases: WorkspaceSurface[] = [
      workspaceSurfaceReducer(INITIAL_SURFACE, {
        type: 'openSource',
        resourceId: 's',
      }),
      workspaceSurfaceReducer(INITIAL_SURFACE, {
        type: 'openArtifact',
        artifactId: 'a',
      }),
      workspaceSurfaceReducer(INITIAL_SURFACE, {
        type: 'openHtml',
        source: '<p>hi</p>',
      }),
      workspaceSurfaceReducer(INITIAL_SURFACE, { type: 'openStudio' }),
    ];
    for (const s of cases) {
      expect(isPending(s)).toBe(false);
      // 每个打开态必须是明确的单一面
      expect(['source', 'artifact', 'html', 'studio']).toContain(s.type);
    }
  });

  it('close 返回 none', () => {
    const open = workspaceSurfaceReducer(INITIAL_SURFACE, {
      type: 'openHtml',
      source: '<p>hi</p>',
    });
    expect(workspaceSurfaceReducer(open, { type: 'close' })).toEqual({
      type: 'none',
    });
  });

  it('toggleFull 只对 source/artifact/html 生效，且翻转 full', () => {
    const open = workspaceSurfaceReducer(INITIAL_SURFACE, {
      type: 'openSource',
      resourceId: 's',
    });
    const full = workspaceSurfaceReducer(open, { type: 'toggleFull' });
    expect(full).toEqual({ type: 'source', resourceId: 's', full: true });
    // 对 none / studio / loading / failed 是 no-op
    expect(
      workspaceSurfaceReducer(INITIAL_SURFACE, { type: 'toggleFull' }),
    ).toEqual(INITIAL_SURFACE);
    const studio = workspaceSurfaceReducer(INITIAL_SURFACE, {
      type: 'openStudio',
    });
    expect(workspaceSurfaceReducer(studio, { type: 'toggleFull' })).toEqual(
      studio,
    );
  });

  it('beginLoad 与 fail 建立 loading / failed 中间态', () => {
    const target = { kind: 'source' as const, resourceId: 's-1' };
    const loading = workspaceSurfaceReducer(INITIAL_SURFACE, {
      type: 'beginLoad',
      target,
    });
    expect(loading).toEqual({ type: 'loading', target });
    expect(isPending(loading)).toBe(true);

    const failed = workspaceSurfaceReducer(loading, {
      type: 'fail',
      target,
      code: 'not_found',
    });
    expect(failed).toEqual({ type: 'failed', target, code: 'not_found' });
    expect(isPending(failed)).toBe(true);
  });

  it('fail 携带稳定 code，不把失败伪装成空', () => {
    const target = { kind: 'artifact' as const, artifactId: 'a-1' };
    const failed = workspaceSurfaceReducer(INITIAL_SURFACE, {
      type: 'beginLoad',
      target,
    });
    const next = workspaceSurfaceReducer(failed, {
      type: 'fail',
      target,
      code: 'forbidden',
    });
    expect(next).toEqual({ type: 'failed', target, code: 'forbidden' });
  });

  it('activeTarget 返回打开的工作面标识，未打开返回 null', () => {
    expect(activeTarget(INITIAL_SURFACE)).toBeNull();
    const art = workspaceSurfaceReducer(INITIAL_SURFACE, {
      type: 'openArtifact',
      artifactId: 'a-9',
    });
    expect(activeTarget(art)).toEqual({ kind: 'artifact', artifactId: 'a-9' });
    const loading = workspaceSurfaceReducer(INITIAL_SURFACE, {
      type: 'beginLoad',
      target: { kind: 'source', resourceId: 's-2' },
    });
    expect(activeTarget(loading)).toBeNull();
  });

  it('reset 回到 none', () => {
    const open = workspaceSurfaceReducer(INITIAL_SURFACE, {
      type: 'openArtifact',
      artifactId: 'a',
    });
    expect(workspaceSurfaceReducer(open, { type: 'reset' })).toEqual(
      INITIAL_SURFACE,
    );
  });

  it('closeStudio 只在 studio 时生效，其它状态为 no-op', () => {
    const studio = workspaceSurfaceReducer(INITIAL_SURFACE, {
      type: 'openStudio',
    });
    expect(workspaceSurfaceReducer(studio, { type: 'closeStudio' })).toEqual({
      type: 'none',
    });
    const open = workspaceSurfaceReducer(INITIAL_SURFACE, {
      type: 'openSource',
      resourceId: 's',
    });
    expect(workspaceSurfaceReducer(open, { type: 'closeStudio' })).toEqual(
      open,
    );
  });
});
