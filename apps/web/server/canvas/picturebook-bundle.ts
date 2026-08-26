import 'server-only';

import { LocalObjectStorage } from '@educanvas/agent-runtime';
import {
  PICTUREBOOK_CONTENT_VERSION,
  picturebookContentSchema,
  type PicturebookContent,
} from '@educanvas/canvas-protocol';
import {
  picturebookBundleSchema,
  type PicturebookBundle,
} from '@educanvas/canvas-protocol/server';

export class PicturebookBundleError extends Error {
  override readonly name = 'PicturebookBundleError';
}

interface VerifiedObjectReader {
  readVerified(key: string, expectedChecksum: string): Promise<Uint8Array>;
}

export async function loadPicturebookBundle(input: {
  objectKey: string | null;
  checksum: string | null;
  storage?: VerifiedObjectReader;
}): Promise<PicturebookBundle> {
  if (!input.objectKey || !input.checksum) throw new PicturebookBundleError();
  const bytes = await (input.storage ?? new LocalObjectStorage()).readVerified(
    input.objectKey,
    input.checksum,
  );
  try {
    return picturebookBundleSchema.parse(
      JSON.parse(new TextDecoder().decode(bytes)) as unknown,
    );
  } catch {
    throw new PicturebookBundleError();
  }
}

export function projectPicturebookContent(input: {
  artifactId: string;
  version: number;
  bundle: PicturebookBundle;
}): PicturebookContent {
  return picturebookContentSchema.parse({
    contentVersion: PICTUREBOOK_CONTENT_VERSION,
    pages: input.bundle.pages.map((page, index) => ({
      captionText: page.captionText,
      imageUrl: `/api/v1/chat/artifacts/${encodeURIComponent(input.artifactId)}/picturebook/pages/${index + 1}?version=${input.version}`,
    })),
  });
}

export function readPicturebookPage(
  bundle: PicturebookBundle,
  pageNumber: number,
): { bytes: Uint8Array; contentType: string } {
  const page = bundle.pages[pageNumber - 1];
  if (!page) throw new PicturebookBundleError();
  const bytes = new Uint8Array(Buffer.from(page.image.bytesBase64, 'base64'));
  if (bytes.byteLength !== page.image.byteSize) {
    throw new PicturebookBundleError();
  }
  return { bytes, contentType: page.image.contentType };
}
