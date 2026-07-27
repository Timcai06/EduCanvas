import { z } from 'zod';
import {
  canvasRepresentationKindSchema,
  canvasResourceActionSchema,
  canvasRuntimeKindSchema,
  canvasTrustTierSchema,
  type CanvasResource,
} from './resource';

export const CANVAS_RENDERER_MANIFEST_VERSION = 1 as const;

/**
 * Renderer Manifest只声明兼容能力，不能包含组件、URL、动态代码或权限。
 * Web/TUI可用它做确定性选择，但资源动作仍以服务端CanvasResource为上限。
 */
export const canvasRendererManifestSchema = z
  .object({
    manifestVersion: z.literal(CANVAS_RENDERER_MANIFEST_VERSION),
    rendererId: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[a-z0-9][a-z0-9.-]*$/),
    rendererVersion: z.number().int().positive().max(10_000),
    representations: z.array(canvasRepresentationKindSchema).min(1).max(16),
    trustTiers: z.array(canvasTrustTierSchema).min(1).max(3),
    runtimeKinds: z.array(canvasRuntimeKindSchema).min(1).max(3),
    supportedActions: z.array(canvasResourceActionSchema).max(16),
  })
  .strict()
  .superRefine((value, context) => {
    for (const field of [
      'representations',
      'trustTiers',
      'runtimeKinds',
      'supportedActions',
    ] as const) {
      if (new Set(value[field]).size !== value[field].length) {
        context.addIssue({
          code: 'custom',
          path: [field],
          message: `${field}不能重复`,
        });
      }
    }
  });

export type CanvasRendererManifest = z.infer<
  typeof canvasRendererManifestSchema
>;

/**
 * 判断声明式Renderer是否能处理资源；这里只验证兼容性，不执行鉴权或加载内容。
 */
export function rendererSupportsResource(
  manifest: CanvasRendererManifest,
  resource: CanvasResource,
): boolean {
  return (
    manifest.rendererId === resource.renderer.rendererId &&
    manifest.rendererVersion === resource.renderer.rendererVersion &&
    manifest.representations.includes(resource.representation.kind) &&
    manifest.trustTiers.includes(resource.trustTier) &&
    manifest.runtimeKinds.includes(resource.runtime.kind) &&
    resource.allowedActions.every((action) =>
      manifest.supportedActions.includes(action),
    )
  );
}
