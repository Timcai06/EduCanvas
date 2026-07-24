'use client';

import { createStudyPlanAction } from '@/app/learn/actions';
import type {
  CreateStudyPlanInputDTO,
  StudyActionResultDTO,
} from '@/features/learning/learning-contracts';
import { useGSAP } from '@gsap/react';
import { ArrowRight, CaretDown } from '@phosphor-icons/react';
import gsap from 'gsap';
import { useRef, useState, useTransition } from 'react';
import { TopBar } from '../workspace/learning/top-bar';

gsap.registerPlugin(useGSAP);

// 目标为空，让入口回到「先写一句想学什么」的对话式起点，而不是先面对一张表单。
const initialInput: CreateStudyPlanInputDTO = {
  ageBand: 'unknown',
  gradeBand: 'primary_school',
  declarationSource: 'self_declared',
  desiredOutcome: '',
  preferences: {
    explanationOrder: 'example_first',
    responseDepth: 'balanced',
    guidance: 'step_by_step',
    modality: 'mixed',
    feedbackStyle: 'balanced',
  },
};

type Option = { value: string; label: string };

// 选项集中定义，避免每个 <select> 各自散写 <option>；顺序即界面呈现顺序。
const AGE_BANDS: Option[] = [
  { value: 'under_13', label: '12 岁及以下' },
  { value: '13_to_15', label: '13–15 岁' },
  { value: '16_to_17', label: '16–17 岁' },
  { value: 'adult', label: '成年人' },
  { value: 'unknown', label: '暂不确定' },
];
const GRADE_BANDS: Option[] = [
  { value: 'primary_school', label: '小学' },
  { value: 'middle_school', label: '初中' },
  { value: 'high_school', label: '高中' },
];
const DECLARATION_SOURCES: Option[] = [
  { value: 'self_declared', label: '学习者本人' },
  { value: 'guardian_declared', label: '家长或监护人' },
];
const EXPLANATION_ORDERS: Option[] = [
  { value: 'example_first', label: '先看例子' },
  { value: 'concept_first', label: '先讲概念' },
];
const GUIDANCE_STYLES: Option[] = [
  { value: 'step_by_step', label: '分步引导' },
  { value: 'independent_first', label: '先独立尝试' },
];
const RESPONSE_DEPTHS: Option[] = [
  { value: 'concise', label: '简洁要点' },
  { value: 'balanced', label: '适中展开' },
  { value: 'detailed', label: '详细讲解' },
];
const MODALITIES: Option[] = [
  { value: 'mixed', label: '图文与练习结合' },
  { value: 'visual', label: '多用图示' },
  { value: 'text', label: '以文字为主' },
  { value: 'practice', label: '以练习为主' },
];
const FEEDBACK_STYLES: Option[] = [
  { value: 'gentle', label: '鼓励式反馈' },
  { value: 'balanced', label: '鼓励与纠正并重' },
  { value: 'direct', label: '直接指出问题' },
];

function optionLabel(options: Option[], value: string): string {
  return options.find((option) => option.value === value)?.label ?? value;
}

