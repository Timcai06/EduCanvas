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

/** 把「跟随系统」解析成当下具体的 light/dark；显式偏好原样返回。 */
function resolveTheme(preference: ThemePreference): 'light' | 'dark' {
  if (preference === 'light' || preference === 'dark') return preference;
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

/**
 * 把偏好落到 <html>：data-theme 属性驱动 token 覆写，内联 style 同步写 color-scheme
 * （原生表单/滚动条随之）。跟随系统在 JS 里解析成具体值——CSS 不再有 prefers-color-scheme
 * 媒体查询兜底（globals.css 用属性覆写而非 light-dark()，后者动态切换时 Chromium 不重算）。
 * 与 app/layout.tsx 的水合前脚本、theme-sync.tsx 的常驻监听同源。
 */
/** 纸面/砚墨的画布背景色，用于同步 `<meta name="theme-color">`。 */
const CANVAS_LIGHT = '#f7f4ec';
const CANVAS_DARK = '#1a1712';

/**
 * 把 theme-color 同步到当前画布背景，让浏览器地址栏/主题条融入画面而不是露一条
 * 系统默认色。meta 不存在时（SSR 已由 layout 的 viewport 输出，这里兜底）就地创建。
 */
function syncThemeColor(color: string): void {
  let meta = document.querySelector<HTMLMetaElement>(
    'meta[name="theme-color"]',
  );
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.appendChild(meta);
  }
  meta.content = color;
}

export function applyThemePreference(preference: ThemePreference): void {
  const root = document.documentElement;
  const resolved = resolveTheme(preference);
  root.setAttribute('data-theme', resolved);
  root.style.colorScheme = resolved;
  syncThemeColor(resolved === 'dark' ? CANVAS_DARK : CANVAS_LIGHT);
}

export function readThemePreference(): ThemePreference {
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
    readThemePreference,
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
    applyThemePreference(next);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  return { preference, setPreference };
}
