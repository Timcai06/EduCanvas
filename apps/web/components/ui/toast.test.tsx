import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  fileURLToPath(new URL('./toast.tsx', import.meta.url)),
  'utf8',
);

describe('toast boundary', () => {
  it('模块级订阅且零 provider：showToast 可在非组件代码调用', () => {
    expect(source).toContain('export function showToast');
    expect(source).toContain('export function dismissToast');
    expect(source).toContain('const listeners = new Set');
    expect(source).not.toContain('createContext');
  });

  it('通知可访问且可关闭：aria-live、关闭按钮与自动消失', () => {
    expect(source).toContain('aria-live="polite"');
    expect(source).toContain('role="status"');
    expect(source).toContain('aria-label="关闭通知"');
    expect(source).toContain('AUTO_DISMISS_MS');
  });

  it('入场动效遵循 reduced-motion 约定，只动 transform/opacity', () => {
    expect(source).toContain('gsap.matchMedia');
    expect(source).toContain('prefers-reduced-motion');
    expect(source).toContain('autoAlpha');
    expect(source).toContain('clearProps');
  });

  it('不把任何 provider/prompt/正文信息带进通知结构', () => {
    expect(source).not.toMatch(/\b(?:provider|prompt|objectKey)\b/i);
  });
});
