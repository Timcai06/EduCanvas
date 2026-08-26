import 'server-only';

import {
  audioOverviewMetadataSchema,
  generatedImageMetadataSchema,
} from '@educanvas/canvas-protocol';
import type { PlatformArtifactVersion } from '@educanvas/db';
import {
  loadPicturebookBundle,
  projectPicturebookContent,
} from './picturebook-bundle';

/** 将私有 Artifact Version 收敛为浏览器安全的正文与媒体读取地址。 */
export async function projectArtifactVersionForBrowser(input: {
  artifactId: string;
  kind: string;
  version: PlatformArtifactVersion;
  canDownload: boolean;
}): Promise<{ content: unknown; media: Record<string, unknown> | null }> {
  if (input.kind === 'picturebook') {
    return {
      content: projectPicturebookContent({
        artifactId: input.artifactId,
        version: input.version.version,
        bundle: await loadPicturebookBundle({
          objectKey: input.version.objectKey,
          checksum: input.version.checksum,
        }),
      }),
      media: null,
    };
  }
  const audio =
    input.kind === 'audio_overview'
      ? audioOverviewMetadataSchema.safeParse(input.version.metadata)
      : null;
  if (audio?.success) {
    return {
      content: input.version.content,
      media: {
        url: `/api/v1/chat/artifacts/${encodeURIComponent(input.artifactId)}/audio`,
        ...(input.canDownload
          ? {
              downloadUrl: `/api/v1/chat/artifacts/${encodeURIComponent(input.artifactId)}/download`,
            }
          : {}),
        ...audio.data,
      },
    };
  }
  const image =
    input.kind === 'generated_image'
      ? generatedImageMetadataSchema.safeParse(input.version.metadata)
      : null;
  if (image?.success) {
    return {
      content: input.version.content,
      media: {
        url: `/api/v1/chat/artifacts/${encodeURIComponent(input.artifactId)}/image`,
        ...(input.canDownload
          ? {
              downloadUrl: `/api/v1/chat/artifacts/${encodeURIComponent(input.artifactId)}/download`,
            }
          : {}),
        ...image.data,
      },
    };
  }
  return { content: input.version.content, media: null };
}
