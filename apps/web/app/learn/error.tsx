'use client';

/** 学习页错误边界不向浏览器展示数据库、会话或内部异常详情。 */
export default function LearnError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas p-6">
      <section role="alert" className="w-full max-w-md text-center">
        <p className="text-sm font-medium text-warn">学习空间暂时不可用</p>
        <h1 className="font-display mt-3 text-2xl font-bold text-ink">
          页面加载遇到了一点问题
        </h1>
        <p className="mt-3 leading-7 text-ink-muted">
          请稍后重试；如果问题持续出现，可以返回后再进入学习空间。
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-6 min-h-12 w-full max-w-xs rounded-full bg-accent px-8 py-3 font-semibold text-white transition-colors hover:bg-accent-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
        >
          重新加载
        </button>
      </section>
    </main>
  );
}
