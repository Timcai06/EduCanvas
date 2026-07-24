'use client';

import type {
  ProgressDTO,
  StudyProgressDTO,
} from '@/features/learning/learning-contracts';
import { SealStamp } from '@/features/workspace/shared/two-pen-marks';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { useRef } from 'react';

gsap.registerPlugin(useGSAP);

/** 印章只在服务端投影表明高掌握时出现；阈值只影响展示，不参与任何判定。 */
const SEAL_MASTERY_PERCENT = 80;

const shanghaiDateFormatter = new Intl.DateTimeFormat('zh-CN', {
  month: 'long',
  day: 'numeric',
  timeZone: 'Asia/Shanghai',
});

function formatReviewDate(value: string | null): string {
  if (!value) return '完成练习后生成';
  return shanghaiDateFormatter.format(new Date(value));
}

// 目标状态决定路径节点的笔色：优势=黛青实心，重点=朱砂实心，待学习=空心。
// 语义同时由右侧文案承载，色弱与无色环境下含义不丢失（见 two-pen-marks 同款约束）。
const STATUS_LABEL: Record<
  StudyProgressDTO['objectives'][number]['status'],
  string
> = {
  strength: '优势',
  focus: '重点',
  not_started: '待学习',
};

/**
 * 进度详情：只展示服务端可信投影（ProgressDTO），客户端不自行估算掌握度。
 * 常驻形态是顶栏徽章；本组件只在学生主动展开抽屉时出现，避免数字成为压力源。
 * 目标不再堆成仪表盘方块，而是连成一条能读懂的成长路径——当前所在处显式标记，
 * 掌握度退为路径上方的一层氛围。
 */
export function ProgressDrawer({
  progress,
  study,
}: {
  progress: ProgressDTO | null;
  study: StudyProgressDTO;
}) {
  const masteryPercent = progress?.masteryPercent ?? 0;
  const rootRef = useRef<HTMLElement>(null);

  // 路径「画出」入场：节点自上而下依次落定、连线随之向下延伸，像一笔写成的成长线。
  // reduced-motion 下不建 Timeline，路径静态呈现。
  useGSAP(
    () => {
      const media = gsap.matchMedia();
      media.add('(prefers-reduced-motion: no-preference)', () => {
        gsap.set('.path-connector', { transformOrigin: 'top center' });
        const timeline = gsap.timeline();
        timeline.from('.path-node', {
          opacity: 0,
          x: -6,
          duration: 0.35,
          ease: 'power2.out',
          stagger: 0.08,
        });
        timeline.from(
          '.path-connector',
          { scaleY: 0, duration: 0.3, ease: 'power1.out', stagger: 0.08 },
          0.1,
        );
      });
      return () => media.revert();
    },
    { scope: rootRef },
  );

  return (
    <section ref={rootRef} aria-label="学习进度" className="space-y-6">
      <div>
        <div className="mb-2 flex items-center justify-between gap-3">
          <span
            id="mastery-progress-label"
            className="inline-flex items-center gap-2.5 font-medium text-ink"
          >
            当前掌握度
            {masteryPercent >= SEAL_MASTERY_PERCENT ? (
              <SealStamp char="掌" label="已达到牢固掌握" />
            ) : null}
          </span>
          <span className="font-semibold text-accent-strong tabular-nums">
            {masteryPercent}%
          </span>
        </div>
        {/* 自绘进度条：<progress> 的 accent-color 在各浏览器表现不一致 */}
        <div
          role="progressbar"
          aria-labelledby="mastery-progress-label"
          aria-valuenow={masteryPercent}
          aria-valuemin={0}
          aria-valuemax={100}
          className="h-2.5 w-full overflow-hidden rounded-full bg-surface-strong"
        >
          <div
            className="h-full rounded-full bg-accent"
            style={{ width: `${masteryPercent}%` }}
          />
        </div>
        {/* 计数退为一行次要注脚，不再抢占仪表盘位置 */}
        {progress ? (
          <p className="mt-2.5 text-xs text-ink-muted tabular-nums">
            答对 {progress.correctItems}/{progress.attemptedItems} · 提示{' '}
            {progress.hintCount} 次 · 下次复习{' '}
            {formatReviewDate(progress.nextReviewAt)}
          </p>
        ) : (
          <p className="mt-2.5 text-xs text-ink-muted">
            完成第一道练习后，这里会显示由老师批改得出的掌握度与复习建议。
          </p>
        )}
      </div>

      <div className="border-t border-line pt-5">
        <p className="mb-4 text-sm font-semibold text-ink">
          {study.desiredOutcome}
        </p>
        <ol className="relative">
          {study.objectives.map((objective, index) => {
            const isCurrent = objective.objectiveKey === study.nextObjectiveKey;
            const isLast = index === study.objectives.length - 1;
            const dotClass = isCurrent
              ? 'size-3 rounded-full bg-accent ring-4 ring-accent-soft'
              : objective.status === 'focus'
                ? 'size-2.5 rounded-full bg-cinnabar'
                : objective.status === 'strength'
                  ? 'size-2.5 rounded-full bg-accent'
                  : 'size-2.5 rounded-full border-2 border-line bg-card';
            const statusClass = isCurrent
              ? 'shrink-0 text-xs font-medium text-accent-strong'
              : objective.status === 'focus'
                ? 'shrink-0 text-xs font-medium text-cinnabar'
                : 'shrink-0 text-xs text-ink-faint';
            return (
              <li
                key={objective.objectiveKey}
                className="path-node relative flex gap-3 pb-5 last:pb-0"
              >
                {!isLast ? (
                  <span
                    aria-hidden="true"
                    className="path-connector absolute top-6 bottom-0 left-[11px] w-px bg-line"
                  />
                ) : null}
                <span className="relative z-10 grid size-6 shrink-0 place-items-center">
                  <span aria-hidden="true" className={dotClass} />
                </span>
                <div
                  className={`flex flex-1 items-center justify-between gap-3 rounded-xl px-3 py-2 text-sm ${
                    isCurrent ? 'bg-accent-soft' : ''
                  }`}
                >
                  <span className="min-w-0 truncate text-ink">
                    {objective.title}
                  </span>
                  <span className={statusClass}>
                    {isCurrent ? '在学' : STATUS_LABEL[objective.status]}
                  </span>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
