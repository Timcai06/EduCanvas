import { z } from 'zod';
import { McpInvocationError, McpRemoteToolError } from './errors';
import { cloneBoundedJson, type JsonValue } from './json-limits';

const MAX_TEXT_ITEMS = 8;
const MAX_TEXT_ITEM_BYTES = 16 * 1024;
const MAX_TOTAL_TEXT_BYTES = 64 * 1024;
const STRUCTURED_CONTENT_LIMITS = {
  maxBytes: 64 * 1024,
  maxDepth: 24,
  maxArrayItems: 1_024,
  maxObjectKeys: 1_024,
} as const;

export interface McpSafeToolOutput {
  untrusted: true;
  text: readonly string[];
  structuredContent?: { readonly [key: string]: JsonValue };
}

export const mcpSafeToolOutputSchema: z.ZodType<McpSafeToolOutput> = z
  .object({
    untrusted: z.literal(true),
    text: z.array(z.string()).max(MAX_TEXT_ITEMS),
    structuredContent: z.unknown().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const textBytes = value.text.reduce(
      (total, item) => total + Buffer.byteLength(item, 'utf8'),
      0,
    );
    if (
      textBytes > MAX_TOTAL_TEXT_BYTES ||
      value.text.some(
        (item) => Buffer.byteLength(item, 'utf8') > MAX_TEXT_ITEM_BYTES,
      )
    ) {
      context.addIssue({ code: 'custom', message: 'mcp_output_too_large' });
    }
    if (value.structuredContent !== undefined) {
      try {
        if (!isRecord(value.structuredContent)) throw new Error();
        cloneBoundedJson(value.structuredContent, STRUCTURED_CONTENT_LIMITS);
      } catch {
        context.addIssue({ code: 'custom', message: 'mcp_output_too_large' });
      }
    }
  }) as z.ZodType<McpSafeToolOutput>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeStructuredContent(
  value: unknown,
): { readonly [key: string]: JsonValue } | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new McpInvocationError('protocol');
  return cloneBoundedJson(value, STRUCTURED_CONTENT_LIMITS) as {
    readonly [key: string]: JsonValue;
  };
}

/** 远端结果一律标为不可信，只保留有界文本和JSON；媒体/资源先诚实拒绝。 */
export function sanitizeMcpToolResult(result: unknown): McpSafeToolOutput {
  if (!isRecord(result) || !Array.isArray(result.content)) {
    throw new McpInvocationError('protocol');
  }
  if (result.isError === true) throw new McpRemoteToolError();
  if (result.content.length > MAX_TEXT_ITEMS) {
    throw new McpInvocationError('protocol');
  }
  const text: string[] = [];
  for (const item of result.content) {
    if (
      !isRecord(item) ||
      item.type !== 'text' ||
      typeof item.text !== 'string'
    ) {
      throw new McpInvocationError('protocol');
    }
    if (Buffer.byteLength(item.text, 'utf8') > MAX_TEXT_ITEM_BYTES) {
      throw new McpInvocationError('protocol');
    }
    text.push(item.text);
  }
  if (
    text.reduce((total, item) => total + Buffer.byteLength(item, 'utf8'), 0) >
    MAX_TOTAL_TEXT_BYTES
  ) {
    throw new McpInvocationError('protocol');
  }
  try {
    const structuredContent = sanitizeStructuredContent(
      result.structuredContent,
    );
    return structuredContent === undefined
      ? { untrusted: true, text }
      : { untrusted: true, text, structuredContent };
  } catch {
    throw new McpInvocationError('protocol');
  }
}
