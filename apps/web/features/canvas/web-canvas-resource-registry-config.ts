import type { CanvasResourceRendererProps } from './canvas-resource-registry';

/**
 * Web 注册表配置：只声明 manifest 和 rendererId 的映射关系。
 * 不导入任何 React 组件，避免测试时的 JSX 转换问题。
 */
export interface WebRegistryEntry {
  readonly rendererId: string;
  readonly manifest: {
    readonly manifestVersion: 1;
    readonly rendererId: string;
    readonly rendererVersion: number;
    readonly representations: readonly string[];
    readonly trustTiers: readonly string[];
    readonly runtimeKinds: readonly string[];
    readonly supportedActions: readonly string[];
  };
}

export const WEB_REGISTRY_ENTRIES: readonly WebRegistryEntry[] = [
  {
    rendererId: 'source.pdf',
    manifest: {
      manifestVersion: 1,
      rendererId: 'source.pdf',
      rendererVersion: 1,
      representations: ['document'],
      trustTiers: ['tier1'],
      runtimeKinds: ['none'],
      supportedActions: ['view', 'download', 'rename', 'delete'],
    },
  },
  {
    rendererId: 'source.image',
    manifest: {
      manifestVersion: 1,
      rendererId: 'source.image',
      rendererVersion: 1,
      representations: ['image'],
      trustTiers: ['tier1'],
      runtimeKinds: ['none'],
      supportedActions: ['view', 'download', 'rename', 'delete'],
    },
  },
  {
    rendererId: 'source.markdown',
    manifest: {
      manifestVersion: 1,
      rendererId: 'source.markdown',
      rendererVersion: 1,
      representations: ['text', 'document'],
      trustTiers: ['tier1'],
      runtimeKinds: ['none'],
      supportedActions: ['view', 'download', 'rename', 'delete'],
    },
  },
  {
    rendererId: 'source.text',
    manifest: {
      manifestVersion: 1,
      rendererId: 'source.text',
      rendererVersion: 1,
      representations: ['text'],
      trustTiers: ['tier1'],
      runtimeKinds: ['none'],
      supportedActions: ['view', 'download', 'rename', 'delete'],
    },
  },
  {
    rendererId: 'source.docx',
    manifest: {
      manifestVersion: 1,
      rendererId: 'source.docx',
      rendererVersion: 1,
      representations: ['document'],
      trustTiers: ['tier1'],
      runtimeKinds: ['none'],
      supportedActions: ['view', 'download', 'rename', 'delete'],
    },
  },
  {
    rendererId: 'source.audio',
    manifest: {
      manifestVersion: 1,
      rendererId: 'source.audio',
      rendererVersion: 1,
      representations: ['audio'],
      trustTiers: ['tier1'],
      runtimeKinds: ['none'],
      supportedActions: ['view', 'download', 'rename', 'delete'],
    },
  },
  {
    rendererId: 'source.video',
    manifest: {
      manifestVersion: 1,
      rendererId: 'source.video',
      rendererVersion: 1,
      representations: ['video'],
      trustTiers: ['tier1'],
      runtimeKinds: ['none'],
      supportedActions: ['view', 'download', 'rename', 'delete'],
    },
  },
  {
    rendererId: 'artifact.mind-map',
    manifest: {
      manifestVersion: 1,
      rendererId: 'artifact.mind-map',
      rendererVersion: 1,
      representations: ['structured'],
      trustTiers: ['tier1'],
      runtimeKinds: ['none'],
      supportedActions: ['view', 'regenerate'],
    },
  },
  {
    rendererId: 'artifact.slides',
    manifest: {
      manifestVersion: 1,
      rendererId: 'artifact.slides',
      rendererVersion: 1,
      representations: ['structured'],
      trustTiers: ['tier1'],
      runtimeKinds: ['none'],
      supportedActions: ['view', 'regenerate'],
    },
  },
  {
    rendererId: 'artifact.flashcards',
    manifest: {
      manifestVersion: 1,
      rendererId: 'artifact.flashcards',
      rendererVersion: 1,
      representations: ['structured'],
      trustTiers: ['tier1'],
      runtimeKinds: ['none'],
      supportedActions: ['view', 'regenerate'],
    },
  },
  {
    rendererId: 'artifact.audio-overview',
    manifest: {
      manifestVersion: 1,
      rendererId: 'artifact.audio-overview',
      rendererVersion: 1,
      representations: ['audio'],
      trustTiers: ['tier2'],
      runtimeKinds: ['none'],
      supportedActions: ['view', 'download', 'delete'],
    },
  },
  {
    rendererId: 'artifact.generated-image',
    manifest: {
      manifestVersion: 1,
      rendererId: 'artifact.generated-image',
      rendererVersion: 1,
      representations: ['image'],
      trustTiers: ['tier2'],
      runtimeKinds: ['none'],
      supportedActions: ['view', 'download', 'delete'],
    },
  },
];

export type WebRendererComponentMap = Record<
  string,
  React.ComponentType<CanvasResourceRendererProps>
>;
