'use client';

import { useMemo } from 'react';
import {
  SANDBOX_IFRAME_PERMISSIONS,
  buildSandboxDocument,
} from './sandbox-preview';

/**
 * Tier 2 沙箱执行面（ADR-0010）。模型 HTML 只在这里运行：
 * 无 same-origin、无网络（文档级 CSP）、无弹窗与顶层导航。
 * v1 是纯展示型沙箱，不建立 postMessage 桥；沙箱内交互不产生任何可信学习事件。
 */
export function HtmlSandbox({
  source,
  title,
}: {
  source: string;
  title: string;
}) {
  const srcDoc = useMemo(() => buildSandboxDocument(source), [source]);
  return (
    <iframe
      sandbox={SANDBOX_IFRAME_PERMISSIONS}
      srcDoc={srcDoc}
      title={title}
      referrerPolicy="no-referrer"
      loading="lazy"
      className="h-full w-full rounded-2xl border border-line/80 bg-[#101116]"
    />
  );
}
