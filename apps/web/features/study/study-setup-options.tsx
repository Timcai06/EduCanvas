// 目标为空，让入口回到「先写一句想学什么」的对话式起点，而不是先面对一张表单。
export type Option = { value: string; label: string };

// 选项集中定义，避免每个 <select> 各自散写 <option>；顺序即界面呈现顺序。
export const AGE_BANDS: Option[] = [
  { value: 'under_13', label: '12 岁及以下' },
  { value: '13_to_15', label: '13–15 岁' },
  { value: '16_to_17', label: '16–17 岁' },
  { value: 'adult', label: '成年人' },
  { value: 'unknown', label: '暂不确定' },
];
export const GRADE_BANDS: Option[] = [
  { value: 'primary_low', label: '小学低年级' },
  { value: 'primary_high', label: '小学高年级' },
  { value: 'middle_school', label: '初中' },
  { value: 'high_school', label: '高中' },
];
// 稳定的标签数组，供滚轮消费（避免每次渲染新建数组而重装动画）。
export const GRADE_LABELS = GRADE_BANDS.map((option) => option.label);
export const DECLARATION_SOURCES: Option[] = [
  { value: 'self_declared', label: '学习者本人' },
  { value: 'guardian_declared', label: '家长或监护人' },
];
export const EXPLANATION_ORDERS: Option[] = [
  { value: 'example_first', label: '先看例子' },
  { value: 'concept_first', label: '先讲概念' },
];
export const GUIDANCE_STYLES: Option[] = [
  { value: 'step_by_step', label: '分步引导' },
  { value: 'independent_first', label: '先独立尝试' },
];
export const RESPONSE_DEPTHS: Option[] = [
  { value: 'concise', label: '简洁要点' },
  { value: 'balanced', label: '适中展开' },
  { value: 'detailed', label: '详细讲解' },
];
export const MODALITIES: Option[] = [
  { value: 'mixed', label: '图文与练习结合' },
  { value: 'visual', label: '多用图示' },
  { value: 'text', label: '以文字为主' },
  { value: 'practice', label: '以练习为主' },
];
export const FEEDBACK_STYLES: Option[] = [
  { value: 'gentle', label: '鼓励式反馈' },
  { value: 'balanced', label: '鼓励与纠正并重' },
  { value: 'direct', label: '直接指出问题' },
];

export function optionLabel(options: Option[], value: string): string {
  return options.find((option) => option.value === value)?.label ?? value;
}

export function SelectField({
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
