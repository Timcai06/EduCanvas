const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/** 返回模态表面内当前真正可聚焦的元素。 */
export function getFocusableElements(container: HTMLElement): HTMLElement[] {
  const visibleCandidates = Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter((element) => {
    const style = window.getComputedStyle(element);
    return (
      !element.hidden &&
      element.tabIndex >= 0 &&
      !element.closest('[inert]') &&
      element.getAttribute('aria-hidden') !== 'true' &&
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      element.getClientRects().length > 0
    );
  });

  /*
   * 浏览器把同名 radio group 当成一个 Tab stop：有选中项时只停在选中项，
   * 否则停在组内第一项。焦点循环必须复用同一规则，否则计算出的“最后一项”
   * 会落在浏览器永远不会 Tab 到的 radio 上，导致焦点从模态框逃逸。
   */
  const radioStops = new Map<string, HTMLInputElement>();
  for (const element of visibleCandidates) {
    if (!(element instanceof HTMLInputElement) || element.type !== 'radio') {
      continue;
    }
    const key = element.name;
    if (!key) continue;
    const current = radioStops.get(key);
    if (!current || element.checked) radioStops.set(key, element);
  }

  return visibleCandidates.filter((element) => {
    if (!(element instanceof HTMLInputElement) || element.type !== 'radio') {
      return true;
    }
    if (!element.name) return true;
    return radioStops.get(element.name) === element;
  });
}

/**
 * 从模态节点逐层向学习工作区回溯，将每一层的兄弟分支设为 inert。
 * 这样既能隔离顶栏，也能隔离与 Canvas 同级的 Chat，而不会把包含模态框
 * 自身的祖先一起禁用。清理函数精确恢复调用前状态，支持嵌套表面。
 */
export function makeWorkspaceBackgroundInert(
  modalRoot: HTMLElement,
): () => void {
  const workspace = modalRoot.closest<HTMLElement>('[data-learning-workspace]');
  if (!workspace) return () => undefined;

  const targets = new Set<HTMLElement>();
  let branch: HTMLElement = modalRoot;
  let parent = branch.parentElement;

  while (parent) {
    for (const sibling of Array.from(parent.children)) {
      if (sibling !== branch && sibling instanceof HTMLElement) {
        targets.add(sibling);
      }
    }
    if (parent === workspace) break;
    branch = parent;
    parent = parent.parentElement;
  }

  const previous = Array.from(targets).map((element) => ({
    element,
    inert: element.inert,
    ariaHidden: element.getAttribute('aria-hidden'),
  }));

  for (const { element } of previous) {
    element.inert = true;
    element.setAttribute('aria-hidden', 'true');
  }

  return () => {
    for (const { element, inert, ariaHidden } of previous) {
      element.inert = inert;
      if (ariaHidden === null) element.removeAttribute('aria-hidden');
      else element.setAttribute('aria-hidden', ariaHidden);
    }
  };
}
