import 'server-only';

import { createHash } from 'node:crypto';

function canonicalJson(value: unknown, seen = new WeakSet<object>()): string {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('prompt_hash_non_finite');
    return JSON.stringify(value);
  }
  if (typeof value !== 'object') throw new Error('prompt_hash_non_json');
  if (seen.has(value)) throw new Error('prompt_hash_cycle');
  seen.add(value);
  const serialized = Array.isArray(value)
    ? `[${value.map((item) => canonicalJson(item, seen)).join(',')}]`
    : `{${Object.keys(value as Record<string, unknown>)
        .sort()
        .map(
          (key) =>
            `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key], seen)}`,
        )
        .join(',')}}`;
  seen.delete(value);
  return serialized;
}

/** 只持久化不可逆 SHA-256；Prompt、学生正文和工具 Schema 原文不会写入 model_runs。 */
export function hashPromptMaterial(material: unknown): string {
  return createHash('sha256')
    .update(canonicalJson(material), 'utf8')
    .digest('hex');
}
