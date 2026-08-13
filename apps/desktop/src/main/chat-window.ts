import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';
import { EXPANDED_CHAT_WINDOW_OPTIONS } from '../shared/chat-window-layout';
import { isTrustedDesktopRendererUrl } from './desktop-renderer-url';

export function createExpandedChatWindow(): BrowserWindow {
  const win = new BrowserWindow({
    ...EXPANDED_CHAT_WINDOW_OPTIONS,
    title: 'EduCanvas 对话',
    backgroundColor: '#f6f4ee',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
    },
  });
  const rendererUrl = app.isPackaged
    ? undefined
    : process.env['ELECTRON_RENDERER_URL'];
  const rendererEntryUrl = rendererUrl
    ? new URL(rendererUrl).toString()
    : new URL(
        `file:///${join(__dirname, '../renderer/index.html').replaceAll('\\', '/')}`,
      ).toString();
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedDesktopRendererUrl(url, rendererEntryUrl, !app.isPackaged))
      event.preventDefault();
  });
  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) win.show();
  });

  if (rendererUrl) {
    const url = new URL(rendererEntryUrl);
    url.searchParams.set('view', 'chat');
    void win.loadURL(url.toString());
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), {
      query: { view: 'chat' },
    });
  }
  return win;
}
