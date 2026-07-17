import { describe, expect, it } from 'vitest';
import {
  MAX_PREVIEW_SOURCE_BYTES,
  SANDBOX_IFRAME_PERMISSIONS,
  buildSandboxDocument,
  isPreviewableHtml,
} from './sandbox-preview';

describe('isPreviewableHtml', () => {
  it('只接受显式 html/htm 语言标注', () => {
    expect(isPreviewableHtml('html', '<button>点我</button>')).toBe(true);
    expect(isPreviewableHtml('HTML', '<button>点我</button>')).toBe(true);
    expect(isPreviewableHtml('htm', '<p>ok</p>')).toBe(true);
    expect(isPreviewableHtml('svg', '<svg></svg>')).toBe(false);
    expect(isPreviewableHtml('xml', '<a/>')).toBe(false);
    expect(isPreviewableHtml('js', 'alert(1)')).toBe(false);
    expect(isPreviewableHtml(null, '<p>ok</p>')).toBe(false);
  });

  it('拒绝空白内容与超限内容', () => {
    expect(isPreviewableHtml('html', '   \n  ')).toBe(false);
    const oversized = 'a'.repeat(MAX_PREVIEW_SOURCE_BYTES + 1);
    expect(isPreviewableHtml('html', oversized)).toBe(false);
    const boundary = 'a'.repeat(MAX_PREVIEW_SOURCE_BYTES);
    expect(isPreviewableHtml('html', boundary)).toBe(true);
  });

  it('多字节字符按字节数而非字符数计量', () => {
    const cjk = '汉'.repeat(Math.ceil(MAX_PREVIEW_SOURCE_BYTES / 3) + 1);
    expect(isPreviewableHtml('html', cjk)).toBe(false);
  });
});

describe('buildSandboxDocument', () => {
  const doc = buildSandboxDocument('<h1>你好</h1><script>done()</script>');

  it('CSP meta 出现在任何模型内容之前', () => {
    const cspIndex = doc.indexOf('Content-Security-Policy');
    const contentIndex = doc.indexOf('<h1>你好</h1>');
    expect(cspIndex).toBeGreaterThan(-1);
    expect(contentIndex).toBeGreaterThan(cspIndex);
  });

  it('CSP 禁止网络外联并封死嵌套 iframe 与表单提交', () => {
    expect(doc).toContain("default-src 'none'");
    expect(doc).toContain("frame-src 'none'");
    expect(doc).toContain("form-action 'none'");
    expect(doc).not.toContain('http:');
    expect(doc).not.toContain('https:');
  });

  it('模型内容原样进入 body,不做转义(执行本来就是目的)', () => {
    expect(doc).toContain('<script>done()</script>');
  });

  it('sandbox 权限白名单只有 allow-scripts', () => {
    expect(SANDBOX_IFRAME_PERMISSIONS).toBe('allow-scripts');
    expect(SANDBOX_IFRAME_PERMISSIONS).not.toContain('same-origin');
    expect(SANDBOX_IFRAME_PERMISSIONS).not.toContain('popups');
    expect(SANDBOX_IFRAME_PERMISSIONS).not.toContain('top-navigation');
  });
});
