import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mindMapContentSchema } from '@educanvas/canvas-protocol';
import { describe, expect, it } from 'vitest';
import { buildConversationOutline } from './mind-map-outline';

describe('buildConversationOutline', () => {
  it('空对话生成仅含根节点的合法导图', () => {
    const content = buildConversationOutline('AI 通识', []);
    expect(content.root.label).toBe('AI 通识');
    expect(content.root.children).toBeUndefined();
    expect(mindMapContentSchema.safeParse(content).success).toBe(true);
  });

  it('学生问题成为一级分支,回答首行与标题成为二级', () => {
    const content = buildConversationOutline('猫狗分类', [
      { role: 'user', content: '什么是神经网络?' },
      {
        role: 'assistant',
        content: '神经网络是…\n## 神经元\n内容\n## 层级结构\n内容',
      },
    ]);
    const branch = content.root.children?.[0];
    expect(branch?.label).toBe('什么是神经网络?');
    expect(branch?.children?.map((node) => node.label)).toEqual([
      '神经网络是…',
      '神经元',
      '层级结构',
    ]);
  });

  it('超长标签截断、分支数量封顶,产出始终过公开 Schema', () => {
    const messages = Array.from({ length: 30 }, (_, index) => ({
      role: 'user' as const,
      content: `问题${index} ${'长'.repeat(200)}`,
    }));
    const content = buildConversationOutline('上限测试', messages);
    expect(content.root.children).toHaveLength(10);
    expect(content.root.children?.[0]?.label.length).toBeLessThanOrEqual(80);
    expect(mindMapContentSchema.safeParse(content).success).toBe(true);
  });
});

describe('生成任务的信任边界(静态)', () => {
  it('generateArtifact 不触碰可信学习事实(learning_events/掌握度)', () => {
    const source = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        './generate-artifact.ts',
      ),
      'utf8',
    );
    expect(source).not.toMatch(/learning_?[eE]vents/);
    expect(source).not.toMatch(/[mM]astery/);
    expect(source).not.toContain('DrizzleEventStore');
    expect(source).not.toContain('teaching-runtime');
  });
});
