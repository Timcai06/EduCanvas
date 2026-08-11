import { describe, expect, it } from 'vitest';
import { assetPreviewSchema } from './asset-preview-contract';

describe('assetPreviewSchema', () => {
  it('accepts only bounded same-origin projections', () => {
    expect(
      assetPreviewSchema.safeParse({
        kind: 'pdf',
        fileName: 'lesson.pdf',
        mimeType: 'application/pdf',
        fileUrl:
          '/api/v1/chat/assets/11111111-1111-4111-8111-111111111111/file',
      }).success,
    ).toBe(true);
    expect(
      assetPreviewSchema.safeParse({
        kind: 'pdf',
        fileName: 'lesson.pdf',
        mimeType: 'application/pdf',
        fileUrl: 'https://storage.example/secret-key',
      }).success,
    ).toBe(false);
    expect(
      assetPreviewSchema.safeParse({
        kind: 'markdown',
        fileName: 'large.md',
        mimeType: 'text/markdown',
        content: 'x'.repeat(120_001),
      }).success,
    ).toBe(false);
    expect(
      assetPreviewSchema.safeParse({
        kind: 'audio',
        fileName: 'lesson.wav',
        mimeType: 'audio/wav',
        fileUrl:
          '/api/v1/chat/assets/11111111-1111-4111-8111-111111111111/file',
        transcription: {
          text: '课堂转录',
          language: 'zh',
          durationSeconds: 30,
        },
      }).success,
    ).toBe(true);
    expect(
      assetPreviewSchema.safeParse({
        kind: 'audio',
        fileName: 'lesson.wav',
        mimeType: 'audio/wav',
        fileUrl:
          '/api/v1/chat/assets/11111111-1111-4111-8111-111111111111/file',
        transcription: {
          text: '课堂转录',
          durationSeconds: 3_601,
          providerResponse: { raw: true },
        },
      }).success,
    ).toBe(false);
    expect(
      assetPreviewSchema.safeParse({
        kind: 'video',
        fileName: 'lesson.mp4',
        mimeType: 'video/mp4',
        fileUrl:
          '/api/v1/chat/assets/11111111-1111-4111-8111-111111111111/file',
        transcription: {
          text: '视频课堂转录',
          language: 'zh',
          durationSeconds: 120,
        },
        derivatives: {
          transcription: 'ready',
          keyframes: 'failed',
        },
      }).success,
    ).toBe(true);
  });

  it('docx 阅读视图接受结构化表示与同源原件下载 URL', () => {
    expect(
      assetPreviewSchema.safeParse({
        kind: 'docx',
        fileName: '讲义.docx',
        mimeType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml',
        content: '',
        representation: {
          quality: 'structured',
          markdown:
            '![图](/api/v1/chat/assets/11111111-1111-4111-8111-111111111111/resources/images/001.jpg)',
        },
        downloadUrl:
          '/api/v1/chat/assets/11111111-1111-4111-8111-111111111111/file?download=1',
      }).success,
    ).toBe(true);
    /* 降级/无表示时 representation 为 null，仍保留下载入口。 */
    expect(
      assetPreviewSchema.safeParse({
        kind: 'docx',
        fileName: '讲义.docx',
        mimeType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml',
        content: '<p>正文</p>',
        representation: { quality: 'degraded_plain_text' },
        downloadUrl:
          '/api/v1/chat/assets/11111111-1111-4111-8111-111111111111/file?download=1',
      }).success,
    ).toBe(true);
  });

  it('docx 拒绝外部下载 URL 与未知质量枚举', () => {
    expect(
      assetPreviewSchema.safeParse({
        kind: 'docx',
        fileName: '讲义.docx',
        mimeType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml',
        content: '',
        downloadUrl: 'https://storage.example/secret-key',
      }).success,
    ).toBe(false);
    expect(
      assetPreviewSchema.safeParse({
        kind: 'docx',
        fileName: '讲义.docx',
        mimeType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml',
        content: '',
        representation: { quality: 'shiny' },
        downloadUrl:
          '/api/v1/chat/assets/11111111-1111-4111-8111-111111111111/file?download=1',
      }).success,
    ).toBe(false);
  });
});
