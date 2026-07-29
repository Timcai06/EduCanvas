import type {
  AudioOverviewMedia,
  GeneratedImageMedia,
} from './artifact-client';

export const AUDIO_SUMMARY_MAX_CHARS = 300;
export const IMAGE_SUMMARY_MAX_CHARS = 200;

export function buildAudioSummary(
  title: string,
  media: AudioOverviewMedia,
): string {
  const parts = [title, `基于 ${media.sourceCount} 项来源`];
  if (media.transcript) {
    const preview = media.transcript.slice(0, 120);
    const suffix = media.transcript.length > 120 ? '…' : '';
    parts.push(`${preview}${suffix}`);
  }
  const summary = parts.join(' · ');
  return summary.length > AUDIO_SUMMARY_MAX_CHARS
    ? `${summary.slice(0, AUDIO_SUMMARY_MAX_CHARS - 1)}…`
    : summary;
}

export function buildImageSummary(
  title: string,
  media: GeneratedImageMedia,
): string {
  const parts = [title, `${media.size} 像素`];
  const format = media.contentType.split('/')[1]?.toUpperCase();
  if (format) parts.push(format);
  const summary = parts.join(' · ');
  return summary.length > IMAGE_SUMMARY_MAX_CHARS
    ? `${summary.slice(0, IMAGE_SUMMARY_MAX_CHARS - 1)}…`
    : summary;
}
