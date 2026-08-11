import { z } from 'zod';
import { canvasResourceKindSchema } from './resource';

export const canvasAnnotationPens = ['dai', 'zhusha'] as const;
export const canvasAnnotationKinds = [
  'circle',
  'underline',
  'strike',
  'note',
  'seal',
] as const;
export const canvasAnnotationSources = ['voice', 'canvas', 'chat'] as const;

export const canvasAnnotationGeometrySchema = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().min(0).max(1).optional(),
    height: z.number().min(0).max(1).optional(),
    page: z.number().int().positive().optional(),
  })
  .strict()
  .superRefine((geometry, context) => {
    if (geometry.width !== undefined && geometry.x + geometry.width > 1) {
      context.addIssue({
        code: 'custom',
        path: ['width'],
        message: '批注横向范围不能越出资源边界',
      });
    }
    if (geometry.height !== undefined && geometry.y + geometry.height > 1) {
      context.addIssue({
        code: 'custom',
        path: ['height'],
        message: '批注纵向范围不能越出资源边界',
      });
    }
  });

export const createCanvasAnnotationSchema = z
  .object({
    kind: z.enum(canvasAnnotationKinds),
    geometry: canvasAnnotationGeometrySchema,
    body: z.string().trim().min(1).max(2_000).nullable().optional(),
    source: z.enum(canvasAnnotationSources),
    resourceVersionId: z.string().uuid().nullable().optional(),
  })
  .strict()
  .superRefine((annotation, context) => {
    if (annotation.kind === 'note' && !annotation.body) {
      context.addIssue({
        code: 'custom',
        path: ['body'],
        message: 'note 批注必须包含正文',
      });
    }
  });

export const canvasAnnotationSchema = z
  .object({
    id: z.string().uuid(),
    notebookId: z.string().min(1).max(128),
    resourceKind: canvasResourceKindSchema,
    resourceId: z.string().uuid(),
    resourceVersionId: z.string().uuid().nullable(),
    authorPen: z.enum(canvasAnnotationPens),
    kind: z.enum(canvasAnnotationKinds),
    geometry: canvasAnnotationGeometrySchema,
    body: z.string().max(2_000).nullable(),
    source: z.enum(canvasAnnotationSources),
    createdAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export type CanvasAnnotation = z.infer<typeof canvasAnnotationSchema>;
export type CanvasAnnotationGeometry = z.infer<
  typeof canvasAnnotationGeometrySchema
>;
export type CanvasAnnotationKind = (typeof canvasAnnotationKinds)[number];
export type CanvasAnnotationSource = (typeof canvasAnnotationSources)[number];
export type CreateCanvasAnnotation = z.infer<
  typeof createCanvasAnnotationSchema
>;
