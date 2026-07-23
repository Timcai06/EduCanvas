import { z } from 'zod';
import { gatewayOpaqueIdSchema } from './common';

export const gatewayCitationTargetSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('knowledge'),
      sourceId: gatewayOpaqueIdSchema,
      documentId: gatewayOpaqueIdSchema,
      chunkId: gatewayOpaqueIdSchema,
      pageStart: z.number().int().positive().nullable(),
      pageEnd: z.number().int().positive().nullable(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('web'),
      assetId: gatewayOpaqueIdSchema,
      assetVersionId: gatewayOpaqueIdSchema,
      url: z
        .string()
        .url()
        .refine((value) => /^https?:\/\//.test(value)),
    })
    .strict(),
  z
    .object({
      kind: z.literal('asset'),
      assetId: gatewayOpaqueIdSchema,
      assetVersionId: gatewayOpaqueIdSchema,
    })
    .strict(),
]);

export const gatewayCitationSchema = z
  .object({
    citationId: gatewayOpaqueIdSchema,
    marker: z.number().int().min(1).max(99).optional(),
    label: z.string().trim().min(1).max(300),
    target: gatewayCitationTargetSchema,
  })
  .strict();

export type GatewayCitation = z.infer<typeof gatewayCitationSchema>;
