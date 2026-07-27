'use client';

import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { useMemo, useRef, useState } from 'react';
import GradualBlur from '@/components/GradualBlur';
import OptionWheel from '@/components/OptionWheel';
import { GENERATED_SOFT_CLICK } from '@/components/option-wheel-sound';
import type { AssetItem } from '@/features/assets/assets-drawer';
import type { ArtifactSummary } from '@/features/canvas/artifact-client';
import { StudioSourceActions } from './studio-source-actions';
import {
  itemsForRoute,
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
  onOpenSource,
  onOpenOutput,
  onToggleSource,
  onRenameSource,
  onDeleteSource,
}: {
  assets: readonly AssetItem[];
  outputs: readonly ArtifactSummary[];
  onOpenSource: (asset: AssetItem) => void;
  onOpenOutput: (id: string) => void;
  /** 成员私有的启停绑定；与删除/重命名不同，viewer 也能改自己的。 */
  onToggleSource: (asset: AssetItem) => void;
  onRenameSource: (asset: AssetItem, displayName: string) => void;
  onDeleteSource: (asset: AssetItem) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLElement>(null);
  const secondaryRef = useRef<HTMLElement>(null);
  const [route, setRoute] = useState<StudioRoute | null>(null);
  const [centeredId, setCenteredId] = useState<string | null>(null);
  const secondaryItems = useMemo(
    () => (route ? itemsForRoute(route, assets, outputs) : []),
    [assets, outputs, route],
  );
  /* 动作气泡只跟随「来源」轮的居中项。首帧滚轮尚未回调 onChange，
     此时退到列表首项，避免刚展开时气泡空着。 */
  const centeredAsset =
    route === 'source-browse'
      ? (assets.find((asset) => asset.id === centeredId) ?? assets[0] ?? null)
      : null;

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
    const reduce = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;
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
    const routes: readonly StudioRoute[] = ['source-browse', 'output-browse'];
    const nextRoute = routes[index];
    if (!nextRoute) return;
    if (route === nextRoute) {
      collapseSecondary();
      return;
    }
    // 切换到另一路由时清掉可能在途的退场补间，让入场 fromTo 从干净状态重播。
    if (secondaryRef.current) gsap.killTweensOf(secondaryRef.current);
    setRoute(nextRoute);
  };

  /* 按条目 id 而不是下标回查：列表在滚轮播放补间期间刷新（产物完成、来源新增）
     时下标会错位，id 不会。空态条目是 disabled，不会走到这里。 */
  const selectSecondary = (itemId: string) => {
    if (route === 'source-browse') {
      const asset = assets.find((candidate) => candidate.id === itemId);
      if (asset) onOpenSource(asset);
      return;
    }
    if (route === 'output-browse') {
      const output = outputs.find((candidate) => candidate.id === itemId);
      if (output) onOpenOutput(output.id);
    }
  };

  return (
    <div
      ref={rootRef}
      className={`studio-cascade${route ? ' studio-cascade--expanded' : ''}`}
    >
      {route ? (
        <GradualBlur
          target="parent"
          position="right"
          width="52rem"
          strength={2.6}
          divCount={8}
          curve="bezier"
          exponential
          opacity={0.94}
          zIndex={0}
          responsive
          mobileWidth="100%"
          tabletWidth="44rem"
          desktopWidth="52rem"
          className="studio-cascade__gradual-blur"
        />
      ) : null}
      {centeredAsset ? (
        <div className="studio-cascade__actions">
          <StudioSourceActions
            key={centeredAsset.id}
            asset={centeredAsset}
            onToggleEnabled={onToggleSource}
            onRename={onRenameSource}
            onDelete={onDeleteSource}
          />
        </div>
      ) : null}
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
            onChange={(_index, item) => setCenteredId(item.id)}
            onSelect={(_index, item) => selectSecondary(item.id)}
            textColor="var(--color-ink-faint)"
            activeColor="var(--color-accent)"
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
          textColor="var(--color-ink-faint)"
          activeColor="var(--color-accent)"
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
          : '这里只浏览和管理 · 添加与生成请使用输入框 +'}
      </p>
    </div>
  );
}
