export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export interface JsonLimits {
  maxBytes: number;
  maxDepth: number;
  maxArrayItems: number;
  maxObjectKeys: number;
}

export class McpJsonLimitError extends Error {
  override readonly name = 'McpJsonLimitError';
}

function isPlainObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function visit(
  value: unknown,
  limits: JsonLimits,
  depth: number,
  seen: WeakSet<object>,
): asserts value is JsonValue {
  if (depth > limits.maxDepth) throw new McpJsonLimitError();
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new McpJsonLimitError();
    return;
  }
  if (typeof value !== 'object' || seen.has(value)) {
    throw new McpJsonLimitError();
  }
  seen.add(value);
  if (Array.isArray(value)) {
    if (value.length > limits.maxArrayItems) throw new McpJsonLimitError();
    for (const child of value) visit(child, limits, depth + 1, seen);
  } else {
    if (!isPlainObject(value)) throw new McpJsonLimitError();
    const entries = Object.entries(value);
    if (entries.length > limits.maxObjectKeys) throw new McpJsonLimitError();
    for (const [key, child] of entries) {
      if (key.length > 256) throw new McpJsonLimitError();
      visit(child, limits, depth + 1, seen);
    }
  }
  seen.delete(value);
}

/** 验证值是有界JSON，并返回无原型/访问器的深拷贝。 */
export function cloneBoundedJson(
  value: unknown,
  limits: JsonLimits,
): JsonValue {
  visit(value, limits, 0, new WeakSet());
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, 'utf8') > limits.maxBytes) {
    throw new McpJsonLimitError();
  }
  return JSON.parse(serialized) as JsonValue;
}

function canonicalize(value: JsonValue): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(',')}]`;
  }
  const objectValue = value as { readonly [key: string]: JsonValue };
  return `{${Object.keys(objectValue)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(objectValue[key]!)}`)
    .join(',')}}`;
}

export function canonicalBoundedJson(
  value: unknown,
  limits: JsonLimits,
): string {
  return canonicalize(cloneBoundedJson(value, limits));
}
