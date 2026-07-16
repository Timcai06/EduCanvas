import { z } from 'zod';
import { assetVersionReferenceSchema } from './asset-contracts';
import type { AssetKind } from './asset-contracts';

const opaqueIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

export const agentMessageRoles = [
  'system',
  'user',
  'assistant',
  'tool',
] as const;
export const agentMessageRoleSchema = z.enum(agentMessageRoles);
export type AgentMessageRole = z.infer<typeof agentMessageRoleSchema>;

export const agentTextPartSchema = z
  .object({
    type: z.literal('text'),
    text: z
      .string()
      .min(1)
      .max(64_000)
      .refine((value) => value.trim().length > 0, '文本Part不能为空白'),
  })
  .strict();

export const agentAssetPartSchema = z
  .object({
    type: z.literal('asset_ref'),
    reference: assetVersionReferenceSchema,
    usage: z.enum(['attachment', 'context']),
  })
  .strict();

/** 生成的视频、Slide或交互产物通过引用回到对话，而不是塞入消息正文。 */
export const agentArtifactPartSchema = z
  .object({
    type: z.literal('artifact_ref'),
    artifactId: opaqueIdSchema,
    versionId: opaqueIdSchema,
    kind: z.enum([
      'image',
      'audio',
      'video',
      'slide',
      'interactive',
      'document',
    ]),
  })
  .strict();

export const agentMessagePartSchema = z.discriminatedUnion('type', [
  agentTextPartSchema,
  agentAssetPartSchema,
  agentArtifactPartSchema,
]);

export type AgentMessagePart = z.infer<typeof agentMessagePartSchema>;
export type AgentTextPart = z.infer<typeof agentTextPartSchema>;
export type AgentAssetPart = z.infer<typeof agentAssetPartSchema>;
export type AgentArtifactPart = z.infer<typeof agentArtifactPartSchema>;

export const agentMessageInputSchema = z
  .object({
    clientMessageId: opaqueIdSchema,
    parts: z.array(agentMessagePartSchema).min(1).max(32),
  })
  .strict()
  .superRefine((message, context) => {
    const textLength = message.parts.reduce(
      (total, part) => total + (part.type === 'text' ? part.text.length : 0),
      0,
    );
    if (textLength > 64_000) {
      context.addIssue({
        code: 'custom',
        path: ['parts'],
        message: '消息文本总长度不能超过64000字符',
      });
    }

    const references = new Set<string>();
    for (const part of message.parts) {
      if (part.type !== 'asset_ref') continue;
      const key = `${part.reference.assetId}:${part.reference.versionId}`;
      if (references.has(key)) {
        context.addIssue({
          code: 'custom',
          path: ['parts'],
          message: '同一资产版本不能在消息中重复引用',
        });
      }
      references.add(key);
    }
  });

export type AgentMessageInput = z.infer<typeof agentMessageInputSchema>;

/** 规范化只处理文本，不改写资产或产物引用。 */
export function normalizeAgentMessageParts(
  parts: readonly AgentMessagePart[],
): AgentMessagePart[] {
  return parts.map((part) =>
    part.type === 'text'
      ? {
          ...part,
          text: part.text.normalize('NFC').replace(/\r\n?/g, '\n').trim(),
        }
      : part,
  );
}

export function extractAgentMessageText(
  parts: readonly AgentMessagePart[],
): string {
  return parts
    .filter((part): part is AgentTextPart => part.type === 'text')
    .map((part) => part.text)
    .join('\n');
}

export function referencedAssetVersions(parts: readonly AgentMessagePart[]) {
  return parts.flatMap((part) =>
    part.type === 'asset_ref' ? [part.reference] : [],
  );
}

/** 供能力矩阵和路由层使用，不代表当前供应商已经支持该模态。 */
export function referencedAssetKinds(
  parts: readonly AgentMessagePart[],
): AssetKind[] {
  return [...new Set(referencedAssetVersions(parts).map((item) => item.kind))];
}
