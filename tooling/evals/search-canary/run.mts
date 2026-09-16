/**
 * 真实搜索 Provider 连通性探针（WS09 的 B/C 两节前置条件）。
 *
 * 演示与录像前跑一次，确认内置搜索与深度研究不是挂在一个不通的 Provider 上。
 * 只打印非敏感事实：结果数、域名、耗时。绝不打印 API Key、请求体、Provider
 * 原始响应或网页正文——与 docs/06-quality/evidence 的证据纪律一致。
 *
 *   pnpm search:canary              # 默认查询「光合作用的研究进展」
 *   pnpm search:canary "自定义查询"
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTavilyAdapter } from '../../../apps/web/server/tools/tavily-adapter';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/* 只在变量尚未由外部注入时才从 .env 兜底，CI 与容器里以真实环境变量为准。 */
function loadDotEnv(): void {
  let raw: string;
  try {
    raw = readFileSync(resolve(repoRoot, '.env'), 'utf8');
  } catch {
    return;
  }
  for (const line of raw.split('\n')) {
    const matched = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (matched && process.env[matched[1]!] === undefined) {
      process.env[matched[1]!] = matched[2]!;
    }
  }
}

loadDotEnv();

const query = process.argv[2]?.trim() || '光合作用的研究进展';
const apiKey = process.env.SEARCH_API_KEY?.trim();

if (!apiKey) {
  console.log('search-canary=skipped reason=SEARCH_API_KEY_未配置');
  process.exit(0);
}

const adapter = createTavilyAdapter({
  apiKey,
  ...(process.env.SEARCH_BASE_URL?.trim()
    ? { baseUrl: process.env.SEARCH_BASE_URL.trim() }
    : {}),
});

const startedAt = Date.now();
try {
  const response = await adapter.search({ query, limit: 5 });
  /* adapter 直接返回结果数组；这里同时容忍 { results } 形态，避免契约微调时探针先挂。 */
  const results = Array.isArray(response)
    ? response
    : ((response as { results?: readonly { url: string }[] }).results ?? []);
  const domains = results.map((item) => new URL(item.url).hostname);
  const elapsedMs = Date.now() - startedAt;
  console.log(
    `search-canary=ok query=${JSON.stringify(query)} results=${results.length} ms=${elapsedMs} domains=${JSON.stringify(domains)}`,
  );
  /* WS09 C 节要求至少 5 个真实来源；不足即视为演示阻断项。 */
  if (results.length < 5) {
    console.log('search-canary=warn reason=结果数不足5条_深度研究可能无法达标');
    process.exitCode = 1;
  }
} catch (error) {
  const elapsedMs = Date.now() - startedAt;
  console.log(
    `search-canary=failed ms=${elapsedMs} name=${(error as Error).name} code=${
      (error as { code?: string }).code ?? 'unknown'
    }`,
  );
  process.exitCode = 1;
}
