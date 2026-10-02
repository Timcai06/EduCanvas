import type { TurnApplicationCommand } from '@educanvas/agent-core';
import type { TurnApplicationLifecycleSnapshot } from '@educanvas/agent-runtime';
import type { MaterializedAssetPlan } from '../assets/asset-materialization';
import type { NodeInvocationPersistencePort } from '@educanvas/node-runtime';
import { vi } from 'vitest';
import type { WebOperationArtifacts } from './general-artifact-tool';
import type { WebOperationImageArtifacts } from './general-image-tool';
import { WebGeneralProfile } from './general-turn-profile';
import type { WebOperationSources } from './general-turn-tools';

export const assetContext: MaterializedAssetPlan = {
  text: '',
  textSegments: [],
  nativeReferences: [],
  nativeImages: [],
};
export const command: TurnApplicationCommand = {
  protocol: 'educanvas.turn.v2',
  operationId: 'operation-1',
  traceId: 'trace-1',
  actor: { actorId: 'actor-1', agentId: 'agent-1' },
  notebook: {
    notebookId: 'notebook-1',
    conversationId: 'conversation-1',
  },
  profile: { profileId: 'general' },
  entrypoint: 'web',
  input: {
    clientMessageId: 'client-message-1',
    parts: [{ type: 'text', text: '你好' }],
  },
  capabilities: ['input.text', 'output.markdown', 'root.shell'],
};
export const turn: TurnApplicationLifecycleSnapshot = {
  operationId: command.operationId,
  traceId: command.traceId,
  userMessageId: 'message-user-1',
  assistantMessageId: 'message-assistant-1',
  replayed: false,
};

export function createNodeInvocations(
  capabilities: readonly ('device.status' | 'filesystem.read_allowlisted')[] = [
    'device.status',
  ],
): NodeInvocationPersistencePort {
  return {
    listAvailableCapabilitiesForOperation: vi
      .fn()
      .mockResolvedValue(capabilities),
    enqueueForOperation: vi.fn(),
    readInvocationOutcome: vi.fn(),
    expirePendingInvocation: vi.fn(),
  };
}

export function createProfile(input?: {
  nodeInvocations?: NodeInvocationPersistencePort;
  membershipRole?: 'owner' | 'editor' | 'contributor' | 'viewer';
  staticToolCapabilities?: readonly string[];
  operationArtifacts?: WebOperationArtifacts;
  operationImages?: WebOperationImageArtifacts;
  outputPreference?:
    'auto' | 'markdown_document' | 'interactive_artifact' | 'web_app';
  assetContext?: MaterializedAssetPlan;
  operationSources?: WebOperationSources;
  successfulSearchCount?: number;
}) {
  return new WebGeneralProfile(
    input?.assetContext ?? assetContext,
    input?.operationSources ??
      ({ sourceCount: 0 } as unknown as WebOperationSources),
    input?.operationArtifacts ??
      ({ events: () => [] } as unknown as WebOperationArtifacts),
    input?.operationImages ??
      ({ events: () => [] } as unknown as WebOperationImageArtifacts),
    input?.outputPreference ?? 'auto',
    input?.staticToolCapabilities ?? ['web.fetch', 'web.search'],
    input?.nodeInvocations ?? createNodeInvocations(),
    input?.membershipRole ?? 'owner',
    { successfulSearchCount: input?.successfulSearchCount ?? 0 },
  );
}
