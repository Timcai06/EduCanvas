import 'server-only';

import { LinkTrafficLimiter } from '../assets/link-traffic-limiter';

/** 单主体、单 Notebook 的沙箱启动预算；每分钟十次且同一时间只运行一个。 */
export const codeRunTrafficLimiter = new LinkTrafficLimiter({
  windowMs: 60_000,
  maxRequests: 10,
  maxConcurrent: 1,
});

export function codeRunTrafficKey(
  trustedSubjectId: string,
  notebookId: string,
): string {
  return `${trustedSubjectId.trim()}\u0000${notebookId.trim()}`;
}
