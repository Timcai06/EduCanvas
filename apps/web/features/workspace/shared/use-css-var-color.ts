'use client';

import { useEffect, useState } from 'react';

/**
 * 读取 :root 上某个设计 token 的解析后颜色值（如 `--hero-ink-dot` → `#0e343d`）。
 * WebGL shader 只吃具体色值、不认 CSS 变量，故必须在运行时取值；且随亮色/砚墨
 * 主题切换重取，否则深色下颜色不对。SSR 阶段返回 fallback，客户端挂载后校正。
 *
 * 主题变化有两条来源，都要监听：系统偏好（`prefers-color-scheme` 媒体查询）与
 * 手动切换（`<html data-theme>` 属性，见主题切换控件）。只听媒体查询会导致手动
 * 切主题时 shader 颜色不更新。
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
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    return () => {
      media.removeEventListener('change', read);
      observer.disconnect();
    };
  }, [varName]);

  return color;
}
