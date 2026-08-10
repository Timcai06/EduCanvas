import { z } from 'zod';

export const experienceModeSchema = z.enum(['general', 'restricted']);
export type ExperienceMode = z.infer<typeof experienceModeSchema>;

export const experienceModeSelectionSchema = z
  .object({
    mode: experienceModeSchema,
    guardianConfirmed: z.boolean().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.mode === 'general' && value.guardianConfirmed !== true) {
      context.addIssue({
        code: 'custom',
        path: ['guardianConfirmed'],
        message: 'general mode requires guardian confirmation',
      });
    }
  });
