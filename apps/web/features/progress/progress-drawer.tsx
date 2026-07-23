'use client';

import type { ProgressDTO } from '@/features/learning/learning-contracts';
import { SealStamp } from '@/features/workspace/shared/two-pen-marks';

/** 印章只在服务端投影表明高掌握时出现;阈值只影响展示,不参与任何判定。 */
const SEAL_MASTERY_PERCENT = 80;

const shanghaiDateFormatter = new Intl.DateTimeFormat('zh-CN', {
  dateStyle: 'medium',
  timeZone: 'Asia/Shanghai',
});

function formatReviewDate(value: string | null): string {
  if (!value) return '完成更多练习后生成';
  return shanghaiDateFormatter.format(new Date(value));
}

/**
 * 进度详情：只展示服务端可信投影（ProgressDTO），客户端不自行估算掌握度。
 * 常驻形态是顶栏徽章；本组件只在学生主动展开抽屉时出现，避免数字成为压力源。
 */
export function ProgressDrawer({ progress }: { progress: ProgressDTO | null }) {
  const masteryPercent = progress?.masteryPercent ?? 0;

  return (
    <section aria-label="学习进度" className="space-y-6">
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
          <span className="font-semibold text-accent-strong">
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
      </div>

      {progress ? (
        <dl className="grid grid-cols-2 gap-2.5">
          <div className="rounded-2xl bg-surface p-4">
            <dt className="text-sm text-ink-muted">已作答</dt>
            <dd className="mt-1 text-2xl font-semibold text-ink tabular-nums">
              {progress.attemptedItems}
            </dd>
          </div>
          <div className="rounded-2xl bg-surface p-4">
            <dt className="text-sm text-ink-muted">答对</dt>
            <dd className="mt-1 text-2xl font-semibold text-ink tabular-nums">
              {progress.correctItems}
            </dd>
          </div>
          <div className="rounded-2xl bg-surface p-4">
            <dt className="text-sm text-ink-muted">使用提示</dt>
            <dd className="mt-1 text-2xl font-semibold text-ink tabular-nums">
              {progress.hintCount}
            </dd>
          </div>
          <div className="rounded-2xl bg-surface p-4">
            <dt className="text-sm text-ink-muted">下次复习</dt>
            <dd className="mt-1 font-medium text-ink">
              {formatReviewDate(progress.nextReviewAt)}
            </dd>
          </div>
        </dl>
      ) : (
        <p className="rounded-2xl bg-surface p-4 text-sm text-ink-muted">
          完成第一道练习后，这里会显示由老师批改得出的掌握度与复习建议。
        </p>
      )}
    </section>
  );
}
