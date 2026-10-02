'use client';
import Link from 'next/link';
import { NotebookPlanCreationForms } from './notebook-plan-creation-forms';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { NotebookDirectory } from '@/features/workspace/general/notebook-directory';
interface Source {
  id: string;
  versionId: string;
  title: string;
}
import type {
  NotebookChapterDTO as Chapter,
  NotebookPlanSourceDTO as PlanSource,
  NotebookPlanDTO as Plan,
} from './notebook-plan-contracts';
interface Conversation {
  id: string;
  title: string | null;
}
interface Goal {
  topic: string;
  desiredOutcome: string;
  status: string;
}
const button =
  'min-h-11 rounded-xl border border-line bg-surface px-4 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50';
export function NotebookPlanWorkspace({
  notebookId,
  title: notebookTitle,
}: {
  notebookId: string;
  title: string;
}) {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [goal, setGoal] = useState<Goal | null>(null);
  const [canWrite, setCanWrite] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sourceKind, setSourceKind] = useState<
    'conversation' | 'chapter' | 'purpose'
  >('conversation');
  const [selectedSource, setSelectedSource] = useState('');
  const [chapterAsset, setChapterAsset] = useState('');
  const [rangeKind, setRangeKind] = useState<'whole' | 'pages' | 'text'>(
    'whole',
  );
  const base = `/api/v1/notebooks/${notebookId}`;
  const reload = useCallback(
    async (signal?: AbortSignal) => {
      const responses = await Promise.all(
        ['plans', 'chapters', 'sources', 'conversations'].map((path) =>
          fetch(`${base}/${path}`, { signal }),
        ),
      );
      if (responses.some((response) => !response.ok))
        throw new Error('unavailable');
      const [planData, chapterData, sourceData, conversationData] =
        await Promise.all(responses.map((response) => response.json()));
      if (signal?.aborted) return;
      setPlans(planData.plans);
      setGoal(planData.goal);
      setCanWrite(planData.canWrite);
      setChapters(chapterData.chapters);
      setSources(sourceData.sources);
      setConversations(conversationData.conversations);
      setLoading(false);
    },
    [base],
  );
  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve()
      .then(() => reload(controller.signal))
      .catch(() => {
        if (!controller.signal.aborted) {
          setError('学习计划暂时无法读取，请重新加载。');
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [reload]);
  async function mutate(path: string, body: object, method = 'POST') {
    const response = await fetch(`${base}/${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error('request_failed');
    return response.json();
  }
  async function createPlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const source: PlanSource =
      sourceKind === 'conversation'
        ? { kind: 'conversation', conversationId: selectedSource }
        : sourceKind === 'chapter'
          ? { kind: 'chapter', chapterId: selectedSource }
          : {
              kind: 'purpose',
              purpose: String(data.get('purpose') ?? '').trim(),
            };
    setBusy(true);
    setError(null);
    try {
      await mutate('plans', {
        title: String(data.get('title') ?? '').trim(),
        description: String(data.get('description') ?? '').trim(),
        source,
        clientRequestId: crypto.randomUUID(),
      });
      form.reset();
      await reload();
    } catch {
      setError('计划未能创建，请检查来源和标题后重试。');
    } finally {
      setBusy(false);
    }
  }
  async function createChapter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const asset = sources.find((item) => item.id === chapterAsset);
    if (!asset) return;
    const locator =
      rangeKind === 'whole'
        ? { kind: 'whole' }
        : {
            kind: rangeKind,
            start: Number(data.get('start')),
            end: Number(data.get('end')),
          };
    setBusy(true);
    setError(null);
    try {
      await mutate('chapters', {
        assetId: asset.id,
        assetVersionId: asset.versionId,
        title: String(data.get('chapterTitle') ?? '').trim(),
        locator,
        clientRequestId: crypto.randomUUID(),
      });
      form.reset();
      await reload();
    } catch {
      setError('资料分组未能保存，请检查范围后重试。');
    } finally {
      setBusy(false);
    }
  }
  async function updatePlan(plan: Plan, status: Plan['status']) {
    setBusy(true);
    setError(null);
    try {
      await mutate(`plans/${plan.id}`, { status }, 'PATCH');
      await reload();
    } catch {
      setError('计划状态未能保存，请重试。');
    } finally {
      setBusy(false);
    }
  }
  function sourceLabel(source: PlanSource) {
    if (source.kind === 'conversation')
      return (
        conversations.find((item) => item.id === source.conversationId)
          ?.title ?? '未命名对话'
      );
    if (source.kind === 'chapter')
      return (
        chapters.find((item) => item.id === source.chapterId)?.title ??
        '资料分组'
      );
    return source.purpose;
  }
  const groups = new Map<string, { source: PlanSource; items: Plan[] }>();
  for (const plan of plans) {
    const key = JSON.stringify(plan.source);
    const group = groups.get(key) ?? { source: plan.source, items: [] };
    group.items.push(plan);
    groups.set(key, group);
  }
  return (
    <main className="min-h-dvh bg-canvas text-ink">
      <div className="mx-auto grid max-w-7xl gap-6 p-4 lg:grid-cols-[18rem_1fr] lg:p-8">
        <aside className="rounded-2xl border border-line">
          <NotebookDirectory notebookId={notebookId} />
        </aside>
        <div className="min-w-0 space-y-6">
          <header>
            <Link
              href={`/notebook/${notebookId}`}
              className="inline-flex min-h-11 items-center text-sm text-accent underline"
            >
              返回笔记本
            </Link>
            <h1 className="text-2xl font-semibold">
              {notebookTitle} · 学习计划
            </h1>
          </header>
          <section
            aria-labelledby="notebook-goal"
            className="rounded-2xl border border-line bg-surface p-5"
          >
            <h2 id="notebook-goal" className="font-semibold">
              笔记本总学习目标
            </h2>
            {goal ? (
              <>
                <p className="mt-3 font-medium">{goal.topic}</p>
                <p className="mt-2 text-ink-muted">{goal.desiredOutcome}</p>
                <Link
                  className="mt-3 inline-flex min-h-11 items-center text-accent underline"
                  href={`/notebook/${notebookId}/learn`}
                >
                  继续课程学习
                </Link>
              </>
            ) : (
              <p className="mt-3 text-sm text-ink-muted">
                当前学习者尚无本笔记本可用的结构化总学习目标。下面可以先创建讨论、资料或明确学习目的的小计划。
              </p>
            )}
            {!goal && canWrite ? (
              <Link
                className="mt-3 inline-flex min-h-11 items-center text-accent underline"
                href={`/notebook/${notebookId}/learn`}
              >
                建立总学习目标
              </Link>
            ) : null}
            <p className="mt-3 text-xs text-ink-muted">
              计划条目完成状态用于组织学习；课程掌握度来自受信学习记录。
            </p>
          </section>
          {error ? (
            <div role="alert" className="rounded-xl border border-line p-4">
              <p>{error}</p>
              <button
                className={button}
                disabled={busy}
                onClick={() => {
                  setError(null);
                  void reload().catch(() =>
                    setError('重新加载失败，请稍后重试。'),
                  );
                }}
              >
                重新加载
              </button>
            </div>
          ) : null}
          {loading ? (
            <p role="status">正在读取学习计划…</p>
          ) : groups.size ? (
            [...groups.entries()].map(([key, group]) => (
              <section key={key} className="rounded-2xl border border-line p-5">
                <h2 className="font-semibold">
                  {group.source.kind === 'conversation'
                    ? '对话'
                    : group.source.kind === 'chapter'
                      ? '资料章节 / 分组'
                      : '学习目的'}{' '}
                  · {sourceLabel(group.source)}
                </h2>
                <ul className="mt-3 space-y-3">
                  {group.items.map((plan) => (
                    <li key={plan.id} className="rounded-xl bg-surface p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 className="font-medium">{plan.title}</h3>
                        <span className="text-xs text-ink-muted">
                          {plan.status === 'completed'
                            ? '已完成'
                            : plan.status === 'archived'
                              ? '已归档'
                              : '进行中'}
                        </span>
                      </div>
                      {plan.description ? (
                        <p className="mt-2 whitespace-pre-wrap text-sm text-ink-muted">
                          {plan.description}
                        </p>
                      ) : null}
                      {!plan.available ? (
                        <p className="mt-2 text-sm text-ink-muted">
                          来源已不可用，此计划仅保留历史记录。
                        </p>
                      ) : null}
                      {canWrite ? (
                        <div className="mt-3 flex gap-2">
                          {plan.available && plan.status !== 'archived' ? (
                            <button
                              className={button}
                              disabled={busy}
                              onClick={() =>
                                void updatePlan(
                                  plan,
                                  plan.status === 'completed'
                                    ? 'active'
                                    : 'completed',
                                )
                              }
                            >
                              {plan.status === 'completed'
                                ? '重新开始'
                                : '标记完成'}
                            </button>
                          ) : null}
                          {plan.status !== 'archived' ? (
                            <button
                              className={button}
                              disabled={busy}
                              onClick={() => void updatePlan(plan, 'archived')}
                            >
                              归档计划
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>
            ))
          ) : (
            <p className="rounded-2xl border border-dashed border-line p-6 text-ink-muted">
              还没有小计划。选择本笔记本的一条对话、资料分组或明确学习目的来创建。
            </p>
          )}
          {canWrite ? (
            <NotebookPlanCreationForms
              sourceKind={sourceKind}
              setSourceKind={setSourceKind}
              selectedSource={selectedSource}
              setSelectedSource={setSelectedSource}
              conversations={conversations}
              chapters={chapters}
              busy={busy}
              createPlan={createPlan}
              sources={sources}
              chapterAsset={chapterAsset}
              setChapterAsset={setChapterAsset}
              rangeKind={rangeKind}
              setRangeKind={setRangeKind}
              createChapter={createChapter}
            />
          ) : null}
        </div>
      </div>
    </main>
  );
}
