/**
 * 演示前环境自检。
 *
 * 录像或答辩前跑一次，确认演示要用的能力今天还活着。只报告**实际验证过的事实**，
 * 不做推断：探测不到就写 `unknown`，而不是猜一个 ok。
 *
 *   pnpm demo:check
 *
 * 退出码：全部 ok 为 0；任一 fail 为 1（warn 不影响退出码）。
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTavilyAdapter } from '../../../apps/web/server/tools/tavily-adapter';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

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

type Level = 'ok' | 'warn' | 'fail' | 'unknown';
interface Check {
  readonly name: string;
  readonly level: Level;
  readonly detail: string;
}

const checks: Check[] = [];
const add = (name: string, level: Level, detail: string) =>
  checks.push({ name, level, detail });

loadDotEnv();

/* 1. 模型 Provider —— 演示的讲解依赖它。只检查配置完整性：真实调用要花钱，
   且失败原因可能是额度而非可用性，不适合放进每次自检。 */
const modelProvider = process.env.MODEL_GATEWAY_PROVIDER?.trim();
const modelKey = process.env.MODEL_GATEWAY_API_KEY?.trim();
if (modelProvider && modelKey) {
  add('模型 Provider', 'ok', `已配置（${modelProvider}）`);
} else {
  add(
    '模型 Provider',
    'fail',
    '未配置 MODEL_GATEWAY_PROVIDER / MODEL_GATEWAY_API_KEY——演示时老师无法回答',
  );
}

/* 2. 数据库 —— 掌握度与学习事件的事实源。 */
const databaseUrl = process.env.DATABASE_URL?.trim();
add(
  '数据库配置',
  databaseUrl ? 'ok' : 'fail',
  databaseUrl ? '已配置 DATABASE_URL' : '未配置 DATABASE_URL',
);

/* 3. web-runtime 跨站边界 —— web_app 产物在演示中启动失败就是这里没配对。
   端口不参与 site 判定，仅换端口不构成边界，所以必须真算一次。 */
function schemefulSite(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const host = url.hostname;
    const registrable =
      host === 'localhost' ||
      /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) ||
      host.includes(':')
        ? host
        : host.toLowerCase().split('.').slice(-2).join('.');
    return `${url.protocol}//${registrable}`;
  } catch {
    return null;
  }
}
const webSite = schemefulSite(
  process.env.EDUCANVAS_WEB_PUBLIC_ORIGIN ?? 'http://127.0.0.1:3000',
);
const runtimeSite = schemefulSite(
  process.env.EDUCANVAS_WEB_RUNTIME_PUBLIC_ORIGIN ?? 'http://localhost:3300',
);
if (!webSite || !runtimeSite) {
  add('web_app 跨站边界', 'fail', 'origin 解析失败');
} else if (webSite === runtimeSite) {
  add(
    'web_app 跨站边界',
    'fail',
    `Web 与 Runtime 同属 ${webSite}——runtime 会拒绝启动，web_app 产物无法运行`,
  );
} else {
  add('web_app 跨站边界', 'ok', `${webSite} ≠ ${runtimeSite}`);
}

/* 4. 语音（可选能力，缺失只降级不阻塞演示）。 */
const dashscope = process.env.DASHSCOPE_API_KEY?.trim();
add(
  'Live Voice / 语音',
  dashscope ? 'ok' : 'warn',
  dashscope ? '已配置 DASHSCOPE_API_KEY' : '未配置——演示中不要走语音环节',
);

/* 5. 真实搜索 Provider —— 深度研究环节的前提，实打一次。 */
const searchKey = process.env.SEARCH_API_KEY?.trim();
if (!searchKey) {
  add(
    '搜索 Provider',
    'warn',
    '未配置——深度研究入口会诚实禁用，勿在演示中展示',
  );
} else {
  const startedAt = Date.now();
  try {
    const response = await createTavilyAdapter({ apiKey: searchKey }).search({
      query: '光合作用的研究进展',
      limit: 5,
    });
    const results = Array.isArray(response)
      ? response
      : ((response as { results?: readonly unknown[] }).results ?? []);
    const elapsed = Date.now() - startedAt;
    if (results.length >= 5) {
      add('搜索 Provider', 'ok', `${results.length} 条结果 · ${elapsed}ms`);
    } else {
      add(
        '搜索 Provider',
        'warn',
        `仅 ${results.length} 条结果 · ${elapsed}ms——深度研究的五源要求可能不达标`,
      );
    }
  } catch (error) {
    add('搜索 Provider', 'fail', `检索失败：${(error as Error).name}`);
  }
}

const MARK: Record<Level, string> = {
  ok: '✓',
  warn: '!',
  fail: '✗',
  unknown: '?',
};
const width = Math.max(...checks.map((c) => c.name.length));
process.stdout.write('\nEduCanvas · 演示前自检\n\n');
for (const c of checks) {
  process.stdout.write(
    `  ${MARK[c.level]}  ${c.name.padEnd(width)}  ${c.detail}\n`,
  );
}

const failed = checks.filter((c) => c.level === 'fail');
const warned = checks.filter((c) => c.level === 'warn');
process.stdout.write(
  `\n  ${failed.length} 项阻塞 · ${warned.length} 项提醒 · 共 ${checks.length} 项\n`,
);
process.stdout.write(
  '\n  本自检只覆盖配置与可达性。渲染路径请跑 pnpm demo:walkthrough；\n' +
    '  真实模型质量、真人语音与多机环境不在覆盖范围内。\n\n',
);
if (failed.length > 0) process.exitCode = 1;
