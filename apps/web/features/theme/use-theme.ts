'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * 主题偏好三态：跟随系统 / 手动纸色亮 / 手动砚墨暗。
 * 与 app/layout.tsx 的水合前脚本、globals.css 的 data-theme 选择器共同构成主题系统。
 */
export type ThemePreference = 'system' | 'light' | 'dark';

// 键名同时被 app/layout.tsx 的内联脚本引用，改名需两处同步。
const STORAGE_KEY = 'educanvas.theme';
// 同标签内切换用自定义事件通知订阅者；跨标签用原生 storage 事件同步。
const CHANGE_EVENT = 'educanvas:theme-change';

/**
 * 把偏好落到 <html data-theme>：亮/暗写显式属性，跟随系统移除属性，
 * 交给 globals.css 的 prefers-color-scheme 媒体查询决定。color-scheme 由 CSS 派生。
 */
function applyPreference(preference: ThemePreference): void {
  const root = document.documentElement;
  if (preference === 'light' || preference === 'dark') {
    root.setAttribute('data-theme', preference);
  } else {
    root.removeAttribute('data-theme');
  }
}

function readPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') {
      return stored;
    }
  } catch {
    // 隐私模式或禁用存储：回落到跟随系统
  }
  return 'system';
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}

/**
 * 读取并切换主题偏好。SSR/水合首帧一律返回 `system`，与服务端未设 data-theme 的渲染一致，
 * 避免水合错位（真实偏好在水合后由 useSyncExternalStore 补正）。持久化到 localStorage。
 */
export function useThemePreference(): {
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
} {
  const preference = useSyncExternalStore(
    subscribe,
    readPreference,
    () => 'system' as ThemePreference,
  );

  const setPreference = useCallback((next: ThemePreference) => {
    try {
      if (next === 'system') {
        localStorage.removeItem(STORAGE_KEY);
      } else {
        localStorage.setItem(STORAGE_KEY, next);
      }
    } catch {
      // 存储不可用时仍即时应用到当前会话，只是不持久
    }
    applyPreference(next);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  return { preference, setPreference };
}
