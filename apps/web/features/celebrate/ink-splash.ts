/**
 * 泼墨庆祝的极简发布订阅（灵感来源：React Bits「SplashCursor」流体，但改造为一次性庆祝）。
 * 任何成功回调都可 `celebrate()` 触发一次「落笔泼墨」，由全局宿主 InkSplashHost 渲染后自拆——
 * 不做常驻鼠标拖尾，也不挂全局指针监听，避免原版的常驻 GPU 与监听泄漏。仅客户端调用。
 */
export interface SplashOrigin {
  x: number;
  y: number;
}

type Listener = (origin: SplashOrigin) => void;

const listeners = new Set<Listener>();

/** 宿主订阅；返回取消订阅函数。 */
export function subscribeInkSplash(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 触发一次泼墨。origin 缺省为视口中心（CSS 像素）。 */
export function celebrate(origin?: SplashOrigin): void {
  if (typeof window === 'undefined') return;
  const at = origin ?? {
    x: window.innerWidth / 2,
    y: window.innerHeight / 2,
  };
  listeners.forEach((listener) => listener(at));
}
