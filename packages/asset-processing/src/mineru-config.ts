/** EduCanvas 提交契约允许的 MinerU 解析后端。 */
export const mineruBackends = ['hybrid-engine', 'pipeline'] as const;

export type MineruBackend = (typeof mineruBackends)[number];

export interface MineruConfig {
  baseUrl: string;
  /** 缺省时沿用客户端默认值 `hybrid-engine`。 */
  backend?: MineruBackend;
}

/**
 * 从环境变量读取可选的 MinerU 服务边界。
 *
 * URL 缺失时关闭结构化抽取；非法 URL 或显式配置的不支持后端同样安全失效。
 * 空白 backend 按未配置处理，让仓库内环境模板无需预先绑定部署选择。
 */
export function loadMineruConfig(
  env: Record<string, string | undefined>,
): MineruConfig | null {
  const baseUrl = env.MINERU_BASE_URL?.trim();
  if (!baseUrl) return null;

  const configuredBackend = env.MINERU_BACKEND?.trim();
  const backend = mineruBackends.find((value) => value === configuredBackend);
  if (configuredBackend && !backend) return null;

  try {
    const parsed = new URL(baseUrl);
    if (
      !['http:', 'https:'].includes(parsed.protocol) ||
      parsed.username !== '' ||
      parsed.password !== '' ||
      parsed.search !== '' ||
      parsed.hash !== ''
    ) {
      return null;
    }
    return {
      baseUrl: parsed.href.replace(/\/$/, ''),
      ...(backend ? { backend } : {}),
    };
  } catch {
    return null;
  }
}
