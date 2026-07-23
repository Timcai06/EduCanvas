import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { GatewayOperationEvent } from '@educanvas/gateway-core';
import {
  GatewayConnectionRuntimeError,
  GatewayRuntimeError,
} from '@educanvas/gateway-runtime';
import {
  GatewayPersistenceError,
  ToolEffectReconciliationConflictError,
  ToolEffectReconciliationLifecycleError,
  ToolEffectReconciliationOwnershipError,
} from '@educanvas/db';
import { ZodError } from 'zod';
import type { GatewayObservability } from '../observability';
import type { GatewayHttpDependencies } from './dependencies';

/**
 * Gateway HTTP 路由的共享基元：请求体读取、响应写出、鉴权与错误映射。
 * Body 大小上限、SSE/NDJSON 头与错误码到 HTTP 状态的映射均保持与拆分前一致。
 */

export const MAX_BODY_BYTES = 1_000_000;

/** 传入各路由组的请求上下文。 */
export interface GatewayRouteContext {
  request: IncomingMessage;
  response: ServerResponse;
  url: URL;
  deps: GatewayHttpDependencies;
}

/**
 * 路由分派结果。handled 表示本组已写出响应或已因鉴权/开关而终止分派；
 * 未命中（或鉴权通过但无匹配子路由）返回 unhandled，交回顶层继续分派直至 404。
 */
export type GatewayRouteResult = { handled: boolean };
export const HANDLED: GatewayRouteResult = { handled: true };
export const UNHANDLED: GatewayRouteResult = { handled: false };

export function writeJson(
  response: ServerResponse,
  status: number,
  body: unknown,
): void {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(JSON.stringify(body));
}

export function isAuthorized(request: IncomingMessage, token: string): boolean {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) return false;
  const supplied = Buffer.from(header.slice('Bearer '.length));
  const expected = Buffer.from(token);
  return (
    supplied.length === expected.length && timingSafeEqual(supplied, expected)
  );
}

export async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error('BODY_TOO_LARGE');
    chunks.push(buffer);
  }
  if (chunks.length === 0) throw new Error('EMPTY_BODY');
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

export function writeEvent(
  response: ServerResponse,
  event: GatewayOperationEvent,
  observability?: GatewayObservability,
) {
  observability?.operation(event);
  response.write(`${JSON.stringify(event)}\n`);
}

export function mapError(error: unknown): {
  status: number;
  code: string;
} {
  if (error instanceof ZodError)
    return { status: 400, code: 'INVALID_REQUEST' };
  if (error instanceof ToolEffectReconciliationOwnershipError) {
    return { status: 404, code: 'NOT_FOUND' };
  }
  if (
    error instanceof ToolEffectReconciliationConflictError ||
    error instanceof ToolEffectReconciliationLifecycleError
  ) {
    return { status: 409, code: 'INVALID_STATE' };
  }
  if (error instanceof GatewayPersistenceError) {
    if (error.code === 'forbidden') return { status: 403, code: 'FORBIDDEN' };
    if (error.code === 'idempotency_conflict') {
      return { status: 409, code: 'IDEMPOTENCY_CONFLICT' };
    }
    if (error.code === 'invalid_event_sequence') {
      return { status: 409, code: 'INVALID_STATE' };
    }
    if (
      error.code === 'route_not_found' ||
      error.code === 'operation_not_found'
    ) {
      return { status: 404, code: 'NOT_FOUND' };
    }
  }
  if (error instanceof GatewayRuntimeError) {
    if (error.code === 'FORBIDDEN') return { status: 403, code: 'FORBIDDEN' };
    if (error.code === 'IDEMPOTENCY_CONFLICT') {
      return { status: 409, code: 'IDEMPOTENCY_CONFLICT' };
    }
    if (
      error.code === 'ROUTE_NOT_FOUND' ||
      error.code === 'OPERATION_NOT_FOUND'
    ) {
      return { status: 404, code: 'NOT_FOUND' };
    }
  }
  if (error instanceof GatewayConnectionRuntimeError) {
    return {
      status: 409,
      code: error.code,
    };
  }
  if (
    error instanceof SyntaxError ||
    (error instanceof Error &&
      [
        'BODY_TOO_LARGE',
        'EMPTY_BODY',
        'EFFECT_RECONCILIATION_PRINCIPAL_INVALID',
      ].includes(error.message))
  ) {
    return {
      status: error.message === 'BODY_TOO_LARGE' ? 413 : 400,
      code: 'INVALID_REQUEST',
    };
  }
  return { status: 500, code: 'INTERNAL_ERROR' };
}
