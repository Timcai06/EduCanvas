export type PixelBlastPointerPosition = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type PixelBlastPointerHandlers = {
  onDown(position: PixelBlastPointerPosition): void;
  onMove(position: PixelBlastPointerPosition): void;
  onLeave(): void;
};

/**
 * 在 window 上旁听指针，不改变命中测试；只有位于 canvas 矩形内的事件才进入 shader。
 */
export function createPixelBlastPointerInput(
  canvas: HTMLCanvasElement,
  handlers: PixelBlastPointerHandlers,
) {
  const mapPointer = (event: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    if (
      rect.width <= 0 ||
      rect.height <= 0 ||
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    ) {
      return null;
    }
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (event.clientX - rect.left) * scaleX,
      y: (rect.height - (event.clientY - rect.top)) * scaleY,
      width: canvas.width,
      height: canvas.height,
    };
  };

  const onPointerDown = (event: PointerEvent) => {
    const position = mapPointer(event);
    if (position) handlers.onDown(position);
  };
  const onPointerMove = (event: PointerEvent) => {
    const position = mapPointer(event);
    if (position) handlers.onMove(position);
    else handlers.onLeave();
  };

  window.addEventListener('pointerdown', onPointerDown, { passive: true });
  window.addEventListener('pointermove', onPointerMove, { passive: true });
  window.addEventListener('blur', handlers.onLeave);

  let disposed = false;
  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('blur', handlers.onLeave);
    },
  };
}
