'use client';

import { useEffect, useState } from 'react';

/**
 * 订阅浏览器在线/离线状态。SSR 与首帧一律假定在线，避免水合闪烁；
 * 挂载后立即以 `navigator.onLine` 校正，并监听 online/offline 事件。
 * navigator.onLine 只能证伪（false 一定离线），true 不保证可达——因此它只
 * 用于给失败归因和显示提示，不用于阻断发送（真正的可达性由请求结果裁决）。
 */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  return online;
}
