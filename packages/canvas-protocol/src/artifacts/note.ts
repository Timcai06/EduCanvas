import { z } from 'zod';

/** note 内容版本，初始为 1 */
export const NOTE_CONTENT_VERSION = 1;

export const noteContentSchema = z
  .object({
    contentVersion: z.literal(NOTE_CONTENT_VERSION),
    markdown: z.string(),
    sourceConversationId: z.string().optional(),
    generatedByModel: z.boolean(),
  })
  .strict();

export type NoteContent = z.infer<typeof noteContentSchema>;