function SelectField({
  label,
  value,
  options,
  onChange,
  wide,
}: {
  label: string;
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  wide?: boolean;
}) {
  return (
    <label
      className={`grid gap-2 text-sm font-medium ${wide ? 'sm:col-span-2' : ''}`}
    >
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-11 rounded-xl border border-line bg-canvas px-3 outline-none focus:ring-2 focus:ring-accent"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * K12 学习入口只收集可验证声明；所有选项都可由学生或监护人重新修改。
 * 界面采用渐进披露：主项只有「想学会什么」，年龄与教学偏好收进可展开面板，
 * 但提交时仍是完整的 CreateStudyPlanInputDTO（默认值即最严格的未成年人策略），
 * 因此收起细节不改变服务端契约与安全语义。
 */
export function StudySetup() {
  const [input, setInput] = useState(initialInput);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const rootRef = useRef<HTMLElement>(null);

  const setField = <K extends keyof CreateStudyPlanInputDTO>(
    key: K,
    value: string,
  ) =>
    setInput((current) => ({
      ...current,
      [key]: value as CreateStudyPlanInputDTO[K],
    }));

  const setPref = <K extends keyof CreateStudyPlanInputDTO['preferences']>(
    key: K,
    value: string,
  ) =>
    setInput((current) => ({
      ...current,
      preferences: {
        ...current.preferences,
        [key]: value as CreateStudyPlanInputDTO['preferences'][K],
      },
    }));

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const result: StudyActionResultDTO = await createStudyPlanAction(input);
      setError(result.message);
    });
  };

  // 「展开书桌」入场：条目自下而上依次落定，像一张学习桌被铺开。
  // 只在允许动态时建 Timeline；reduced-motion 下不设初始态，条目直接静态呈现。
  useGSAP(
    () => {
      const media = gsap.matchMedia();
      media.add('(prefers-reduced-motion: no-preference)', () => {
        gsap.set('.unfold-item', { opacity: 0, y: 14 });
        gsap.to('.unfold-item', {
          opacity: 1,
          y: 0,
          duration: 0.5,
          ease: 'power2.out',
          stagger: 0.07,
        });
      });
      return () => media.revert();
    },
    { scope: rootRef },
  );

  const canSubmit = input.desiredOutcome.trim().length > 0 && !isPending;

  return (
    <main ref={rootRef} className="min-h-dvh bg-canvas text-ink">
      <TopBar courseTitle="" stageLabel={null} masteryPercent={null} quiet />
      <div className="mx-auto flex min-h-[calc(100dvh-4rem)] w-full max-w-2xl flex-col justify-center gap-8 px-5 py-10">
        <header className="unfold-item">
          <p className="mb-3 text-sm font-semibold tracking-wide text-accent-strong">
            建立你的学习 Notebook
          </p>
          <h1 className="font-display text-3xl leading-tight font-semibold tracking-[-0.03em] text-balance sm:text-4xl">
            今天想学会什么？
          </h1>
        </header>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <label className="unfold-item block">
            <span className="sr-only">这次想学会什么</span>
            <textarea
              autoFocus
              value={input.desiredOutcome}
              maxLength={500}
              rows={3}
              placeholder="例如：理解图像 AI 如何根据特征分类"
              onChange={(event) =>
                setField('desiredOutcome', event.target.value)
              }
              className="w-full resize-none rounded-2xl border border-line bg-card px-4 py-3.5 text-lg leading-7 shadow-sm outline-none placeholder:text-ink-faint focus:ring-2 focus:ring-accent"
            />
          </label>

          <details className="unfold-item group mt-3">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm text-ink-muted select-none marker:hidden hover:text-ink">
              <span className="min-w-0">
                <span className="block font-medium text-ink">
                  年龄与讲解方式
                </span>
                <span className="block truncate text-xs text-ink-faint">
                  {optionLabel(AGE_BANDS, input.ageBand)} ·{' '}
                  {optionLabel(GRADE_BANDS, input.gradeBand)} ·{' '}
                  {optionLabel(DECLARATION_SOURCES, input.declarationSource)}
                </span>
              </span>
              <CaretDown
                aria-hidden="true"
                size={15}
                className="shrink-0 transition-transform group-open:rotate-180"
              />
            </summary>
            <div className="mt-4 grid gap-5 rounded-2xl border border-line bg-surface/60 p-5 sm:grid-cols-2">
              <SelectField
                label="学习者年龄段"
                value={input.ageBand}
                options={AGE_BANDS}
                onChange={(value) => setField('ageBand', value)}
              />
              <SelectField
                label="当前学段"
                value={input.gradeBand}
                options={GRADE_BANDS}
                onChange={(value) => setField('gradeBand', value)}
              />
              <SelectField
                label="这份信息由谁填写"
                value={input.declarationSource}
                options={DECLARATION_SOURCES}
                onChange={(value) => setField('declarationSource', value)}
                wide
              />
              <SelectField
                label="讲解顺序"
                value={input.preferences.explanationOrder}
                options={EXPLANATION_ORDERS}
                onChange={(value) => setPref('explanationOrder', value)}
              />
              <SelectField
                label="练习引导"
                value={input.preferences.guidance}
                options={GUIDANCE_STYLES}
                onChange={(value) => setPref('guidance', value)}
              />
              <SelectField
                label="回答详略"
                value={input.preferences.responseDepth}
                options={RESPONSE_DEPTHS}
                onChange={(value) => setPref('responseDepth', value)}
              />
              <SelectField
                label="内容形式"
                value={input.preferences.modality}
                options={MODALITIES}
                onChange={(value) => setPref('modality', value)}
              />
              <SelectField
                label="反馈方式"
                value={input.preferences.feedbackStyle}
                options={FEEDBACK_STYLES}
                onChange={(value) => setPref('feedbackStyle', value)}
                wide
              />
              <p className="text-xs leading-5 text-ink-faint sm:col-span-2">
                未填写年龄时，默认采用最严格的未成年人设置；偏好只改变讲解方式，不会放宽权限。
              </p>
            </div>
          </details>

          {error ? (
            <p role="alert" className="mt-4 text-sm text-cinnabar">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={!canSubmit}
            className="unfold-item mt-6 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-accent px-5 text-sm font-semibold text-canvas transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isPending ? '正在建立 Notebook…' : '开始'}
            {!isPending ? <ArrowRight aria-hidden="true" size={18} /> : null}
          </button>
        </form>
      </div>
    </main>
  );
}
