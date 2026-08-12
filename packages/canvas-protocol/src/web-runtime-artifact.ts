import { z } from 'zod';

const dependencySchema = z
  .object({
    name: z.string().min(1).max(128),
    version: z.string().min(1).max(64),
  })
  .strict();

export const WEB_APP_SCHEMA_VERSION = 1 as const;
export const WEB_APP_KIND = 'web_app.v1' as const;

const WEB_APP_PATH_MAX_LENGTH = 200;
const WEB_APP_FILE_MAX_BYTES = 256 * 1024;
export const WEB_APP_FILES_MAX_COUNT = 32;
const WEB_APP_PATH_BLACKLIST =
  /(^\.\/|^\/|\/\.{1,2}(?:\/|$)|\.\.[/\\]|\/\/|:)/u;
const pathSchema = z
  .string()
  .min(1)
  .max(WEB_APP_PATH_MAX_LENGTH)
  .regex(/^[A-Za-z0-9._/-]+$/u)
  .refine((path) => !WEB_APP_PATH_BLACKLIST.test(path), {
    message: 'path 不能包含路径遍历、绝对路径或外部 URL 片段',
  });

export const WEB_APP_MEDIA_TYPES = [
  'text/html',
  'text/css',
  'text/javascript',
] as const;

export const WEB_APP_CAPABILITIES = [
  'dom-manipulation',
  'css-render',
  'javascript-runtime',
] as const;

export const WEB_APP_DIAGNOSTIC_CODES = [
  'build_pending',
  'build_succeeded',
  'build_failed',
  'build_cancelled',
] as const;

const webAppMediaTypeSchema = z.enum(WEB_APP_MEDIA_TYPES);
const webAppCapabilitySchema = z.enum(WEB_APP_CAPABILITIES);
export const webAppDiagnosticCodeSchema = z.enum(WEB_APP_DIAGNOSTIC_CODES);

const webAppFileSchema = z
  .object({
    path: pathSchema,
    mediaType: webAppMediaTypeSchema,
    content: z.string().min(0).max(WEB_APP_FILE_MAX_BYTES),
    hash: z
      .string()
      .length(64)
      .regex(/^[a-f0-9]{64}$/i),
  })
  .strict();

const webAppBudgetSchema = z
  .object({
    maxInputBytes: z.number().int().positive(),
    maxMessageBytes: z.number().int().positive(),
    maxOutputBytes: z.number().int().positive(),
    maxDurationMs: z.number().int().positive(),
    maxConcurrentInstances: z.number().int().positive(),
    maxQueueDepth: z.number().int().positive(),
    maxMessagesPerSecond: z.number().int().positive(),
  })
  .strict();

const webAppDiagnosticsSchema = z
  .array(
    z
      .object({
        code: webAppDiagnosticCodeSchema,
      })
      .strict(),
  )
  .max(16)
  .default([]);

/**
 * web_app.v1 持久化 HTML/CSS/JS 工件的受控 manifest 形态。
 * - manifest 只允许闭集文件，且必须包含 entry；
 * - lockedDependencies 精确锁定；首版可为空；
 * - capabilities/budget/diagnostic 均可被服务端审计；
 * - 非原始 HTML/脚本，不回灌 raw provider 文本或秘密。
 */
export const webAppContentSchema = z
  .object({
    schemaVersion: z.literal(WEB_APP_SCHEMA_VERSION),
    manifest: z
      .object({
        entry: pathSchema,
        files: z.array(webAppFileSchema).min(1).max(WEB_APP_FILES_MAX_COUNT),
      })
      .strict(),
    /* v1 是完全自包含包；仓库尚无本地依赖字节装载器，因此字段存在但只能
       为空。未来支持依赖必须升级内容版本并同时交付离线 loader。 */
    lockedDependencies: z.array(dependencySchema).length(0),
    capabilities: z
      .array(webAppCapabilitySchema)
      .min(1)
      .max(WEB_APP_CAPABILITIES.length),
    budget: webAppBudgetSchema,
    diagnostics: webAppDiagnosticsSchema,
    sourceConversationId: z.string().uuid().optional(),
    generatedByModel: z.boolean(),
  })
  .strict();

export type WebAppContent = z.infer<typeof webAppContentSchema>;
export type WebAppManifestFile = z.infer<typeof webAppFileSchema>;
export type WebAppDiagnosticCode = z.infer<typeof webAppDiagnosticCodeSchema>;

/**
 * 第一版持久 DOM Runtime 只接收自包含的不可变文档。
 * 依赖声明仍进入 U11 门禁；当前 Adapter 只执行空依赖集合，避免伪装已提供包加载。
 */
export const domExplorationContentSchema = z
  .object({
    schemaVersion: z.literal(1),
    html: z.string().max(64 * 1024),
    css: z.string().max(32 * 1024),
    script: z.string().max(128 * 1024),
    dependencies: z.array(dependencySchema).max(4),
  })
  .strict();

export type DomExplorationContent = z.infer<typeof domExplorationContentSchema>;
