import {
  projectCanvasResourceForNonWeb,
  type CanvasResourceKind,
} from '@educanvas/canvas-protocol';
import {
  gatewayHandoffCredentialSchema,
  type GatewayHandoffCredential,
} from '@educanvas/gateway-core';

const MAX_INLINE_TEXT_CHARS = 16_000;

export interface TuiCanvasTextRequest {
  readonly notebookId: string;
  readonly resourceKind: CanvasResourceKind;
  readonly resourceId: string;
  readonly maxChars: number;
}

export type TuiCanvasOpenResult =
  | {
      readonly kind: 'inline_text';
      readonly title: string;
      readonly text: string;
    }
  | {
      readonly kind: 'web_handoff';
      readonly title: string;
      readonly url: string;
      readonly expiresAt: string;
    }
  | {
      readonly kind: 'unavailable';
      readonly reason:
        | 'resource_not_found'
        | 'resource_invalid'
        | 'resource_not_ready'
        | 'text_unavailable'
        | 'handoff_unavailable';
    };

export interface OpenTuiCanvasResourceInput {
  readonly resource: unknown;
  readonly currentNotebookId: string;
  readonly conversationId: string;
  readonly webBaseUrl: string;
  readonly loadText?: (request: TuiCanvasTextRequest) => Promise<string | null>;
  readonly issueHandoff: (
    conversationId: string,
  ) => Promise<GatewayHandoffCredential>;
}

function buildHandoffUrl(webBaseUrl: string, token: string): string | null {
  try {
    const base = new URL(webBaseUrl);
    if (!['http:', 'https:'].includes(base.protocol)) return null;
    if (base.username || base.password) return null;
    const target = new URL('/open', base);
    target.searchParams.set('token', token);
    return target.toString();
  } catch {
    return null;
  }
}

async function createWebHandoff(
  input: OpenTuiCanvasResourceInput,
  title: string,
): Promise<TuiCanvasOpenResult> {
  try {
    const credential = gatewayHandoffCredentialSchema.parse(
      await input.issueHandoff(input.conversationId),
    );
    const url = buildHandoffUrl(input.webBaseUrl, credential.token);
    if (!url) return { kind: 'unavailable', reason: 'handoff_unavailable' };
    return {
      kind: 'web_handoff',
      title,
      url,
      expiresAt: credential.expiresAt,
    };
  } catch {
    return { kind: 'unavailable', reason: 'handoff_unavailable' };
  }
}

/**
 * 打开已由服务端投影的 CanvasResource。
 *
 * 文本内容仍通过注入的受控读取器按资源身份重新读取；其他内容只签发当前
 * Conversation 的短期一次性 Web 交接，不把资源内容或内部地址放进 URL。
 */
export async function openTuiCanvasResource(
  input: OpenTuiCanvasResourceInput,
): Promise<TuiCanvasOpenResult> {
  const projection = projectCanvasResourceForNonWeb({
    resource: input.resource,
    currentNotebookId: input.currentNotebookId,
  });
  if (!projection.available) {
    return { kind: 'unavailable', reason: projection.reason };
  }
  if (projection.openMode === 'none') {
    return { kind: 'unavailable', reason: 'resource_not_ready' };
  }

  if (projection.openMode === 'inline_text' && input.loadText) {
    try {
      const text = await input.loadText({
        notebookId: input.currentNotebookId,
        resourceKind: projection.resourceKind,
        resourceId: projection.resourceId,
        maxChars: MAX_INLINE_TEXT_CHARS,
      });
      if (
        typeof text !== 'string' ||
        text.trim().length === 0 ||
        text.length > MAX_INLINE_TEXT_CHARS
      ) {
        return { kind: 'unavailable', reason: 'text_unavailable' };
      }
      return { kind: 'inline_text', title: projection.title, text };
    } catch {
      return { kind: 'unavailable', reason: 'text_unavailable' };
    }
  }

  return createWebHandoff(input, projection.title);
}
