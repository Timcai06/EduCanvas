import { app, BrowserWindow, screen } from 'electron';
import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import {
  clampRect,
  initialPetRect,
  PET_SIZE,
  type DisplayInfo,
  type Rect,
} from '../shared/pet-clamp';
import { dragTarget, type DragPoint } from '../shared/pet-drag';
import { savePetPositionFile } from '../shared/pet-position-file';
import {
  collapsedAnchorRect,
  resizePetWindowRect,
} from '../shared/pet-window-layout';
import { isQuitRequested } from './tray';

/** 桌宠窗口动作对象：index.ts 注册 IPC 时直接调用，不在 win 上 hack 挂字段。 */
export interface PetWindowController {
  win: BrowserWindow;
  dragMove(p: DragPoint): void;
  moveBy(dx: number, dy: number): Rect;
  getBounds(): Rect;
  setExpanded(expanded: boolean): Rect;
  setMousePassthrough(passthrough: boolean): void;
}

function displays(): DisplayInfo[] {
  return screen.getAllDisplays().map((d) => ({
    x: d.bounds.x,
    y: d.bounds.y,
    width: d.bounds.width,
    height: d.bounds.height,
    workArea: {
      x: d.workArea.x,
      y: d.workArea.y,
      width: d.workArea.width,
      height: d.workArea.height,
    },
  }));
}

export function createPetWindow(): PetWindowController {
  // 位置记忆：上次隐藏时的窗口位置（userData/pet-window.json）
  const posFile = join(app.getPath('userData'), 'pet-window.json');
  const saved = ((): Rect | null => {
    try {
      if (existsSync(posFile)) {
        const r = JSON.parse(readFileSync(posFile, 'utf8')) as Record<
          string,
          unknown
        >;
        if (typeof r.x === 'number' && typeof r.y === 'number') {
          return { x: r.x, y: r.y, width: PET_SIZE, height: PET_SIZE };
        }
      }
    } catch {
      /* 损坏的存档文件忽略，用默认位置 */
    }
    return null;
  })();

  const win = new BrowserWindow({
    width: PET_SIZE,
    height: PET_SIZE,
    // 有存档才给 x/y：显式 undefined 会被 Electron 43 判为参数转换失败
    ...(saved ? { x: saved.x, y: saved.y } : {}),
    transparent: true,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
    },
  });

  // 位置记忆：隐藏与真正退出都落盘（拖走后直接退出也不丢最后位置）
  function savePosition(): void {
    try {
      savePetPositionFile(posFile, collapsedAnchorRect(win.getBounds()));
    } catch {
      /* 保存失败不影响运行/退出 */
    }
  }

  // 关闭 = 隐藏到托盘；仅托盘「退出」（isQuitRequested 置位）时放行关闭，退出前落盘
  win.on('close', (event) => {
    if (!isQuitRequested()) {
      event.preventDefault();
      win.hide();
    } else {
      savePosition();
    }
  });

  win.on('ready-to-show', () => win.show());

  const rendererUrl = process.env['ELECTRON_RENDERER_URL'];
  if (rendererUrl) {
    void win.loadURL(rendererUrl);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }

  if (!saved) {
    const r = initialPetRect(displays());
    setPositionPx(r.x, r.y);
  }
  clampNow();

  // 显示器增删/尺寸变化时钳回可见区域，防止桌宠滞留屏幕外
  screen.on('display-added', clampNow);
  screen.on('display-removed', clampNow);
  screen.on('display-metrics-changed', clampNow);

  win.on('hide', savePosition);

  // Electron 43 的 setPosition 拒绝小数像素，统一取整
  function setPositionPx(x: number, y: number): void {
    win.setPosition(Math.round(x), Math.round(y));
  }

  function clampNow(): void {
    const b = win.getBounds();
    const r = clampRect(b, displays());
    if (r.x !== b.x || r.y !== b.y) setPositionPx(r.x, r.y);
  }

  return {
    win,
    dragMove(p: DragPoint): void {
      const t = dragTarget(p);
      const b = win.getBounds();
      const r = clampRect(
        { ...t, width: b.width, height: b.height },
        displays(),
      );
      setPositionPx(r.x, r.y);
    },
    moveBy(dx: number, dy: number): Rect {
      const b = win.getBounds();
      const r = clampRect(
        { x: b.x + dx, y: b.y + dy, width: b.width, height: b.height },
        displays(),
      );
      setPositionPx(r.x, r.y);
      return r;
    },
    getBounds: () => win.getBounds(),
    setExpanded(expanded: boolean): Rect {
      const current = win.getBounds();
      const target = clampRect(
        resizePetWindowRect(current, expanded),
        displays(),
      );
      win.setBounds({
        x: Math.round(target.x),
        y: Math.round(target.y),
        width: target.width,
        height: target.height,
      });
      return target;
    },
    setMousePassthrough(passthrough: boolean): void {
      win.setIgnoreMouseEvents(passthrough, { forward: true });
    },
  };
}
