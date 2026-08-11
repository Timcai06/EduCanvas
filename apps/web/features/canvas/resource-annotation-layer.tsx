'use client';

import type {
  CanvasAnnotation,
  CanvasResourceKind,
} from '@educanvas/canvas-protocol';
import { useEffect, useState } from 'react';
import { fetchResourceAnnotations } from './resource-annotation-client';

function Mark({ annotation }: { annotation: CanvasAnnotation }) {
  const { x, y, width = 0.16, height = 0.11 } = annotation.geometry;
  const color = annotation.authorPen === 'zhusha' ? '#a44233' : '#44354f';
  if (annotation.kind === 'underline' || annotation.kind === 'strike') {
    const lineY = annotation.kind === 'underline' ? y + height : y + height / 2;
    return (
      <path
        d={`M ${x * 100} ${lineY * 100} Q ${(x + width / 2) * 100} ${(lineY + 0.008) * 100} ${(x + width) * 100} ${lineY * 100}`}
        fill="none"
        stroke={color}
        strokeWidth="0.8"
        strokeLinecap="round"
      />
    );
  }
  return (
    <ellipse
      cx={(x + width / 2) * 100}
      cy={(y + height / 2) * 100}
      rx={(width / 2) * 100}
      ry={(height / 2) * 100}
      fill="none"
      stroke={color}
      strokeWidth="0.9"
      strokeLinecap="round"
      strokeDasharray={annotation.kind === 'note' ? '2 1.5' : undefined}
    />
  );
}

/** 已鉴权资源上的纸面痕迹层；加载失败保持安静，不遮挡资源本体操作。 */
export function ResourceAnnotationLayer({
  resourceKind,
  resourceId,
}: {
  resourceKind: CanvasResourceKind;
  resourceId: string;
}) {
  const [annotations, setAnnotations] = useState<readonly CanvasAnnotation[]>(
    [],
  );
  useEffect(() => {
    const controller = new AbortController();
    void fetchResourceAnnotations({
      resourceKind,
      resourceId,
      signal: controller.signal,
    })
      .then(setAnnotations)
      .catch(() => undefined);
    return () => controller.abort();
  }, [resourceId, resourceKind]);

  if (annotations.length === 0) return null;
  return (
    <svg
      className="pointer-events-none absolute inset-0 z-30 h-full w-full overflow-visible"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden="true"
      data-resource-annotations
    >
      {annotations.map((annotation) => (
        <Mark key={annotation.id} annotation={annotation} />
      ))}
    </svg>
  );
}
