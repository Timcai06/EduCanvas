import { createHash } from 'node:crypto';
import type { StructuredModelGateway } from '@educanvas/agent-core';
import {
  webAppContentSchema,
  WEB_APP_MEDIA_TYPES,
  type WebAppContent,
  type WebAppDiagnosticCode,
  type WebAppManifestFile,
} from '@educanvas/canvas-protocol/server';

export const WEB_APP_PROMPT_VERSION = 'artifact-web-app-v1';
export const WEB_APP_REVISION_PROMPT_VERSION = 'artifact-web-app-revision-v1';
export const RULE_GENERATOR = 'rule:web-app-fallback-v1';
export const RULE_REVISION_GENERATOR = 'rule:web-app-revision-v1';
export const MODEL_GENERATOR = 'model:artifact.generate:web-app-v1';
export const MODEL_REVISION_GENERATOR =
  'model:artifact.generate:web-app-revision-v1';

export interface ArtifactRevisionContext {
  instruction: string;
  baseContent: unknown;
}

interface OutlineMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface GenerateWebAppInput {
  title: string;
  messages: readonly OutlineMessage[];
  gateway: StructuredModelGateway | null;
  traceId: string;
  operationId: string;
  revision?: ArtifactRevisionContext;
}

const BUDGET = {
  maxInputBytes: 8_192,
  maxMessageBytes: 8_192,
  maxOutputBytes: 16_000,
  maxDurationMs: 5_000,
  maxConcurrentInstances: 1,
  maxQueueDepth: 10,
  maxMessagesPerSecond: 5,
} as const;

const STRICT_CAPABILITIES = [
  'dom-manipulation',
  'css-render',
  'javascript-runtime',
] as const;

const STRICT_DIAGNOSTICS: WebAppDiagnosticCode[] = ['build_succeeded'];
const DEFAULT_ENTRY = 'index.html';

const clip = (value: string, max: number): string =>
  value.length <= max ? value : `${value.slice(0, max - 1)}…`;

const hashFile = (value: string): string =>
  createHash('sha256').update(value, 'utf8').digest('hex');

const buildTranscript = (messages: readonly OutlineMessage[]): string =>
  messages.map((message) => `${message.role}: ${message.content}`).join('\n');

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return entities[character]!;
  });

const ensureNoExternalUrl = (content: string): void => {
  const hasNetworkRef =
    /(href|src|action|formaction|poster|srcset)\s*=\s*["']\s*(https?:\/\/|\/\/)/i.test(
      content,
    );
  if (hasNetworkRef) {
    throw new Error('web_app manifest contains external URL');
  }
};

