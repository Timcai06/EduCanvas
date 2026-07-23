'use client';

import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'educanvas.sidebar';

/**
 * 笔记本抽屉的开合状态。桌面端默认展开并记住手动收起，窄屏一律从收起开始
 * （抽屉按需覆盖，切换会话重载后不残留遮罩）。SSR/首帧一律收起，挂载后再按
 * localStorage 与视口校正，避免水合错位。
 */
export function useSidebarState(): { open: boolean; toggle: () => void } {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const resolve = () => {
      const stored = localStorage.getItem(STORAGE_KEY);
      setOpen(window.innerWidth >= 1024 ? stored !== '0' : false);
    };
    resolve();
  }, []);

  const toggle = useCallback(() => {
    setOpen((value) => {
      const next = !value;
      localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
      return next;
    });
  }, []);

  return { open, toggle };
}
