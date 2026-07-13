/**
 * 对话栏负责教师引导与教学状态推进，不负责直接拼装 Canvas 可执行内容。
 * 流式响应和智能体边界见 doc/03-ai/agent-orchestration.md。
 */
export function ChatPanel() {
  return (
    <div className="flex h-full flex-col">
      <h2 className="mb-4 text-lg font-semibold">AI 教师</h2>
      <div className="flex-1 rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-400">
        对话区占位——T3 任务在这里接入流式对话与教学状态机。
      </div>
    </div>
  );
}
