import { z } from 'zod';

/** Agent 可提议的持久 Canvas 输出闭集；身份和作用域不得进入该契约。 */
export const artifactProposalKinds = [
  'markdown_document',
  'mind_map',
  'slides',
  'flashcards',
  'picturebook',
  'note',
  'web_app',
] as const;

export const artifactProposalKindSchema = z.enum(artifactProposalKinds);

export const artifactProposalSchema = z
  .object({
    kind: artifactProposalKindSchema,
    title: z.string().trim().min(1).max(120),
    instruction: z.string().trim().min(1).max(2_000),
  })
  .strict();

export type ArtifactProposalKind = z.infer<typeof artifactProposalKindSchema>;
export type ArtifactProposal = z.infer<typeof artifactProposalSchema>;
