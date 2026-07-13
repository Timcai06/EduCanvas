// T5 任务：知识地图、掌握度与下一步推荐在此实现

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
