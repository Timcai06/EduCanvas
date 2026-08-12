import { app, BrowserWindow, screen } from 'electron';
import { join } from 'node:path';
import {
  MVP_WINDOW_HEIGHT,
  MVP_WINDOW_WIDTH,
  petVisibleRect,
} from '../shared/pet-mvp-layout';
import {
  loadPetPositionFile,
  savePetPositionFile,
} from '../shared/pet-position-file';
import { recoverOffscreenRect } from '../shared/pet-clamp';
import { isQuitRequested } from './tray';
import { PET_WINDOW_APPEARANCE } from './pet-window-appearance';
import { showPetWindow } from './pet-window-visibility';
import { isTrustedDesktopRendererUrl } from './desktop-renderer-url';

export interface PetWindowController {
  win: BrowserWindow;
  savePosition(): void;
}

function currentDisplays() {
  return screen.getAllDisplays().map((display) => ({
    ...display.bounds,
    workArea: display.workArea,
  }));
}

export function createPetWindow(): PetWindowController {
  const positionFile = join(app.getPath('userData'), 'pet-window.json');
  const saved = loadPetPositionFile(positionFile);
  const workArea = screen.getPrimaryDisplay().workArea;
  const defaultPosition = {
    x: workArea.x + workArea.width - MVP_WINDOW_WIDTH - 24,
    y: workArea.y + workArea.height - MVP_WINDOW_HEIGHT - 24,
  };
  const restored = recoverOffscreenRect(
    {
      x: saved?.x ?? defaultPosition.x,
      y: saved?.y ?? defaultPosition.y,
      width: MVP_WINDOW_WIDTH,
      height: MVP_WINDOW_HEIGHT,
    },
    petVisibleRect(MVP_WINDOW_HEIGHT),
    currentDisplays(),
  );

  const win = new BrowserWindow({
    width: MVP_WINDOW_WIDTH,
    height: MVP_WINDOW_HEIGHT,
    x: Math.round(restored.x),
    y: Math.round(restored.y),
    useContentSize: true,
    ...PET_WINDOW_APPEARANCE,
    frame: false,
    hasShadow: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    webPreferences: {
      ...PET_WINDOW_APPEARANCE.webPreferences,
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
    },
  });

  function savePosition(): void {
    try {
      const bounds = win.getBounds();
      savePetPositionFile(positionFile, {
        x: bounds.x,
        y: bounds.y,
        width: MVP_WINDOW_WIDTH,
        height: MVP_WINDOW_HEIGHT,
      });
    } catch {
      // 位置记忆失败不应影响桌宠运行或退出。
    }
  }

  function recoverIfDisplayWasRemoved(): void {
    if (win.isDestroyed()) return;
    const current = win.getBounds();
    const recovered = recoverOffscreenRect(
      current,
      petVisibleRect(current.height),
      currentDisplays(),
    );
    if (recovered.x === current.x && recovered.y === current.y) return;
    win.setPosition(recovered.x, recovered.y, false);
    savePosition();
  }

  win.on('will-move', (event, proposedBounds) => {
    const constrained = recoverOffscreenRect(
      proposedBounds,
      petVisibleRect(proposedBounds.height),
      currentDisplays(),
    );
    if (
      constrained.x === proposedBounds.x &&
      constrained.y === proposedBounds.y
    ) {
      return;
    }
    event.preventDefault();
    win.setPosition(
      Math.round(constrained.x),
      Math.round(constrained.y),
      false,
    );
  });

  win.on('close', (event) => {
    if (!isQuitRequested()) {
      event.preventDefault();
      win.hide();
      return;
    }
    savePosition();
  });
  win.on('hide', savePosition);
  win.on('ready-to-show', () => showPetWindow(win));
  screen.on('display-removed', recoverIfDisplayWasRemoved);
  screen.on('display-metrics-changed', recoverIfDisplayWasRemoved);
  win.on('closed', () => {
    screen.removeListener('display-removed', recoverIfDisplayWasRemoved);
    screen.removeListener(
      'display-metrics-changed',
      recoverIfDisplayWasRemoved,
    );
  });

  const rendererUrl = app.isPackaged
    ? undefined
    : process.env['ELECTRON_RENDERER_URL'];
  const rendererEntryUrl = rendererUrl
    ? new URL(rendererUrl).toString()
    : new URL(`file:///${join(__dirname, '../renderer/index.html').replaceAll('\\', '/')}`).toString();
  win.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedDesktopRendererUrl(url, rendererEntryUrl, !app.isPackaged))
      event.preventDefault();
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  if (rendererUrl) void win.loadURL(rendererEntryUrl);
  else void win.loadFile(join(__dirname, '../renderer/index.html'));

  return { win, savePosition };
}
