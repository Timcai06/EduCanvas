import {
  chatExpandRect,
  petChatRect,
  petVisibleRect,
} from '../shared/pet-mvp-layout';

interface Point {
  x: number;
  y: number;
}

interface WindowBounds extends Point {
  width: number;
  height: number;
}

const RESIZE_BORDER_SIZE = 6;

interface PetMouseTrackerOptions<THandle> {
  readCursor(): Point;
  readWindowBounds(): WindowBounds;
  isChatExpanded?(): boolean;
  setMousePassthrough(passthrough: boolean): void;
  schedule(callback: () => void): THandle;
  cancelSchedule(handle: THandle): void;
}

function isWithin(
  point: Point,
  rect: { x: number; y: number; width: number; height: number },
): boolean {
  return (
    point.x >= rect.x &&
    point.x < rect.x + rect.width &&
    point.y >= rect.y &&
    point.y < rect.y + rect.height
  );
}

function isWithinResizeBorder(point: Point, bounds: WindowBounds): boolean {
  return (
    point.x >= 0 &&
    point.y >= 0 &&
    point.x < bounds.width &&
    point.y < bounds.height &&
    (point.x < RESIZE_BORDER_SIZE ||
      point.y < RESIZE_BORDER_SIZE ||
      point.x >= bounds.width - RESIZE_BORDER_SIZE ||
      point.y >= bounds.height - RESIZE_BORDER_SIZE)
  );
}

export function isPetInteractiveScreenPoint(
  windowBounds: WindowBounds,
  cursor: Point,
  chatExpanded = true,
): boolean {
  const local = {
    x: cursor.x - windowBounds.x,
    y: cursor.y - windowBounds.y,
  };
  const chat = petChatRect(windowBounds.width, windowBounds.height);
  const pet = petVisibleRect(windowBounds.width, windowBounds.height);
  const chatExpand = chatExpandRect(windowBounds.width, windowBounds.height);
  return (
    isWithinResizeBorder(local, windowBounds) ||
    (chatExpanded && isWithin(local, chat)) ||
    (!chatExpanded && isWithin(local, chatExpand)) ||
    isWithin(local, pet)
  );
}

export function createPetMouseTracker<THandle>(
  options: PetMouseTrackerOptions<THandle>,
) {
  let handle: THandle | undefined;
  let currentPassthrough: boolean | undefined;

  const update = (): void => {
    const passthrough = !isPetInteractiveScreenPoint(
      options.readWindowBounds(),
      options.readCursor(),
      options.isChatExpanded?.() ?? true,
    );
    if (passthrough === currentPassthrough) return;
    currentPassthrough = passthrough;
    options.setMousePassthrough(passthrough);
  };

  const stop = (): void => {
    if (handle !== undefined) {
      options.cancelSchedule(handle);
      handle = undefined;
    }
    currentPassthrough = undefined;
  };

  return {
    start(): void {
      stop();
      update();
      handle = options.schedule(update);
    },
    stop,
  };
}
