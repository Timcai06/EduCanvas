'use client';
import type { FormEvent, Dispatch, SetStateAction } from 'react';
import type { NotebookChapterDTO } from './notebook-plan-contracts';
type SourceKind = 'conversation' | 'chapter' | 'purpose';
type RangeKind = 'whole' | 'pages' | 'text';
interface Props {
  sourceKind: SourceKind;
  setSourceKind: Dispatch<SetStateAction<SourceKind>>;
  selectedSource: string;
  setSelectedSource: Dispatch<SetStateAction<string>>;
  conversations: { id: string; title: string | null }[];
  chapters: NotebookChapterDTO[];
  busy: boolean;
  createPlan: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  sources: { id: string; versionId: string; title: string }[];
  chapterAsset: string;
  setChapterAsset: Dispatch<SetStateAction<string>>;
  rangeKind: RangeKind;
  setRangeKind: Dispatch<SetStateAction<RangeKind>>;
  createChapter: (event: FormEvent<HTMLFormElement>) => Promise<void>;
}
const field =
  'min-h-11 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent';
const button =
  'min-h-11 rounded-xl border border-line bg-surface px-4 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50';
export function NotebookPlanCreationForms({
  sourceKind,
  setSourceKind,
  selectedSource,
  setSelectedSource,
  conversations,
  chapters,
  busy,
  createPlan,
  sources,
  chapterAsset,
  setChapterAsset,
  rangeKind,
  setRangeKind,
  createChapter,
}: Props) {
  return (
    <>
      <section className="rounded-2xl border border-line p-5">
        <h2 className="font-semibold">创建小计划</h2>
        <form
          onSubmit={(event) => void createPlan(event)}
          className="mt-4 space-y-3"
        >
          <label className="block text-sm" htmlFor="plan-source-kind">
            计划来源
          </label>
          <select
            id="plan-source-kind"
            className={field}
            value={sourceKind}
            onChange={(event) => {
              setSourceKind(event.target.value as typeof sourceKind);
              setSelectedSource('');
            }}
          >
            <option value="conversation">对话</option>
            <option value="chapter">资料章节 / 分组</option>
            <option value="purpose">明确学习目的</option>
          </select>
          {sourceKind === 'purpose' ? (
            <>
              <label htmlFor="plan-purpose" className="block text-sm">
                学习目的
              </label>
              <input
                id="plan-purpose"
                name="purpose"
                required
                maxLength={500}
                className={field}
              />
            </>
          ) : (
            <>
              <label htmlFor="plan-source" className="block text-sm">
                {sourceKind === 'conversation' ? '选择对话' : '选择资料分组'}
              </label>
              <select
                id="plan-source"
                required
                value={selectedSource}
                className={field}
                onChange={(event) => setSelectedSource(event.target.value)}
              >
                <option value="">请选择</option>
                {(sourceKind === 'conversation'
                  ? conversations.map((item) => ({
                      id: item.id,
                      title: item.title ?? '未命名对话',
                    }))
                  : chapters.filter((item) => item.available)
                ).map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
              </select>
            </>
          )}
          <label className="block text-sm" htmlFor="plan-title">
            计划标题
          </label>
          <input
            id="plan-title"
            name="title"
            required
            maxLength={120}
            className={field}
          />
          <label className="block text-sm" htmlFor="plan-description">
            计划内容
          </label>
          <textarea
            id="plan-description"
            name="description"
            maxLength={4000}
            rows={3}
            className={field}
          />
          <button className={button} disabled={busy}>
            {busy ? '正在保存…' : '创建计划'}
          </button>
        </form>
      </section>
      <section className="rounded-2xl border border-line p-5">
        <h2 className="font-semibold">确认资料分组</h2>
        <p className="mt-2 text-sm text-ink-muted">
          使用整份资料，或按你确认的页码 /
          文本范围建立分组。章节名称和范围由你指定。
        </p>
        {sources.length ? (
          <form
            onSubmit={(event) => void createChapter(event)}
            className="mt-4 space-y-3"
          >
            <label htmlFor="chapter-asset" className="block text-sm">
              资料
            </label>
            <select
              id="chapter-asset"
              required
              value={chapterAsset}
              onChange={(event) => setChapterAsset(event.target.value)}
              className={field}
            >
              <option value="">请选择资料</option>
              {sources.map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.title}
                </option>
              ))}
            </select>
            <label htmlFor="chapter-title" className="block text-sm">
              分组名称
            </label>
            <input
              id="chapter-title"
              name="chapterTitle"
              required
              maxLength={120}
              className={field}
            />
            <label htmlFor="chapter-range" className="block text-sm">
              分组范围
            </label>
            <select
              id="chapter-range"
              className={field}
              value={rangeKind}
              onChange={(event) =>
                setRangeKind(event.target.value as typeof rangeKind)
              }
            >
              <option value="whole">整份资料</option>
              <option value="pages">明确页码范围</option>
              <option value="text">明确文本字符范围</option>
            </select>
            {rangeKind !== 'whole' ? (
              <div className="grid grid-cols-2 gap-3">
                <label className="text-sm" htmlFor="range-start">
                  起点
                  <input
                    id="range-start"
                    name="start"
                    type="number"
                    required
                    min={rangeKind === 'pages' ? 1 : 0}
                    className={field}
                  />
                </label>
                <label className="text-sm" htmlFor="range-end">
                  终点
                  <input
                    id="range-end"
                    name="end"
                    type="number"
                    required
                    min={1}
                    className={field}
                  />
                </label>
              </div>
            ) : null}
            <button className={button} disabled={busy}>
              保存资料分组
            </button>
          </form>
        ) : (
          <p className="mt-4 text-sm text-ink-muted">
            尚无可用资料。请在笔记本对话中上传资料，处理完成后再确认分组。
          </p>
        )}
      </section>
    </>
  );
}
