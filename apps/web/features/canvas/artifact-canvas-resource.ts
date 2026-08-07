import type {
  CanvasRepresentationKind,
  CanvasResource,
  CanvasRuntimeKind,
} from '@educanvas/canvas-protocol';
import type { ArtifactDetail } from './artifact-client';

/**
 * W04-3（方案 A）：把 Artifact 详情映射为「渲染用 CanvasResource」。
 *
 * 接口缺口：`ArtifactDetail.canvasResource` 只携带 `allowedActions`，没有
 * rendererId / notebookId / representation / provenance / runtime 等协议字段，
 * 因此这里按 artifact.kind 在浏览器端补齐这些字段，供 Registry 选择 Renderer。
 * 这些补齐值只用于选择与渲染（Renderer 实际只消费 title / allowedActions 与
 * 组合层注入的受控 `content`），不会写回服务端。后端在 detail 里补全协议字段
 * 后，本模块的映射与构造可整体删除（缺口见 W 台账 W04-3 节）。
 */

/** artifact.kind → Registry rendererId 的前端映射。 */
export const ARTIFACT_KIND_RENDERER_ID: Readonly<Record<string, string>> = {
  mind_map: 'artifact.mind-map',
  slides: 'artifact.slides',
  flashcards: 'artifact.flashcards',
  audio_overview: 'artifact.audio-overview',
  generated_image: 'artifact.generated-image',
  note: 'artifact.note',
  dom_exploration: 'artifact.dom-exploration',
};

const KIND_REPRESENTATION: Readonly<Record<string, CanvasRepresentationKind>> = {
  mind_map: 'structured',
  slides: 'structured',
  flashcards: 'structured',
  audio_overview: 'audio',
  generated_image: 'image',
  note: 'structured',
  dom_exploration: 'interactive_app',
};

const KIND_MIME_TYPE: Readonly<Record<string, string>> = {
  structured: 'application/json',
  audio: 'audio/mpeg',
  image: 'image/png',
  interactive_app: 'text/html',
};

/** artifact.kind → runtime 种类；仅 dom_exploration 需要沙箱。 */
const KIND_RUNTIME: Readonly<Record<string, CanvasRuntimeKind>> = {
  mind_map: 'none',
  slides: 'none',
  flashcards: 'none',
  audio_overview: 'none',
  generated_image: 'none',
  note: 'none',
  dom_exploration: 'web_sandbox',
};

/**
 * detail 未提供的必填占位值。notebookId 属于归属投影，前端不知道 Notebook 归属；
 * 这里只作协议完整性占位，Renderer 与选择逻辑都不读取它。
 */
const UNKNOWN_NOTEBOOK_ID = 'unknown-notebook';

/**
 * 构造用于 Registry 选择的渲染用 CanvasResource（probe）。
 *
 * 只有 status='ready' 时才带 version（协议要求可读取资源必须引用真实版本）；
 * 尚无版本时给 processing，让 Registry 选择仍可发生、由内容分发处理骨架态。
 * 未知 kind 直接抛错——调用方只在已知内容驱动 kind 上调用，抛错是开发期错误。
 */
export function buildArtifactCanvasResource(detail: ArtifactDetail): CanvasResource {
  const rendererId = ARTIFACT_KIND_RENDERER_ID[detail.artifact.kind];
  if (!rendererId) {
    throw new Error(
      `Unsupported artifact kind for canvas resource: ${detail.artifact.kind}`,
    );
  }
  /* rendererId 已在上方抛错保护，kind 必然在映射内；! 仅为类型收窄。 */
  const representationKind = KIND_REPRESENTATION[detail.artifact.kind]!;
  const runtimeKind = KIND_RUNTIME[detail.artifact.kind]!;
  return {
    schemaVersion: 1,
    resourceId: detail.artifact.id,
    notebookId: UNKNOWN_NOTEBOOK_ID,
    resourceKind: 'artifact',
    title: detail.artifact.title,
    status: detail.version ? 'ready' : 'processing',
    version: detail.version
      ? {
          versionId: detail.version.id,
          sequence: detail.version.version,
          checksum: null,
        }
      : null,
    representation: {
      kind: representationKind,
      mimeType: KIND_MIME_TYPE[representationKind]!,
      byteSize: null,
    },
    renderer: { rendererId, rendererVersion: 1 },
    trustTier: detail.artifact.trustTier,
    /* detail 的动作是 readonly，协议要求可变数组；拷贝一份避免别名共享。 */
    allowedActions: [...(detail.canvasResource?.allowedActions ?? [])],
    canProduceCandidateLearningEvents: false,
    provenance: {
      origin: 'agent_generated',
      createdBy: 'agent',
      createdAt: detail.artifact.createdAt,
      sourceResourceIds: [],
      operationId: null,
      generator: null,
    },
    runtime:
      runtimeKind === 'web_sandbox'
        ? {
            kind: 'web_sandbox',
            protocolVersion: 1,
            maxDurationMs: 300_000,
            maxOutputBytes: 5 * 1024 * 1024,
            network: 'none',
          }
        : { kind: 'none' },
  };
}
