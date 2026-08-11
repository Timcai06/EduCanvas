export interface VoicePermissionInput {
  permission: string;
  isMainFrame: boolean;
  mediaTypes?: Array<'audio' | 'video'>;
  requestingUrl?: string;
  documentUrl: string;
}

function normalizedPageUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

/** 默认拒绝；只允许当前桌宠主页面请求纯麦克风权限。 */
export function isAllowedVoicePermission(input: VoicePermissionInput): boolean {
  const requested = normalizedPageUrl(input.requestingUrl);
  const document = normalizedPageUrl(input.documentUrl);
  return (
    input.permission === 'media' &&
    input.isMainFrame &&
    input.mediaTypes?.length === 1 &&
    input.mediaTypes[0] === 'audio' &&
    requested !== null &&
    requested === document
  );
}
