'use client';

import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { useMemo, useRef, useState } from 'react';
import OptionWheel from '@/components/OptionWheel';
import { GENERATED_SOFT_CLICK } from '@/components/option-wheel-sound';
import type { AssetItem } from '@/features/assets/assets-drawer';
import type {
  ArtifactSummary,
  CreatableArtifactKind,
} from '@/features/canvas/artifact-client';
import { StudioLinkBubble } from './studio-link-bubble';
import {
  itemsForRoute,
  OUTPUT_ACTIONS,
  ROOT_ITEMS,
  routeLabel,
  type StudioRoute,
} from './studio-workspace-options';
import './studio-workspace.css';

/**
 * 当前 Notebook 的级联 Studio。一级能力轮始终可见，选中的二级能力轮在其
 * 左侧继续展开；组件只分派用户动作，不自行读取或修改 Notebook 数据。
 */
export function StudioWorkspace({
  assets,
  outputs,
  onToggleAsset,
  onUpload,
  onImported,
  onOpenOutput,
  onCreateOutput,
  onCreateBlankNote,
}: {
  assets: readonly AssetItem[];
  outputs: readonly ArtifactSummary[];
  onToggleAsset: (id: string) => void;
  onUpload: (kind: 'document' | 'image') => void;
  onImported: (asset: AssetItem) => void;
  onOpenOutput: (id: string) => void;
  onCreateOutput: (kind: CreatableArtifactKind, defaultTitle: string) => void;
  onCreateBlankNote: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLElement>(null);
  const secondaryRef = useRef<HTMLElement>(null);
  const [route, setRoute] = useState<StudioRoute | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const secondaryItems = useMemo(
    () => (route ? itemsForRoute(route, assets, outputs) : []),
    [assets, outputs, route],
  );

  useGSAP(
    () => {
      const media = gsap.matchMedia();
      media.add('(prefers-reduced-motion: reduce)', () => {
        gsap.set([primaryRef.current, secondaryRef.current], {
          autoAlpha: 1,
          x: 0,
          scale: 1,
          filter: 'blur(0px)',
        });
      });
      media.add('(prefers-reduced-motion: no-preference)', () => {
        gsap.fromTo(
          primaryRef.current,
          {
            autoAlpha: 0,
            x: 92,
            scale: 0.74,
            filter: 'blur(12px)',
            transformOrigin: 'right center',
          },
          {
            autoAlpha: 1,
            x: 0,
            scale: 1,
            filter: 'blur(0px)',
            duration: 0.72,
            ease: 'power4.out',
          },
        );
      });
      return () => media.revert();
    },
    { scope: rootRef },
  );

  useGSAP(
    () => {
      if (!route || !secondaryRef.current) return;
      const media = gsap.matchMedia();
      media.add('(prefers-reduced-motion: reduce)', () => {
        gsap.set(secondaryRef.current, {
          autoAlpha: 1,
          x: 0,
          scale: 1,
          filter: 'blur(0px)',
        });
      });
      media.add('(prefers-reduced-motion: no-preference)', () => {
        gsap.fromTo(
          secondaryRef.current,
          {
            autoAlpha: 0,
            x: 72,
            scale: 0.78,
            filter: 'blur(10px)',
            transformOrigin: 'right center',
          },
          {
            autoAlpha: 1,
            x: 0,
            scale: 1,
            filter: 'blur(0px)',
            duration: 0.58,
            ease: 'back.out(1.35)',
          },
        );
      });
      return () => media.revert();
    },
    { scope: rootRef, dependencies: [route], revertOnUpdate: true },
  );

  /*
   * 收起二级轮：与入场对称地向右淡出并模糊，落幕后再卸载，避免直接消失的突兀。
   * 保持在 useGSAP 之外的命令式回调里，不干扰被入场动画与 revertOnUpdate 管理的
   * 内联样式；reduced-motion 直接卸载不做补间。切换到另一路由不走这里（交由入场重播）。
   */
  const collapseSecondary = () => {
    const el = secondaryRef.current;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!el || reduce) {
      setRoute(null);
      return;
    }
    gsap.to(el, {
      autoAlpha: 0,
      x: 60,
      scale: 0.8,
      filter: 'blur(8px)',
      duration: 0.34,
      ease: 'power3.in',
      overwrite: 'auto',
      onComplete: () => setRoute(null),
    });
  };

  const selectRoot = (index: number) => {
    const routes: readonly StudioRoute[] = [
      'source-add',
      'source-manage',
      'output-create',
      'output-browse',
    ];
    const nextRoute = routes[index];
    if (!nextRoute) return;
    setLinkOpen(false);
    if (route === nextRoute) {
      collapseSecondary();
      return;
    }
    // 切换到另一路由时清掉可能在途的退场补间，让入场 fromTo 从干净状态重播。
    if (secondaryRef.current) gsap.killTweensOf(secondaryRef.current);
    setRoute(nextRoute);
  };

  const selectSecondary = (index: number) => {
    if (route === 'source-add') {
      if (index === 0) onUpload('document');
      else if (index === 1) onUpload('image');
      else if (index === 2) setLinkOpen(true);
      return;
    }
    if (route === 'source-manage') {
      if (index === secondaryItems.length - 1) {
        setRoute('source-add');
        return;
      }
      const asset = assets[index];
      if (asset?.selectable) onToggleAsset(asset.id);
      return;
    }
    if (route === 'output-create') {
      if (index === 0) {
        onCreateBlankNote();
        return;
      }
      const action = OUTPUT_ACTIONS[index - 1];
      if (action) onCreateOutput(...action);
      return;
    }
    if (route === 'output-browse') {
      if (index === secondaryItems.length - 1) {
        setRoute('output-create');
        return;
      }
      const output = outputs[index];
      if (output) onOpenOutput(output.id);
    }
  };

  return (
    <div ref={rootRef} className="studio-cascade">
      {route ? (
        <section
          ref={secondaryRef}
          aria-label={routeLabel(route)}
          className="studio-cascade__wheel studio-cascade__wheel--secondary"
        >
          <OptionWheel
            key={route}
            idPrefix={`studio-secondary-${route}`}
            items={secondaryItems}
            defaultSelected={0}
            onSelect={(index) => selectSecondary(index)}
            textColor="var(--color-ink-faint)"
            activeColor="var(--color-ink)"
            side="right"
            fontSize={2.05}
            spacing={1.5}
            curve={0.9}
            tilt={5.2}
            blur={1.45}
            fade={0.19}
            minOpacity={0.08}
            smoothing={220}
            inset={42}
            draggable
            soundUrl={GENERATED_SOFT_CLICK}
            soundVolume={0.34}
            ariaLabel={routeLabel(route)}
            className="font-display"
          />
        </section>
      ) : null}
      <section
        ref={primaryRef}
        aria-label="Studio 一级能力"
        className="studio-cascade__wheel studio-cascade__wheel--primary"
      >
        <OptionWheel
          idPrefix="studio-primary"
          items={ROOT_ITEMS}
          defaultSelected={0}
          onSelect={(index) => selectRoot(index)}
          textColor="var(--color-ink-muted)"
          activeColor="var(--color-ink)"
          side="right"
          fontSize={2.75}
          spacing={1.55}
          curve={1}
          tilt={6.2}
          blur={1.8}
          fade={0.22}
          minOpacity={0.08}
          smoothing={200}
          inset={46}
          draggable
          soundUrl={GENERATED_SOFT_CLICK}
          soundVolume={0.38}
          ariaLabel="选择 Studio 能力"
          className="font-display"
        />
      </section>
      <p className="studio-cascade__hint">
        {route
          ? '一级保持可见 · 再点当前一级可收起二级'
          : '滚轮或拖动浏览 · 再点中心项展开二级'}
      </p>
      {linkOpen ? (
        <StudioLinkBubble
          onCancel={() => setLinkOpen(false)}
          onImported={(asset) => {
            onImported(asset);
            setLinkOpen(false);
            setRoute('source-manage');
          }}
        />
      ) : null}
    </div>
  );
}
