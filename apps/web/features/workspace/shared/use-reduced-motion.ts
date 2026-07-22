'use client';

import { useSyncExternalStore } from 'react';

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

function subscribe(onChange: () => void) {
  const media = window.matchMedia(REDUCED_MOTION_QUERY);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}

function getSnapshot() {
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

// SSR 与水合首帧按「减少动态」处理，确认客户端偏好后才允许挂载 WebGL。
function getServerSnapshot() {
  return true;
}

/**
 * 是否处于「减少动态」偏好。用于在 React 层决定**是否挂载** WebGL 动效层
 * （PixelBlast / PulsingBorder），而不是仅靠 CSS 停帧——未挂载才真正不耗 GPU。
 * SSR/水合首帧按 true 返回，避免减少动态用户误挂载一帧 WebGL。
 */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
