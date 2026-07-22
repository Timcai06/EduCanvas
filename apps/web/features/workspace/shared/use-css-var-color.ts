'use client';

import { useEffect, useState } from 'react';

/**
 * 读取 :root 上某个设计 token 的解析后颜色值（如 `--color-accent` → `#31606c`）。
 * WebGL shader 只吃具体色值、不认 CSS 变量，故必须在运行时取值；且随亮色/砚墨
 * 主题切换重取，否则深色下颜色不对。SSR 阶段返回 fallback，客户端挂载后校正。
 */
export function useCssVarColor(varName: string, fallback: string): string {
  const [color, setColor] = useState(fallback);

  useEffect(() => {
    const read = () => {
      const raw = getComputedStyle(document.documentElement)
        .getPropertyValue(varName)
        .trim();
      if (raw) setColor(raw);
    };
    read();
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', read);
    return () => media.removeEventListener('change', read);
  }, [varName]);

  return color;
}
