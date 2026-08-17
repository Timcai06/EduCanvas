import { jsonResponse } from '@/server/http/request-security';

export type PublicLinkErrorCode =
  | 'link_invalid_url'
  | 'link_blocked_host'
  | 'link_network_unreachable'
  | 'link_access_blocked'
  | 'link_rate_limited'
  | 'link_page_too_large'
  | 'link_no_extractable_content'
  | 'link_unsupported_format'
  | 'link_render_unavailable'
  | 'link_render_failed'
  | 'link_import_unavailable';

export class LinkImportError extends Error {
  override readonly name = 'LinkImportError';

  constructor(
    readonly code: PublicLinkErrorCode,
    readonly retryable: boolean,
  ) {
    super(code);
  }
}

export function normalizePublicLinkError(code: string): LinkImportError {
  switch (code) {
    case 'invalid_url':
    case 'link_invalid_url':
      return new LinkImportError('link_invalid_url', false);
    case 'blocked_host':
    case 'link_blocked_host':
      return new LinkImportError('link_blocked_host', false);
    case 'too_large':
    case 'link_too_large':
    case 'link_page_too_large':
      return new LinkImportError('link_page_too_large', false);
    case 'unsupported_content':
    case 'link_unsupported_content':
    case 'link_no_extractable_content':
      return new LinkImportError('link_no_extractable_content', false);
    case 'link_unsupported_format':
      return new LinkImportError('link_unsupported_format', false);
    case 'link_access_blocked':
      return new LinkImportError('link_access_blocked', false);
    case 'link_rate_limited':
      return new LinkImportError('link_rate_limited', true);
    case 'link_render_unavailable':
      return new LinkImportError('link_render_unavailable', true);
    case 'link_render_failed':
      return new LinkImportError('link_render_failed', true);
    case 'fetch_failed':
    case 'link_fetch_failed':
    case 'link_network_unreachable':
      return new LinkImportError('link_network_unreachable', true);
    default:
      return new LinkImportError('link_import_unavailable', true);
  }
}

const messageByCode: Record<PublicLinkErrorCode, string> = {
  link_invalid_url: '链接格式不正确。请输入完整的 HTTP(S) 地址。',
  link_blocked_host: '该地址不允许访问。请更换公开网页地址。',
  link_network_unreachable: '无法连接该网页。请检查网络后重试。',
  link_access_blocked: '网页拒绝访问或需要登录。请保存为 PDF 后上传。',
  link_rate_limited: '网页暂时限制了访问。请稍后重试。',
  link_page_too_large: '网页内容超过大小限制。请保存正文或 PDF 后上传。',
  link_no_extractable_content: '网页没有可提取的正文。请保存为 PDF 后上传。',
  link_unsupported_format: '网页格式暂不支持。请上传受支持的文件。',
  link_render_unavailable: '网页渲染服务暂不可用。请稍后重试或上传 PDF。',
  link_render_failed: '网页渲染失败。请重试或上传 PDF。',
  link_import_unavailable: '暂时无法导入该网页。请稍后重试。',
};

function statusFor(code: PublicLinkErrorCode): number {
  if (code === 'link_rate_limited') return 429;
  if (
    code === 'link_network_unreachable' ||
    code === 'link_render_unavailable' ||
    code === 'link_import_unavailable'
  ) {
    return 503;
  }
  return 422;
}

/** 路由只返回稳定错误投影，不接受异常 message 或上游 body。 */
export function linkErrorResponse(error: LinkImportError): Response {
  return jsonResponse(
    {
      error: {
        code: error.code,
        message: messageByCode[error.code],
        retryable: error.retryable,
      },
    },
    { status: statusFor(error.code) },
  );
}
