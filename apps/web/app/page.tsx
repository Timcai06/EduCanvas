import Link from 'next/link';

/**
 * 保持首页为低认知负担的单入口，让首次使用的学生直接进入学习主流程。
 * 产品入口原则见 docs/01-product/product-definition.md。
 */
export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-4xl font-bold">EduCanvas</h1>
      <p className="max-w-md text-center text-slate-600">
        多模态 K12 人工智能通识课教学助手——通过对话、动画和互动练习学习 AI 知识。
      </p>
      <Link
        href="/learn"
        className="rounded-lg bg-blue-600 px-6 py-3 text-white transition hover:bg-blue-700"
      >
        开始学习
      </Link>
    </main>
  );
}
