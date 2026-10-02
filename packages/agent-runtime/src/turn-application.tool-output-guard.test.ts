import { describe, expect, it } from 'vitest';
import type { TurnModelGateway } from '@educanvas/agent-core';
import { z } from 'zod';
import {
  TurnApplicationService,
  type TurnApplicationProfilePort,
} from './turn-application';
import { ToolKernel, type ToolKernelAdapter } from './tool-kernel';
import {
  MemoryCallLedger,
  MemoryContextLedger,
  MemoryEffectLedger,
  MemoryLifecycle,
  MemoryModelRunLedger,
  collect,
  metadata,
  profile,
} from './turn-application.test-support';

describe('TurnApplicationService (validated tool result guard)', () => {
  it('only notifies the output guard after a validated, persisted tool result', async () => {
    const observed: { tool: string; citationMarker: number | undefined }[] = [];
    const adapter: ToolKernelAdapter<
      { url: string },
      {
        url: string;
        title: string | null;
        content: string;
        citationMarker: number;
      }
    > = {
      name: 'fetchWebPage',
      description: '读取网页',
      source: 'local',
      capability: 'tool.execute',
      risk: 'l0',
      exposure: 'model',
      effect: 'read',
      timeoutMs: 100,
      inputSchema: z.object({ url: z.string().url() }).strict(),
      outputSchema: z
        .object({
          url: z.string().url(),
          title: z.string().nullable(),
          content: z.string(),
          citationMarker: z.number().int().positive(),
        })
        .strict(),
      async invoke({ url }) {
        return {
          url,
          title: 'Fixture',
          content: '已读取正文',
          citationMarker: 1,
        };
      },
    };
    const withTools: TurnApplicationProfilePort = {
      ...profile(),
      async prepare(input) {
        const base = await profile().prepare(input);
        return {
          ...base,
          toolPolicy: {
            channel: 'web',
            environment: 'test',
            capabilities: {
              actor: ['tool.execute'],
              notebook: ['tool.execute'],
              profile: ['tool.execute'],
              channel: ['tool.execute'],
              environment: ['tool.execute'],
            },
            approvedCapabilities: [],
          },
        };
      },
      createOutputGuard() {
        return {
          toolRemediation: {
            tool: 'fetchWebPage',
            prompt: 'Read a source.',
          },
          onToolResult(tool, result) {
            const output = result.output;
            observed.push({
              tool,
              citationMarker:
                typeof output === 'object' &&
                output !== null &&
                'citationMarker' in output &&
                typeof output.citationMarker === 'number'
                  ? output.citationMarker
                  : undefined,
            });
          },
          async push(delta) {
            return { kind: 'emit', safeDeltas: [delta] } as const;
          },
          async finish() {
            return { kind: 'emit', safeDeltas: [] } as const;
          },
        };
      },
    };
    const gateway: TurnModelGateway = {
      async *streamTurnText(request) {
        if (request.toolResults.length === 0) {
          yield {
            type: 'tool_call',
            phase: request.phase,
            callId: 'fetch_1',
            tool: 'fetchWebPage',
            argumentsDelta: '{"url":"https://example.com/"}',
            done: true,
          };
          yield {
            type: 'completed',
            phase: request.phase,
            metadata: metadata(request, 'tool_calls'),
          };
          return;
        }
        yield {
          type: 'text_delta',
          phase: request.phase,
          delta: '已读来源[1]。',
        };
        yield {
          type: 'completed',
          phase: request.phase,
          metadata: metadata(request, 'stop'),
        };
      },
    };

    const events = await collect(
      new TurnApplicationService({
        lifecycle: new MemoryLifecycle(),
        profile: withTools,
        contextLedger: new MemoryContextLedger(),
        modelRunLedger: new MemoryModelRunLedger(),
        modelGateway: gateway,
        toolKernel: new ToolKernel(
          [adapter],
          new MemoryCallLedger(),
          new MemoryEffectLedger(),
        ),
      }),
    );

    expect(events.at(-1)).toMatchObject({ type: 'turn.completed' });
    expect(observed).toEqual([{ tool: 'fetchWebPage', citationMarker: 1 }]);
  });
});