const ensureNoJsImport = (content: string): void => {
  if (
    /\b(?:import|export)\b/.test(content) ||
    /\b(?:fetch|WebSocket|EventSource|XMLHttpRequest|importScripts)\s*\(/.test(
      content,
    ) ||
    /navigator\.sendBeacon\s*\(/.test(content)
  ) {
    throw new Error('web_app manifest contains JS module syntax');
  }
};

const rehashFiles = (
  files: ReadonlyArray<{ path: string; mediaType: string; content: string }>,
): WebAppContent['manifest']['files'] =>
  files.map((file) => ({
    path: file.path,
    mediaType: file.mediaType as WebAppManifestFile['mediaType'],
    content: file.content,
    hash: hashFile(file.content),
  }));

const validateFiles = (files: WebAppContent['manifest']['files']): void => {
  for (const file of files) {
    if (file.mediaType === 'text/html') {
      ensureNoExternalUrl(file.content);
    }

    if (file.mediaType === 'text/css') {
      if (
        /url\(\s*["']?\s*(?:https?:\/\/|\/\/)/i.test(file.content) ||
        /@import\s+(?:url\()?\s*["']?\s*(?:https?:\/\/|\/\/)/i.test(
          file.content,
        )
      ) {
        throw new Error('web_app manifest contains external CSS resource');
      }
    }

    if (file.mediaType === 'text/javascript') {
      ensureNoJsImport(file.content);
    }
  }
};

const buildDefaultFiles = (
  title: string,
  messages: readonly OutlineMessage[],
  revisionInstruction?: string,
): Array<{ path: string; mediaType: string; content: string }> => {
  const transcript = escapeHtml(clip(buildTranscript(messages), 4_000));
  const safeTitle = escapeHtml(title);
  const safeRevision = revisionInstruction
    ? escapeHtml(revisionInstruction)
    : null;

  return [
    {
      path: DEFAULT_ENTRY,
      mediaType: WEB_APP_MEDIA_TYPES[0],
      content: [
        '<!doctype html>',
        '<html>',
        '  <head>',
        '    <meta charset="utf-8" />',
        `    <title>${safeTitle}</title>`,
        '    <meta name="viewport" content="width=device-width, initial-scale=1" />',
        '    <link rel="stylesheet" href="styles.css" />',
        '  </head>',
        '  <body>',
        `    <main><h1>${safeTitle}</h1><p>${safeRevision ?? '课程页面已生成。'}</p>`,
        `    <pre>${transcript}</pre>`,
        '    <div id="app"></div>',
        '    <script src="app.js"></script>',
        '  </body>',
        '</html>',
      ].join('\n'),
    },
    {
      path: 'styles.css',
      mediaType: WEB_APP_MEDIA_TYPES[1],
      content:
        'body{font-family:system-ui, sans-serif;padding:20px;background:#f5f7fb} #app{margin-top:1rem} pre{white-space:pre-wrap;word-break:break-word;}',
    },
    {
      path: 'app.js',
      mediaType: WEB_APP_MEDIA_TYPES[2],
      content: revisionInstruction
        ? `const text = ${JSON.stringify(revisionInstruction)}; document.getElementById('app').textContent = text;`
        : 'document.getElementById(\"app\").textContent = \"页面已生成。\";',
    },
  ];
};

const sanitizeModelOutput = (raw: WebAppContent): WebAppContent => {
  const parsed = webAppContentSchema.parse(raw);
  validateFiles(parsed.manifest.files);

  const rebasedFiles = rehashFiles(parsed.manifest.files).map((file) => {
    const next: WebAppManifestFile = {
      ...file,
      hash: hashFile(file.content),
    };
    return next;
  });

  return webAppContentSchema.parse({
    ...parsed,
    manifest: {
      entry: DEFAULT_ENTRY,
      files: rebasedFiles,
    },
    capabilities: [...STRICT_CAPABILITIES],
    lockedDependencies: [],
    budget: { ...BUDGET },
    diagnostics: STRICT_DIAGNOSTICS.map((code) => ({ code })),
    generatedByModel: true,
  });
};

const buildFallback = (
  title: string,
  messages: readonly OutlineMessage[],
  revision?: ArtifactRevisionContext,
): WebAppContent =>
  webAppContentSchema.parse({
    schemaVersion: 1,
    manifest: {
      entry: DEFAULT_ENTRY,
      files: rehashFiles(
        buildDefaultFiles(title, messages, revision?.instruction),
      ),
    },
    lockedDependencies: [],
    capabilities: [...STRICT_CAPABILITIES],
    budget: { ...BUDGET },
    diagnostics: STRICT_DIAGNOSTICS.map((code) => ({ code })),
    generatedByModel: false,
  });

export async function generateWebAppContent(
  input: GenerateWebAppInput,
): Promise<{
  content: WebAppContent;
  generatedBy: string;
}> {
  if (!input.gateway) {
    if (input.revision) {
      webAppContentSchema.parse(input.revision.baseContent);
    }

    return {
      content: buildFallback(input.title, input.messages, input.revision),
      generatedBy: input.revision ? RULE_REVISION_GENERATOR : RULE_GENERATOR,
    };
  }

  if (input.revision) {
    webAppContentSchema.parse(input.revision.baseContent);
  }

  const result = await input.gateway.generateStructured({
    taskAlias: 'artifact.generate',
    modelAlias: 'structured',
    schema: webAppContentSchema,
    promptVersion: input.revision
      ? WEB_APP_REVISION_PROMPT_VERSION
      : WEB_APP_PROMPT_VERSION,
    traceId: input.traceId,
    operationId: input.operationId,
    messages: [
      {
        role: 'system',
        content: [
          '你是课程网页内容生成器。',
          '输出 web_app.v1（schemaVersion=1）的自包含产物。',
          '不得输出外部资源、CDN、网络 URL、脚本远程路径、JS import/export。',
          `manifest.entry 请使用 ${DEFAULT_ENTRY}。`,
        ].join('\n'),
      },
      {
        role: 'user',
        content: `标题：${input.title}\n\n对话记录：\n${buildTranscript(input.messages)}`,
      },
      ...(input.revision
        ? [
            {
              role: 'user' as const,
              content: [
                '当前版本：',
                JSON.stringify(input.revision.baseContent),
                '修改要求：',
                clip(input.revision.instruction, 2_000),
              ].join('\n'),
            },
          ]
        : []),
    ],
  });

  return {
    content: sanitizeModelOutput(result.output),
    generatedBy: input.revision ? MODEL_REVISION_GENERATOR : MODEL_GENERATOR,
  };
}
