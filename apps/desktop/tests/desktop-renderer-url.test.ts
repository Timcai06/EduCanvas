import { describe, expect, it } from 'vitest';
import { isTrustedDesktopRendererUrl } from '../src/main/desktop-renderer-url';

describe('desktop renderer URL pinning', () => {
  it('allows the packaged app and its chat query only', () => {
    const appUrl = 'file:///D:/EduCanvas/out/renderer/index.html';
    expect(isTrustedDesktopRendererUrl(appUrl, appUrl)).toBe(true);
    expect(isTrustedDesktopRendererUrl(`${appUrl}?view=chat`, appUrl)).toBe(true);
  });

  it('rejects remote navigation and other local files', () => {
    const appUrl = 'file:///D:/EduCanvas/out/renderer/index.html';
    expect(isTrustedDesktopRendererUrl('https://example.com/', appUrl)).toBe(false);
    expect(isTrustedDesktopRendererUrl('file:///D:/EduCanvas/secrets.html', appUrl)).toBe(false);
  });

  it('trusts a loopback development entry only when development mode is explicit', () => {
    const developmentUrl = 'http://127.0.0.1:5173/';
    expect(isTrustedDesktopRendererUrl(developmentUrl, developmentUrl)).toBe(false);
    expect(
      isTrustedDesktopRendererUrl(developmentUrl, developmentUrl, true),
    ).toBe(true);
    expect(
      isTrustedDesktopRendererUrl('https://attacker.example/', 'https://attacker.example/', true),
    ).toBe(false);
  });
});
