import { describe, expect, it } from 'vitest';
import type { McpIntentMetadata } from './contracts';
import { AesGcmMcpIntentCipher } from './intent-codec';

const metadata: McpIntentMetadata = {
  resumeRef: `mcp.intent:${'a'.repeat(64)}`,
  operationId: '10000000-0000-4000-8000-000000000001',
  toolCallId: '20000000-0000-4000-8000-000000000001',
  actorId: 'local:owner',
  agentId: '30000000-0000-4000-8000-000000000001',
  serverId: 'study-tools',
  remoteToolName: 'publish',
  modelToolName: 'publishNotes',
  capability: 'external.mcp.invoke',
  risk: 'l2',
  effect: 'write',
  semanticsHash: 'b'.repeat(64),
  expiresAt: '2026-07-22T12:15:00.000Z',
};

describe('MCP耐久意图加密', () => {
  it('使用AAD往返参数与Credential Handle', () => {
    const cipher = new AesGcmMcpIntentCipher(Buffer.alloc(32, 7));
    const sealedPayload = cipher.seal({
      metadata,
      payload: {
        arguments: { title: '分数笔记' },
        credentialHandle: 'credential:notes',
      },
    });
    expect(JSON.stringify(sealedPayload)).not.toContain('分数笔记');
    expect(
      cipher.semanticsHash({
        registration: {
          serverId: metadata.serverId,
          endpoint: 'https://example.test/mcp',
          remoteToolName: metadata.remoteToolName,
          modelToolName: metadata.modelToolName,
          description: '发布笔记',
          capability: metadata.capability,
          risk: metadata.risk,
          effect: metadata.effect,
          authentication: 'none',
          inputSchema: { type: 'object' },
          timeoutMs: 1_000,
        },
        arguments: { title: '分数笔记' },
      }),
    ).not.toBe(
      new AesGcmMcpIntentCipher(Buffer.alloc(32, 9)).semanticsHash({
        registration: {
          serverId: metadata.serverId,
          endpoint: 'https://example.test/mcp',
          remoteToolName: metadata.remoteToolName,
          modelToolName: metadata.modelToolName,
          description: '发布笔记',
          capability: metadata.capability,
          risk: metadata.risk,
          effect: metadata.effect,
          authentication: 'none',
          inputSchema: { type: 'object' },
          timeoutMs: 1_000,
        },
        arguments: { title: '分数笔记' },
      }),
    );
    expect(cipher.open({ metadata, sealedPayload })).toEqual({
      arguments: { title: '分数笔记' },
      credentialHandle: 'credential:notes',
    });
  });

  it('拒绝跨Operation搬移与密文篡改', () => {
    const cipher = new AesGcmMcpIntentCipher(Buffer.alloc(32, 8));
    const sealedPayload = cipher.seal({
      metadata,
      payload: { arguments: { value: 1 }, credentialHandle: null },
    });
    expect(() =>
      cipher.open({
        metadata: { ...metadata, operationId: metadata.toolCallId },
        sealedPayload,
      }),
    ).toThrow();
    expect(() =>
      cipher.open({
        metadata,
        sealedPayload: {
          ...sealedPayload,
          authTag: Buffer.alloc(16).toString('base64'),
        },
      }),
    ).toThrow();
  });
});
