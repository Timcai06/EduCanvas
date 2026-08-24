import { z } from 'zod';
import { ResourceClientError } from '../canvas/resource-error';

export const linkErrorCodes = [
  'link_invalid_url',
  'link_blocked_host',
  'link_network_unreachable',
  'link_access_blocked',
  'link_rate_limited',
  'link_page_too_large',
  'link_no_extractable_content',
  'link_unsupported_format',
  'link_render_unavailable',
  'link_render_failed',
  'link_import_unavailable',
  'fake_ip_dns_detected',
] as const;

export type LinkClientErrorCode = (typeof linkErrorCodes)[number];

export class LinkAssetClientError extends ResourceClientError {
  override readonly name = 'LinkAssetClientError';

  constructor(
    readonly code: LinkClientErrorCode,
    readonly retryable: boolean,
    message: string,
    kind: ConstructorParameters<typeof ResourceClientError>[0] = 'failed',
  ) {
    super(kind, message);
  }
}

export const linkErrorCodeSchema = z.enum(linkErrorCodes);

export const linkErrorCopy: Readonly<Record<LinkClientErrorCode, string>> = {
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
  fake_ip_dns_detected:
    '当前网络无法安全解析该网页。请直接打开原网页，或稍后重试导入。',
};
