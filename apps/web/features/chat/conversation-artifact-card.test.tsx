import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { clampProgress } from './conversation-artifact-card';

const source = readFileSync(
  fileURLToPath(new URL('./conversation-artifact-card.tsx', import.meta.url)),
  'utf8',
);

describe('ConversationArtifactCard', () => {
  it('clampProgress 把服务端进度夹到 0-100', () => {
    expect(clampProgress(42)).toBe(42);
    expect(clampProgress(-3)).toBe(0);
    expect(clampProgress(130)).toBe(100);
    expect(clampProgress(66.6)).toBe(67);
  });

  it('proposed 态渲染 spinner 与进度条，完成时只播放一次脉冲', () => {
    expect(source).toContain('CircleNotch');
    expect(source).toContain('animate-spin');
    expect(source).toContain(
      "import { Progress } from '@/components/ui/progress'",
    );
    expect(source).toContain('<Progress');
    expect(source).toContain('value={progress}');
    expect(source).toContain('生成进度`');
    expect(source).toContain('生成中 ');
    expect(source).toContain("previous !== 'proposed'");
    expect(source).toContain("artifact.status !== 'active'");
    expect(source).toContain('prefers-reduced-motion');
  });

  it('失败与取消有独立视觉与文案', () => {
    expect(source).toContain('bg-danger-soft');
    expect(source).toContain('生成失败');
    expect(source).toContain('已取消');
  });

  it('卡片不复制 Canvas 内容或详情请求', () => {
    expect(source).not.toContain('fetchArtifactDetail');
    expect(source).not.toContain('fetchCanvasResource');
  });
});
