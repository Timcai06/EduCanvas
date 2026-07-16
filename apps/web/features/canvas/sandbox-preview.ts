/**
 * Tier 2 沙箱探索型产物的纯逻辑层（ADR-0010）。
 *
 * 信任模型：模型生成的 HTML 只能进入无 `allow-same-origin` 的 sandboxed iframe，
 * 网络外联由文档级 CSP 兜底（sandbox 属性本身不拦截网络请求）。本模块只做
 * 字符串构建与判定，不触碰 DOM，便于单元测试覆盖安全不变量。
 */

/** 预览体积上限。超过该值的代码块只显示源码，不提供沙箱预览，防止 srcdoc 拖垮主线程。 */
export const MAX_PREVIEW_SOURCE_BYTES = 256 * 1024;

const PREVIEWABLE_LANGUAGES = new Set(['html', 'htm']);

/**
 * 判定一个 fenced code block 是否可作为沙箱预览产物。
 * 只认显式标注 html/htm 的代码块；不做内容嗅探，避免把 XML/SVG 示例误判成产物。
 */
export function isPreviewableHtml(
  language: string | null,
  source: string,
): boolean {
  if (language === null) return false;
  if (!PREVIEWABLE_LANGUAGES.has(language.toLowerCase())) return false;
  const trimmed = source.trim();
  if (trimmed.length === 0) return false;
  return new TextEncoder().encode(source).length <= MAX_PREVIEW_SOURCE_BYTES;
}

/**
 * CSP 必须禁止一切网络外联：脚本/样式只允许内联，图片与字体只允许 data:。
 * `frame-src 'none'` 阻止沙箱内再嵌套 iframe 逃逸到外部站点。
 */
const SANDBOX_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data:',
  'font-src data:',
  'media-src data:',
  "frame-src 'none'",
  "form-action 'none'",
].join('; ');

/**
 * 把模型生成的 HTML 片段包装为自治的 srcdoc 文档。
 *
 * 始终使用我们自己的外壳而不是直接采用模型的完整文档：CSP meta 必须出现在
 * head 最前，才能约束其后的全部内联脚本；若模型输出了完整 `<html>` 文档，
 * 浏览器解析器会忽略嵌套的文档标签，内容仍然生效。
 */
export function buildSandboxDocument(source: string): string {
  return [
    '<!doctype html>',
    '<html lang="zh-CN">',
    '<head>',
    `<meta http-equiv="Content-Security-Policy" content="${SANDBOX_CSP}">`,
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<style>',
    ':root { color-scheme: dark; }',
    'body { margin: 0; padding: 12px; font-family: system-ui, sans-serif; background: #101116; color: #e8eaed; }',
    '</style>',
    '</head>',
    '<body>',
    source,
    '</body>',
    '</html>',
  ].join('\n');
}

/**
 * iframe 的 sandbox 属性白名单。绝不加入 `allow-same-origin`（同源即逃逸）、
 * `allow-popups`、`allow-top-navigation`、`allow-forms`。
 */
export const SANDBOX_IFRAME_PERMISSIONS = 'allow-scripts';
