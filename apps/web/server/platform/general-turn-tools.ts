import 'server-only';

import { adaptAgentTool, type ToolKernelPort } from '@educanvas/agent-runtime';
import {
  DrizzleGatewayNodeRepository,
  DrizzleMcpIntentRepository,
  DrizzleToolApprovalIntentRepository,
  type PlatformOperationSourceSnapshot,
} from '@educanvas/db';
import { createMcpRuntimeFromEnvironment } from '@educanvas/mcp-runtime';
import {
  createNodeToolAdapters,
  type NodeInvocationPersistencePort,
} from '@educanvas/node-runtime';
import { persistFetchedWebPageAsset } from '../assets/asset-upload';
import type { AnonymousIdentity } from '../identity/anonymous-identity';
import { createFetchWebPageTool, type FetchedWebPage } from '../tools/web-page';
import {
  createPlanNoteTool,
  planNoteModelInputSchema,
} from '../tools/plan-note';
import { resolveWebSearchTool } from '../tools/web-search';
import type { WebOperationArtifacts } from './general-artifact-tool';
import {
  IMAGE_GENERATION_CAPABILITY,
  isImageGenerationConfigured,
  type WebOperationImageArtifacts,
} from './general-image-tool';
import { webGeneralSources } from './general-turn-persistence';
import { createWebToolKernel } from '../turn-composition';

const mcpRuntime = createMcpRuntimeFromEnvironment(undefined, {
  durableIntents: new DrizzleMcpIntentRepository(),
  approvalIntents: new DrizzleToolApprovalIntentRepository(),
});

/** 单个Operation的网页来源账本；同一URL只分配一个稳定引用序号。 */
export class WebOperationSources {
  private readonly byUrl = new Map<string, PlatformOperationSourceSnapshot>();
  private maximumOrdinal = 0;

  constructor(
    private readonly input: {
      identity: AnonymousIdentity;
      conversationId: string;
      spaceId: string;
      operationId: string;
    },
  ) {}

  get sourceCount(): number {
    return this.maximumOrdinal;
  }

  async persist(page: FetchedWebPage): Promise<{ citationMarker: number }> {
    const sourceUrl = new URL(page.url);
    sourceUrl.hash = '';
    const sourceKey = sourceUrl.toString();
    const existing = this.byUrl.get(sourceKey);
    if (existing) return { citationMarker: existing.ordinal };
    const asset = await persistFetchedWebPageAsset({
      identity: this.input.identity,
      spaceId: this.input.spaceId,
      page,
    });
    if (!asset.version) throw new Error('web_asset_version_missing');
    const source = await webGeneralSources.createOrGetWebSource({
      conversationId: this.input.conversationId,
      trustedSubjectId: this.input.identity.studentId,
      operationId: this.input.operationId,
      assetId: asset.descriptor.assetId,
      assetVersionId: asset.version.versionId,
      label: page.title?.trim() || new URL(page.url).hostname || '网页来源',
      url: page.url,
    });
    this.byUrl.set(sourceKey, source);
    this.maximumOrdinal = Math.max(this.maximumOrdinal, source.ordinal);
    return { citationMarker: source.ordinal };
  }
}

/** 组装Web General本次可用Tool；静态能力不包含需按Actor实时解析的Node能力。 */
export function createGeneralToolKernel(
  operationSources: WebOperationSources,
  operationArtifacts: WebOperationArtifacts,
  operationImages: WebOperationImageArtifacts,
): {
  kernel: ToolKernelPort;
  staticCapabilities: readonly string[];
  nodeInvocations: NodeInvocationPersistencePort;
} {
  const fetchTool = createFetchWebPageTool(undefined, (page) =>
    operationSources.persist(page),
  );
  const searchTool = resolveWebSearchTool();
  const localAdapters = [
    /* 无副作用的表达型工具：让模型能把「接下来打算做什么」变成一次可见的
       工具调用，而不必新开一条绕过输出闸门的推理通道。见 tools/plan-note.ts。 */
    adaptAgentTool(createPlanNoteTool(), {
      capability: 'agent.plan_note',
      risk: 'l0',
      effect: 'read',
      modelInputSchema: planNoteModelInputSchema,
    }),
    adaptAgentTool(operationArtifacts.createTool(), {
      capability: 'artifact.create',
      risk: 'l1',
      effect: 'write',
    }),
    adaptAgentTool(fetchTool, {
      capability: 'web.fetch',
      risk: 'l1',
      effect: 'write',
    }),
    ...(searchTool
      ? [
          adaptAgentTool(searchTool, {
            capability: 'web.search',
            risk: 'l0',
            effect: 'read',
          }),
        ]
      : []),
    /* 图像生成默认不注册：未配置图像模型的部署里能力根本不存在，五维交集
       因此自然拒绝，模型也看不到这个工具，不会声称自己能画图。 */
    ...(isImageGenerationConfigured()
      ? [
          adaptAgentTool(operationImages.createTool(), {
            capability: IMAGE_GENERATION_CAPABILITY,
            risk: 'l1',
            effect: 'write',
          }),
        ]
      : []),
  ];
  const nodeInvocations = new DrizzleGatewayNodeRepository();
  const adapters = [
    ...localAdapters,
    ...mcpRuntime.adapters,
    ...createNodeToolAdapters(nodeInvocations),
  ];
  return {
    kernel: createWebToolKernel(adapters),
    staticCapabilities: [
      ...localAdapters.map((adapter) => adapter.capability),
      ...mcpRuntime.capabilities,
    ],
    nodeInvocations,
  };
}
