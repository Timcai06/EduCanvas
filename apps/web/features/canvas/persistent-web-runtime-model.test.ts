import { createWebRuntimeSession } from '@educanvas/canvas-protocol';
import { describe, expect, it } from 'vitest';
import {
  resolveCancelFailure,
  runtimeRequestCancelPath,
  shouldIgnoreRuntimeEvent,
} from './persistent-web-runtime-model';

const binding = {
  protocolVersion: 'educanvas.web-runtime.v1' as const,
  channelId: 'channel-1',
  runtimeId: 'runtime-1',
  notebookId: 'notebook-1',
  artifactVersionId: 'version-1',
  artifactContentHash: 'a'.repeat(64),
};

describe('PersistentWebRuntime race policy', () => {
  it('does not report cancellation when the cancel API fails', () => {
    expect(resolveCancelFailure('running')).toBe('failed');
    expect(resolveCancelFailure('starting')).toBe('failed');
  });

  it('preserves any first terminal during cancel or message races', () => {
    expect(resolveCancelFailure('succeeded')).toBe('succeeded');
    expect(resolveCancelFailure('failed')).toBe('failed');
    expect(resolveCancelFailure('cancelled')).toBe('cancelled');
    expect(
      shouldIgnoreRuntimeEvent({
        ...createWebRuntimeSession(binding),
        terminal: 'succeeded',
      }),
    ).toBe(true);
  });

  it('produces the request-scoped cleanup path for stale and unmounted starts', () => {
    expect(runtimeRequestCancelPath('request/with spaces')).toBe(
      '/api/v1/canvas/runtime/requests/request%2Fwith%20spaces/cancel',
    );
  });
});
