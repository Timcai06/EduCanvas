import { describe, expect, it } from 'vitest';
import {
  WEB_APP_CAPABILITIES,
  WEB_APP_MEDIA_TYPES,
  webAppContentSchema,
  WEB_APP_DIAGNOSTIC_CODES,
} from './web-runtime-artifact';

describe('web app runtime artifact schema', () => {
  it('accepts strict manifest payload and rejects unknown media types', () => {
    const sample = {
      schemaVersion: 1,
      manifest: {
        entry: 'index.html',
        files: [
          {
            path: 'index.html',
            mediaType: WEB_APP_MEDIA_TYPES[0],
            content: '<div />',
            hash: 'a'.repeat(64),
          },
        ],
      },
      lockedDependencies: [],
      capabilities: [WEB_APP_CAPABILITIES[0]],
      budget: {
        maxInputBytes: 1_000,
        maxMessageBytes: 1_000,
        maxOutputBytes: 1_000,
        maxDurationMs: 1_000,
        maxConcurrentInstances: 1,
        maxQueueDepth: 1,
        maxMessagesPerSecond: 1,
      },
      diagnostics: [{ code: WEB_APP_DIAGNOSTIC_CODES[0] }],
      generatedByModel: false,
    };
    const parsed = webAppContentSchema.safeParse({
      ...sample,
      manifest: {
        ...sample.manifest,
        files: [
          ...sample.manifest.files,
          {
            path: 'styles.css',
            mediaType: 'text/plain',
            content: 'x',
            hash: 'a'.repeat(64),
          },
        ],
      },
    });
    expect(parsed.success).toBe(false);
    expect(webAppContentSchema.safeParse(sample).success).toBe(true);
  });

  it('allows empty lockedDependencies for first-pass self-contained payloads', () => {
    const parsed = webAppContentSchema.safeParse({
      schemaVersion: 1,
      manifest: {
        entry: 'index.html',
        files: [
          {
            path: 'index.html',
            mediaType: WEB_APP_MEDIA_TYPES[0],
            content: '<div />',
            hash: 'a'.repeat(64),
          },
        ],
      },
      lockedDependencies: [],
      capabilities: [WEB_APP_CAPABILITIES[0]],
      budget: {
        maxInputBytes: 1_000,
        maxMessageBytes: 1_000,
        maxOutputBytes: 1_000,
        maxDurationMs: 1_000,
        maxConcurrentInstances: 1,
        maxQueueDepth: 1,
        maxMessagesPerSecond: 1,
      },
      diagnostics: [{ code: WEB_APP_DIAGNOSTIC_CODES[0] }],
      generatedByModel: false,
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects non-empty lockedDependencies until a local loader is versioned', () => {
    const parsed = webAppContentSchema.safeParse({
      schemaVersion: 1,
      manifest: {
        entry: 'index.html',
        files: [
          {
            path: 'index.html',
            mediaType: WEB_APP_MEDIA_TYPES[0],
            content: '<div />',
            hash: 'a'.repeat(64),
          },
        ],
      },
      lockedDependencies: [{ name: 'react', version: '19.2.7' }],
      capabilities: [WEB_APP_CAPABILITIES[0]],
      budget: {
        maxInputBytes: 1_000,
        maxMessageBytes: 1_000,
        maxOutputBytes: 1_000,
        maxDurationMs: 1_000,
        maxConcurrentInstances: 1,
        maxQueueDepth: 1,
        maxMessagesPerSecond: 1,
      },
      diagnostics: [],
      generatedByModel: false,
    });
    expect(parsed.success).toBe(false);
  });

  it('keeps diagnostics to stable codes and enforces no unknown fields', () => {
    const schema = webAppContentSchema.safeParse({
      schemaVersion: 1,
      manifest: {
        entry: 'index.html',
        files: [
          {
            path: 'index.html',
            mediaType: WEB_APP_MEDIA_TYPES[0],
            content: '<div />',
            hash: 'a'.repeat(64),
          },
        ],
      },
      lockedDependencies: [{ name: 'react', version: '19.2.7' }],
      capabilities: [WEB_APP_CAPABILITIES[0]],
      budget: {
        maxInputBytes: 1_000,
        maxMessageBytes: 1_000,
        maxOutputBytes: 1_000,
        maxDurationMs: 1_000,
        maxConcurrentInstances: 1,
        maxQueueDepth: 1,
        maxMessagesPerSecond: 1,
      },
      diagnostics: [{ code: WEB_APP_DIAGNOSTIC_CODES[0] }],
      generatedByModel: true,
      extra: 'unexpected',
    });
    expect(schema.success).toBe(false);
  });

  it('rejects external URLs, traversal paths, and secret-bearing manifest fields', () => {
    const baseFile = {
      path: 'index.html',
      mediaType: WEB_APP_MEDIA_TYPES[0],
      content: '<div />',
      hash: 'a'.repeat(64),
    };
    const base = {
      schemaVersion: 1,
      manifest: { entry: 'index.html', files: [baseFile] },
      lockedDependencies: [],
      capabilities: [WEB_APP_CAPABILITIES[0]],
      budget: {
        maxInputBytes: 1_000,
        maxMessageBytes: 1_000,
        maxOutputBytes: 1_000,
        maxDurationMs: 1_000,
        maxConcurrentInstances: 1,
        maxQueueDepth: 1,
        maxMessagesPerSecond: 1,
      },
      diagnostics: [],
      generatedByModel: true,
    };

    for (const path of [
      'https://attacker.invalid/app.js',
      '../secret.txt',
      '/absolute/index.html',
      'nested/../../secret.txt',
      'C:\\secret.txt',
    ]) {
      expect(
        webAppContentSchema.safeParse({
          ...base,
          manifest: { ...base.manifest, files: [{ ...baseFile, path }] },
        }).success,
      ).toBe(false);
    }

    for (const hostileField of [
      { objectKey: 'private/web-app/index.html' },
      { prompt: 'system prompt' },
      { providerBody: { raw: true } },
      { secret: 'do-not-expose' },
    ]) {
      expect(
        webAppContentSchema.safeParse({
          ...base,
          manifest: { ...base.manifest, ...hostileField },
        }).success,
      ).toBe(false);
    }
  });
});
