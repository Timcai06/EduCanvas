'use client';

import { useEffect } from 'react';
import { applyThemePreference, readThemePreference } from './use-theme';

/**
 * 全站常驻（挂在 RootLayout）：让「跟随系统」偏好在任意页面都能随 OS 明暗实时切换，
 * 无需刷新。手动亮/暗偏好不受 OS 影响，故只在偏好为 system 时才跟随媒体查询重解析。
 * 水合前的首帧由 app/layout.tsx 的内联脚本负责；本组件只接管挂载后的实时跟随。
 * 不渲染任何 DOM。
 */
export function ThemeSync() {
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const sync = () => {
      if (readThemePreference() === 'system') applyThemePreference('system');
    };
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  return null;
}
