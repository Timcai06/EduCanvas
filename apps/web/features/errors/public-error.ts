import { z } from 'zod';

const publicErrorEnvelopeSchema = z
  .object({
    error: z
      .object({
        code: z.string().min(1).max(128),
        requestId: z.string().min(1).max(128),
      })
      .strict(),
  })
  .strict();

export const DEEP_RESEARCH_UNAVAILABLE_MESSAGE =
  '深度研究需要网页搜索支持，请先配置搜索服务。';

const messages: Readonly<Record<string, string>> = {
  auth_rate_limited: '尝试过于频繁，请稍后重试。',
  invalid_credentials: '用户名或密码不正确。',
  password_too_short: '密码需为 8 至 128 位。',
  username_taken: '该用户名已被使用。',
  invalid_current_password: '当前密码不正确。',
  forbidden: '没有权限执行此操作。',
  forbidden_origin: '请求来源不受信任。',
  unauthorized: '请先登录后再试。',
  invalid_request: '请求格式不正确。',
  invalid_upload: '上传参数不完整。',
  asset_too_large: '文件超过大小限制。',
  avatar_too_large: '头像不能超过 2MB。',
  invalid_avatar: '请选择有效的头像文件。',
  turn_rate_limited: '提问太频繁，请稍后再试。',
  turn_in_progress: 'AI 仍在回答上一条消息。',
  turn_not_found: '回答不存在或不可访问。',
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
  search_not_configured: '网页搜索尚未配置。请改用网页地址导入。',
  search_timeout: '网页搜索超时。请重试或缩短检索词。',
  search_rate_limited: '网页搜索请求过于频繁。请稍后重试。',
  search_provider_unavailable: '网页搜索暂时不可用。请稍后重试。',
  search_invalid_response: '网页搜索结果格式不正确。请重试。',
  search_budget_exhausted: '网页搜索未能在限定时间内完成。请重试。',
  search_cancelled: '网页搜索已取消。',
  deep_research_unavailable: DEEP_RESEARCH_UNAVAILABLE_MESSAGE,
};

const nonRetryableCodes = new Set(['deep_research_unavailable']);

export interface BrowserPublicError {
  code: string;
  requestId: string | null;
  message: string;
  retryable: boolean;
}

export function messageForPublicError(code: string, fallback: string): string {
  return messages[code] ?? fallback;
}

export async function readPublicError(
  response: Response,
  fallback: string,
): Promise<BrowserPublicError> {
  const parsed = publicErrorEnvelopeSchema.safeParse(
    await response.json().catch(() => null),
  );
  const code = parsed.success ? parsed.data.error.code : 'unknown_error';
  return {
    code,
    requestId: parsed.success ? parsed.data.error.requestId : null,
    message: messageForPublicError(code, fallback),
    retryable:
      !nonRetryableCodes.has(code) &&
      (response.status === 408 ||
        response.status === 429 ||
        response.status >= 500),
  };
}

export async function publicErrorMessage(
  response: Response,
  fallback: string,
): Promise<string> {
  return (await readPublicError(response, fallback)).message;
}
