import { describe, expect, it } from 'vitest';
import type { WebRuntimePort } from './web-runtime-port';

describe('WebRuntimePort', () => {
  it('streams events for an immutable artifact version without a provider or database contract', async () => {
    const port: WebRuntimePort = {
      async *execute() {
        yield { type: 'ready' } as const;
        yield { type: 'output', kind: 'text', value: 'safe' } as const;
        yield {
          type: 'failed',
          failureCode: 'execution_failed',
        } as const;
      },
    };
    const events = [];
    for await (const event of port.execute({
      artifact: {
        notebookId: 'notebook-1',
        artifactId: 'artifact-1',
        artifactVersionId: 'version-1',
        contentHash: 'a'.repeat(64),
      },
      resources: {
        maxDurationMs: 1_000,
        maxInputBytes: 1_024,
        maxMessageBytes: 1_024,
        maxOutputBytes: 1_024,
      },
      signal: new AbortController().signal,
    }))
      events.push(event.type);
    expect(events).toEqual(['ready', 'output', 'failed']);
  });
});
