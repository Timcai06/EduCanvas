import { MAX_TOOL_ARGUMENT_BYTES } from '@educanvas/agent-runtime';
import Ajv from 'ajv';
import Ajv2020 from 'ajv/dist/2020.js';
import type { ValidateFunction } from 'ajv';
import { z } from 'zod';
import { McpConfigurationError } from './errors';
import {
  McpJsonLimitError,
  canonicalBoundedJson,
  cloneBoundedJson,
} from './json-limits';

export const MCP_SCHEMA_LIMITS = {
  maxBytes: 32 * 1024,
  maxDepth: 20,
  maxArrayItems: 256,
  maxObjectKeys: 1_024,
} as const;

const MCP_ARGUMENT_LIMITS = {
  maxBytes: MAX_TOOL_ARGUMENT_BYTES,
  maxDepth: 32,
  maxArrayItems: 1_024,
  maxObjectKeys: 1_024,
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function compileSchema(
  inputSchema: Readonly<Record<string, unknown>>,
): ValidateFunction {
  try {
    const schema = cloneBoundedJson(inputSchema, MCP_SCHEMA_LIMITS);
    if (!isRecord(schema) || schema.type !== 'object') {
      throw new McpConfigurationError();
    }
    const dialect =
      typeof schema.$schema === 'string' ? schema.$schema : undefined;
    const Validator = dialect?.includes('draft-07') ? Ajv : Ajv2020;
    return new Validator({
      strict: true,
      allErrors: false,
      validateSchema: true,
      ownProperties: true,
      logger: false,
    }).compile(schema);
  } catch (error) {
    if (error instanceof McpConfigurationError) throw error;
    throw new McpConfigurationError();
  }
}

/** 可信注册Schema会先被限宽，再编译成本地执行验证器。 */
export function createMcpArgumentSchema(
  inputSchema: Readonly<Record<string, unknown>>,
): z.ZodType<Readonly<Record<string, unknown>>> {
  const validate = compileSchema(inputSchema);
  return z.custom<Readonly<Record<string, unknown>>>((value) => {
    if (!isRecord(value)) return false;
    try {
      cloneBoundedJson(value, MCP_ARGUMENT_LIMITS);
      return validate(value) === true;
    } catch (error) {
      if (error instanceof McpJsonLimitError) return false;
      return false;
    }
  });
}

/** 远端listTools返回的Schema必须与服务端可信注册等价，annotations不参与。 */
export function canonicalMcpInputSchema(
  inputSchema: Readonly<Record<string, unknown>>,
): string {
  compileSchema(inputSchema);
  return canonicalBoundedJson(inputSchema, MCP_SCHEMA_LIMITS);
}
