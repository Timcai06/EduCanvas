import { z } from 'zod';

/**
 * 用户对本轮呈现形态的非可信偏好。它可以影响 Profile 提示，但绝不授予 Tool、
 * Provider、Runtime、数据或写入权限。
 */
export const outputPreferences = [
  'auto',
  'markdown_document',
  'interactive_artifact',
  'web_app',
] as const;

export const outputPreferenceSchema = z.enum(outputPreferences);
export type OutputPreference = z.infer<typeof outputPreferenceSchema>;

/** 旧 Web 客户端的 canvas 值保留为输入 alias，领域层只传播 canonical 值。 */
export function normalizeOutputPreference(
  value: unknown,
): OutputPreference | undefined | null {
  if (value === undefined) return undefined;
  if (value === 'canvas') return 'interactive_artifact';
  const parsed = outputPreferenceSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
