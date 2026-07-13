/**
 * 进度栏把学习事件转换为可解释的知识节点反馈，掌握度来自结构化状态而非模型主观判断。
 * 数据口径与更新边界见 docs/04-data/data-design.md。
 */
export function ProgressPanel() {
  return (
    <div className="flex h-full flex-col">
      <h2 className="mb-4 text-lg font-semibold">学习进度</h2>
      <div className="flex-1 rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-400">
        知识地图与掌握度占位——T5 任务在这里接入 learning_events 和 mastery_states。
      </div>
    </div>
  );
}
