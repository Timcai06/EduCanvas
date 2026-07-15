import type { ProgressDTO } from '@/features/learning/learning-contracts';

const shanghaiDateFormatter = new Intl.DateTimeFormat('zh-CN', {
  dateStyle: 'medium',
  timeZone: 'Asia/Shanghai',
});

function formatReviewDate(value: string | null): string {
  if (!value) return '完成更多练习后生成';
  return shanghaiDateFormatter.format(new Date(value));
}

/** 学习进度只展示服务端可信投影，不根据客户端选择自行估算掌握度。 */
export function ProgressPanel({ progress }: { progress: ProgressDTO | null }) {
  const masteryPercent = progress?.masteryPercent ?? 0;

  return (
    <div className="flex h-full flex-col">
      <h2 className="mb-4 text-lg font-semibold">学习进度</h2>
      <div className="flex-1 space-y-5 rounded-lg border border-slate-300 p-4 text-sm">
        <div>
          <div className="mb-2 flex items-center justify-between gap-3">
            <label htmlFor="mastery-progress" className="font-medium">
              当前掌握度
            </label>
            <span className="font-semibold text-indigo-700">
              {masteryPercent}%
            </span>
          </div>
          <progress
            id="mastery-progress"
            value={masteryPercent}
            max={100}
            className="h-3 w-full accent-indigo-600"
          >
            {masteryPercent}%
          </progress>
        </div>

        {progress ? (
          <dl className="grid grid-cols-2 gap-3">
            <div className="rounded-lg bg-slate-50 p-3">
              <dt className="text-slate-600">已作答</dt>
              <dd className="mt-1 text-xl font-semibold">
                {progress.attemptedItems}
              </dd>
            </div>
            <div className="rounded-lg bg-slate-50 p-3">
              <dt className="text-slate-600">答对</dt>
              <dd className="mt-1 text-xl font-semibold">
                {progress.correctItems}
              </dd>
            </div>
            <div className="rounded-lg bg-slate-50 p-3">
              <dt className="text-slate-600">使用提示</dt>
              <dd className="mt-1 text-xl font-semibold">
                {progress.hintCount}
              </dd>
            </div>
            <div className="rounded-lg bg-slate-50 p-3">
              <dt className="text-slate-600">下次复习</dt>
              <dd className="mt-1 font-medium">
                {formatReviewDate(progress.nextReviewAt)}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="rounded-lg bg-slate-50 p-3 text-slate-600">
            完成第一道练习后，这里会显示由服务端计算的掌握度与复习建议。
          </p>
        )}
      </div>
    </div>
  );
}
