'use client';

import { useMemo, useState, type KeyboardEvent } from 'react';
import type { WebAppContent } from '@educanvas/canvas-protocol';
import { CanvasShellStatus } from './canvas-shell-status';
import { PersistentWebRuntime } from './persistent-web-runtime';

type TabKey = 'preview' | 'source' | 'build';

type WebAppArtifactViewProps = {
  artifactId: string;
  artifactVersionId: string;
  content: WebAppContent;
  presentation: 'canvas' | 'live-preview';
};

const tabs: ReadonlyArray<{ key: TabKey; label: string }> = [
  { key: 'preview', label: '预览' },
  { key: 'source', label: '源码' },
  { key: 'build', label: '构建' },
];

const budgetLabelMap: Array<[keyof WebAppContent['budget'], string]> = [
  ['maxInputBytes', '输入预算'],
  ['maxMessageBytes', '消息预算'],
  ['maxOutputBytes', '输出预算'],
  ['maxDurationMs', '会话时长(ms)'],
  ['maxConcurrentInstances', '并发实例'],
  ['maxQueueDepth', '队列深度'],
  ['maxMessagesPerSecond', '每秒消息'],
];

function formatSourceFiles(content: WebAppContent) {
  return content.manifest.files
    .slice()
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((file) => (
      <section
        key={file.path}
        className="min-w-0 rounded-md border border-stroke px-3 py-2"
      >
        <h3 className="truncate text-xs font-semibold text-ink-muted">
          {file.path}
        </h3>
        <p className="mt-1 text-xs text-ink">
          {file.mediaType} · hash {file.hash.slice(0, 8)}
        </p>
        <pre className="mt-2 max-h-56 overflow-auto rounded bg-surface-subtle p-2 text-xs text-ink">
          {file.content}
        </pre>
      </section>
    ));
}

function formatBuildInfo(content: WebAppContent) {
  return (
    <div className="flex min-w-0 flex-col gap-3 text-xs text-ink">
      <div className="rounded-md border border-stroke p-3">
        <h3 className="mb-2 text-sm font-semibold text-ink">Diagnostics</h3>
        {content.diagnostics.length > 0 ? (
          <ul className="list-disc space-y-1 pl-4">
            {content.diagnostics.map((diagnostic) => (
              <li key={diagnostic.code}>{diagnostic.code}</li>
            ))}
          </ul>
        ) : (
          <p className="text-ink-muted">无诊断项</p>
        )}
      </div>
      <div className="rounded-md border border-stroke p-3">
        <h3 className="mb-2 text-sm font-semibold text-ink">Capabilities</h3>
        <ul className="list-disc space-y-1 pl-4">
          {content.capabilities.map((capability) => (
            <li key={capability}>{capability}</li>
          ))}
        </ul>
      </div>
      <div className="rounded-md border border-stroke p-3">
        <h3 className="mb-2 text-sm font-semibold text-ink">
          Locked Dependencies
        </h3>
        {content.lockedDependencies.length > 0 ? (
          <ul className="space-y-1">
            {content.lockedDependencies.map((dependency) => (
              <li
                key={`${dependency.name}@${dependency.version}`}
                className="rounded bg-surface-subtle px-2 py-1"
              >
                {dependency.name} {dependency.version}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-ink-muted">无锁定依赖</p>
        )}
      </div>
      <div className="rounded-md border border-stroke p-3">
        <h3 className="mb-2 text-sm font-semibold text-ink">Budget</h3>
        <dl className="grid gap-1 sm:grid-cols-2">
          {budgetLabelMap.map(([key, label]) => (
            <div
              key={key}
              className="flex items-center justify-between gap-2 rounded bg-surface-subtle px-2 py-1"
            >
              <dt className="text-ink-muted">{label}</dt>
              <dd className="font-mono text-ink">{content.budget[key]}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

export function WebAppArtifactView({
  artifactId,
  artifactVersionId,
  content,
  presentation,
}: WebAppArtifactViewProps) {
  const [activeTab, setActiveTab] = useState<TabKey>('preview');
  const tabIds = useMemo(() => {
    const map: Record<TabKey, string> = {
      preview: 'web-app-tab-preview',
      source: 'web-app-tab-source',
      build: 'web-app-tab-build',
    };
    const panelMap: Record<TabKey, string> = {
      preview: 'web-app-panel-preview',
      source: 'web-app-panel-source',
      build: 'web-app-panel-build',
    };
    return { tabs: map, panels: panelMap };
  }, []);

  const sourcePanel = formatSourceFiles(content);
  const buildPanel = formatBuildInfo(content);

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const currentIndex = tabs.findIndex((item) => item.key === activeTab);
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      const next = tabs[(currentIndex + 1) % tabs.length]!.key;
      setActiveTab(next);
      return;
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next = tabs[(currentIndex - 1 + tabs.length) % tabs.length]!.key;
      setActiveTab(next);
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      setActiveTab(tabs[0]!.key);
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      setActiveTab(tabs[tabs.length - 1]!.key);
      return;
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        role="tablist"
        aria-label="Web App 视图"
        className="mb-3 flex gap-2 border-b border-stroke"
      >
        {tabs.map((tab) => {
          const isActive = tab.key === activeTab;
          return (
            <button
              key={tab.key}
              id={tabIds.tabs[tab.key]}
              role="tab"
              aria-selected={isActive}
              aria-controls={tabIds.panels[tab.key]}
              tabIndex={isActive ? 0 : -1}
              onClick={() => setActiveTab(tab.key)}
              onKeyDown={handleTabKeyDown}
              className={`rounded-t border-x border-t border-transparent px-3 py-2 text-sm ${
                isActive
                  ? 'border-b-white bg-surface text-ink'
                  : 'text-ink-muted hover:bg-surface'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <div
        id={tabIds.panels.preview}
        role="tabpanel"
        aria-labelledby={tabIds.tabs.preview}
        hidden={activeTab !== 'preview'}
        className="min-h-0 min-w-0 flex-1"
      >
        {presentation === 'live-preview' ? (
          <CanvasShellStatus
            status="unavailable"
            title="交互网页需在 Canvas 打开"
            description="Live 预览不会启动持久运行任务；结束语音后可在 Canvas 中完整交互。"
          />
        ) : (
          <PersistentWebRuntime
            key={artifactVersionId}
            artifactId={artifactId}
            artifactVersionId={artifactVersionId}
          />
        )}
      </div>

      <div
        id={tabIds.panels.source}
        role="tabpanel"
        aria-labelledby={tabIds.tabs.source}
        hidden={activeTab !== 'source'}
        className="min-h-0 min-w-0 flex-1 overflow-auto"
      >
        <div className="space-y-3">
          <p className="text-sm text-ink">入口文件：{content.manifest.entry}</p>
          {sourcePanel}
        </div>
      </div>

      <div
        id={tabIds.panels.build}
        role="tabpanel"
        aria-labelledby={tabIds.tabs.build}
        hidden={activeTab !== 'build'}
        className="min-h-0 min-w-0 flex-1 overflow-auto"
      >
        {buildPanel}
      </div>
    </div>
  );
}
