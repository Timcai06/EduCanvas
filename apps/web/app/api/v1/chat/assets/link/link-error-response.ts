import { jsonError } from '@/server/http/request-security';

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
  | 'link_import_unavailable'
  | 'fake_ip_dns_detected';

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
    case 'fake_ip_dns_detected':
      return new LinkImportError('fake_ip_dns_detected', false);
    default:
      return new LinkImportError('link_import_unavailable', true);
  }
}

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
export function linkErrorResponse(
  error: LinkImportError,
  retryAfterMs?: number,
): Response {
  return jsonError(statusFor(error.code), error.code, { retryAfterMs });
}
