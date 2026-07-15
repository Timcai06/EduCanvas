'use client';

/** 学习页错误边界不向浏览器展示数据库、会话或内部异常详情。 */
export default function LearnError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-100 p-6">
      <section
        role="alert"
        className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-sm sm:p-8"
      >
        <p className="mb-2 text-sm font-medium text-amber-700">
          学习空间暂时不可用
        </p>
        <h1 className="text-2xl font-bold text-slate-950">
          页面加载遇到了一点问题
        </h1>
        <p className="mt-3 text-slate-600">
          请稍后重试；如果问题持续出现，可以返回后再进入学习空间。
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-6 min-h-11 w-full rounded-xl bg-indigo-600 px-5 py-3 font-semibold text-white transition-colors hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2"
        >
          重新加载
        </button>
      </section>
    </main>
  );
}
