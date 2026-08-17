/**
 * 首页 `?focus=<kind>:<resourceId>` 参数的解析（DP08 Web handoff 落点）。
 * 只接受 source|artifact + UUID 资源 id；数组/非字符串/非法 id 一律 null，
 * 调用方不得对 null 做任何资源打开动作。
 */

export type HomeFocusTarget = {
  kind: 'source' | 'artifact';
  resourceId: string;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FOCUS_PATTERN = /^(artifact|source):([0-9a-f-]+)$/i;

export function parseHomeFocusParam(
  raw: string | string[] | undefined,
): HomeFocusTarget | null {
  if (Array.isArray(raw) || typeof raw !== 'string') return null;
  const match = FOCUS_PATTERN.exec(raw);
  if (!match) return null;
  const resourceId = match[2]!.toLowerCase();
  if (!UUID_PATTERN.test(resourceId)) return null;
  return {
    kind: match[1]!.toLowerCase() === 'source' ? 'source' : 'artifact',
    resourceId,
  };
}
