/**
 * 桌宠拖动目标位置计算（spec §3.2 拖动）。
 * 拖动时窗口应跟随指针但位置不跳变：目标窗口位置 = 指针屏幕坐标 - 抓取偏移。
 * 纯函数，便于单测；main 进程拖动 IPC 复用。
 */

export interface DragPoint {
  /** 指针屏幕坐标（screenX/screenY，pointer event） */
  screenX: number;
  screenY: number;
  /** 抓取偏移：指针在窗口内的位置（按下点 - 窗口位置） */
  offsetX: number;
  offsetY: number;
}

/** 拖动目标窗口位置（左上角屏幕坐标）。 */
export function dragTarget(input: DragPoint): { x: number; y: number } {
  return { x: input.screenX - input.offsetX, y: input.screenY - input.offsetY };
}
