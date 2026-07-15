'use client';

import type { PublicArtifact } from '@educanvas/canvas-protocol';
import { useState } from 'react';
import { CanvasArtifactRenderer } from './canvas-registry';
import type { AnimationClientObservation } from './animation-shell';

export function PipelineFlowQa({ artifact }: { artifact: PublicArtifact }) {
  const [lastObservation, setLastObservation] =
    useState<AnimationClientObservation | null>(null);

  return (
    <div className="w-full max-w-7xl">
      <CanvasArtifactRenderer
        artifact={artifact}
        disabled={false}
        feedback={null}
        onSubmit={() => {
          // Render-only templates cannot submit assessment drafts.
        }}
        onAnimationObservation={setLastObservation}
      />
      <p
        className="mt-4 text-center text-xs text-ink-faint"
        aria-live="polite"
        data-testid="animation-observation"
      >
        {lastObservation
          ? `仅客户端观察：${lastObservation.type}`
          : '尚未产生客户端动画观察'}
      </p>
    </div>
  );
}
