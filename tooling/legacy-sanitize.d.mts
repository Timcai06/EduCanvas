/**
 * tooling/legacy-sanitize.mjs 的类型声明 — 供 packages/logging 的契约测试
 * （tooling-parity.test.ts）导入；tooling 自身是 .mjs 运行时，不依赖本文件。
 */

export const DEFAULT_LEGACY_MAX_LENGTH: number;

export function stripAnsi(text: string): string;

export function redactLegacyString(input: string, replacement?: string): string;

export function sanitizeLegacyLine(line: string, maxLength?: number): string;
