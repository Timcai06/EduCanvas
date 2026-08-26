/**
 * 键盘按键提示芯片（Synapse 的 Kbd 模式）：键盘优先界面里让鼠标用户
 * 也能发现快捷键。纯展示组件，不注册任何键盘行为。
 */
export function KbdChip({ children }: { children: string }) {
  return (
    <kbd className="inline-flex min-w-5 items-center justify-center rounded border border-line bg-surface px-1.5 py-0.5 font-sans text-[0.6875rem] leading-4 font-medium text-ink-muted">
      {children}
    </kbd>
  );
}
