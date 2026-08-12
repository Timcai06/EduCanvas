import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { compileRuntimePayload } from './host-page';
import type { WebAppContent } from '@educanvas/canvas-protocol/server';

const hash = (value: string) =>
  createHash('sha256').update(value, 'utf8').digest('hex');

describe('web app bootstrap payload compiler', () => {
  it('returns the legacy payload unchanged for dom_exploration', () => {
    const content = {
      schemaVersion: 1 as const,
      html: '<h1>demo</h1>',
      css: 'h1{color:red}',
      script: 'console.log(1)',
      dependencies: [] as Array<{ name: string; version: string }>,
    };
    expect(compileRuntimePayload(content)).toEqual({
      html: content.html,
      css: content.css,
      script: content.script,
    });
  });

  it('compiles web_app manifest entry plus css/js files', () => {
    const content: WebAppContent = {
      schemaVersion: 1 as const,
      manifest: {
        entry: 'index.html',
        files: [
          {
            path: 'index.html',
            mediaType: 'text/html',
            content: '<div id="app"></div>',
            hash: hash('<div id="app"></div>'),
          },
          {
            path: 'styles.css',
            mediaType: 'text/css',
            content: 'body{}',
            hash: hash('body{}'),
          },
          {
            path: 'main.js',
            mediaType: 'text/javascript',
            content: 'console.log(1)',
            hash: hash('console.log(1)'),
          },
        ],
      },
      lockedDependencies: [],
      capabilities: ['dom-manipulation', 'css-render', 'javascript-runtime'],
      budget: {
        maxInputBytes: 10_000,
        maxMessageBytes: 1_000,
        maxOutputBytes: 100_000,
        maxDurationMs: 30_000,
        maxConcurrentInstances: 2,
        maxQueueDepth: 8,
        maxMessagesPerSecond: 10,
      },
      diagnostics: [],
      generatedByModel: true,
    };
    expect(compileRuntimePayload(content)).toEqual({
      html: '<div id="app"></div>',
      css: 'body{}',
      script: 'console.log(1)',
    });
  });

  it('rejects duplicate manifest paths at host compile time', () => {
    const content: WebAppContent = {
      schemaVersion: 1 as const,
      manifest: {
        entry: 'index.html',
        files: [
          {
            path: 'index.html',
            mediaType: 'text/html',
            content: '<div>1</div>',
            hash: hash('<div>1</div>'),
          },
          {
            path: 'index.html',
            mediaType: 'text/css',
            content: 'body{}',
            hash: hash('body{}'),
          },
        ],
      },
      lockedDependencies: [],
      capabilities: ['dom-manipulation'],
      budget: {
        maxInputBytes: 10_000,
        maxMessageBytes: 1_000,
        maxOutputBytes: 100_000,
        maxDurationMs: 30_000,
        maxConcurrentInstances: 2,
        maxQueueDepth: 8,
        maxMessagesPerSecond: 10,
      },
      diagnostics: [],
      generatedByModel: false,
    };
    expect(() => compileRuntimePayload(content)).toThrow(
      /runtime_rejected_invalid_manifest/,
    );
  });

  it('rejects unsafe manifest file paths (path traversal)', () => {
    const content: WebAppContent = {
      schemaVersion: 1 as const,
      manifest: {
        entry: 'index.html',
        files: [
          {
            path: '../index.html',
            mediaType: 'text/html',
            content: '<div>1</div>',
            hash: hash('<div>1</div>'),
          },
          {
            path: 'styles.css',
            mediaType: 'text/css',
            content: 'body{}',
            hash: hash('body{}'),
          },
        ],
      },
      lockedDependencies: [],
      capabilities: ['dom-manipulation'],
      budget: {
        maxInputBytes: 10_000,
        maxMessageBytes: 1_000,
        maxOutputBytes: 100_000,
        maxDurationMs: 30_000,
        maxConcurrentInstances: 2,
        maxQueueDepth: 8,
        maxMessagesPerSecond: 10,
      },
      diagnostics: [],
      generatedByModel: false,
    };
    expect(() => compileRuntimePayload(content)).toThrow(
      /path 不能包含路径遍历、绝对路径或外部 URL 片段/,
    );
  });

  it('rejects unsupported mediaType in manifest (schema safety)', () => {
    const content = {
      schemaVersion: 1 as const,
      manifest: {
        entry: 'index.html',
        files: [
          {
            path: 'index.html',
            mediaType: 'application/octet-stream',
            content: 'data',
            hash: hash('data'),
          },
          {
            path: 'script.js',
            mediaType: 'text/javascript',
            content: 'console.log(1)',
            hash: hash('console.log(1)'),
          },
        ],
      },
      lockedDependencies: [],
      capabilities: ['dom-manipulation', 'javascript-runtime'],
      budget: {
        maxInputBytes: 10_000,
        maxMessageBytes: 1_000,
        maxOutputBytes: 100_000,
        maxDurationMs: 30_000,
        maxConcurrentInstances: 2,
        maxQueueDepth: 8,
        maxMessagesPerSecond: 10,
      },
      diagnostics: [],
      generatedByModel: false,
    } as unknown as WebAppContent;
    expect(() => compileRuntimePayload(content)).toThrow(
      /Invalid option: expected one of/,
    );
  });

  it('rejects locked dependencies until a local dependency loader exists', () => {
    const html = '<div>self-contained</div>';
    const content = {
      schemaVersion: 1,
      manifest: {
        entry: 'index.html',
        files: [
          {
            path: 'index.html',
            mediaType: 'text/html',
            content: html,
            hash: hash(html),
          },
        ],
      },
      lockedDependencies: [{ name: 'react', version: '19.2.7' }],
      capabilities: ['dom-manipulation'],
      budget: {
        maxInputBytes: 10_000,
        maxMessageBytes: 1_000,
        maxOutputBytes: 100_000,
        maxDurationMs: 30_000,
        maxConcurrentInstances: 2,
        maxQueueDepth: 8,
        maxMessagesPerSecond: 10,
      },
      diagnostics: [],
      generatedByModel: false,
    } as unknown as WebAppContent;
    expect(() => compileRuntimePayload(content)).toThrow();
  });

  it('rejects manifest hash mismatch when compiling host payload', () => {
    const content: WebAppContent = {
      schemaVersion: 1 as const,
      manifest: {
        entry: 'index.html',
        files: [
          {
            path: 'index.html',
            mediaType: 'text/html',
            content: '<div>1</div>',
            hash: hash('<div>2</div>'),
          },
        ],
      },
      lockedDependencies: [],
      capabilities: ['dom-manipulation'],
      budget: {
        maxInputBytes: 10_000,
        maxMessageBytes: 1_000,
        maxOutputBytes: 100_000,
        maxDurationMs: 30_000,
        maxConcurrentInstances: 2,
        maxQueueDepth: 8,
        maxMessagesPerSecond: 10,
      },
      diagnostics: [],
      generatedByModel: false,
    };
    expect(() => compileRuntimePayload(content)).toThrow(
      /runtime_rejected_hash_mismatch/,
    );
  });

  it('rejects remote URL references in compiled html/css/js payload', () => {
    const content: WebAppContent = {
      schemaVersion: 1 as const,
      manifest: {
        entry: 'index.html',
        files: [
          {
            path: 'index.html',
            mediaType: 'text/html',
            content: '<img src="https://evil.example.com/a.png">',
            hash: hash('<img src="https://evil.example.com/a.png">'),
          },
          {
            path: 'styles.css',
            mediaType: 'text/css',
            content: 'body{background:url("https://evil.example.com/bg.png")}',
            hash: hash(
              'body{background:url("https://evil.example.com/bg.png")}',
            ),
          },
          {
            path: 'main.js',
            mediaType: 'text/javascript',
            content: 'fetch("https://evil.example.com/api").then(()=>{})',
            hash: hash('fetch("https://evil.example.com/api").then(()=>{})'),
          },
        ],
      },
      lockedDependencies: [],
      capabilities: ['dom-manipulation'],
      budget: {
        maxInputBytes: 10_000,
        maxMessageBytes: 1_000,
        maxOutputBytes: 100_000,
        maxDurationMs: 30_000,
        maxConcurrentInstances: 2,
        maxQueueDepth: 8,
        maxMessagesPerSecond: 10,
      },
      diagnostics: [],
      generatedByModel: false,
    };
    expect(() => compileRuntimePayload(content)).toThrow(
      /runtime_rejected_html|runtime_rejected_css|runtime_rejected_js/,
    );
  });
});
