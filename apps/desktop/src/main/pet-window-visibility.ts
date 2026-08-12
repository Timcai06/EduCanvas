import type { BrowserWindow } from 'electron';

type PetWindowVisibility = Pick<
  BrowserWindow,
  'hide' | 'isDestroyed' | 'isVisible' | 'setOpacity' | 'showInactive'
>;

const WINDOWS_REVEAL_DELAY_MS = 220;

/** A tray-launched desktop pet should not briefly steal activation from the user's current app. */
export function showPetWindow(win: PetWindowVisibility): void {
  if (win.isDestroyed()) return;
  win.setOpacity(0);
  win.showInactive();
  setTimeout(() => {
    if (!win.isDestroyed() && win.isVisible()) win.setOpacity(1);
  }, WINDOWS_REVEAL_DELAY_MS);
}

export function togglePetWindow(win: PetWindowVisibility): void {
  if (win.isDestroyed()) return;
  if (win.isVisible()) win.hide();
  else showPetWindow(win);
}
