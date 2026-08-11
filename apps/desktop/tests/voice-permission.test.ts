import { describe, expect, it } from 'vitest';
import { isAllowedVoicePermission } from '../src/main/voice-permission';

const documentUrl =
  'file:///D:/Projects/EduCanvas/apps/desktop/out/renderer/index.html';

describe('桌宠麦克风权限策略', () => {
  it('只允许当前主 frame 请求纯音频 media 权限', () => {
    expect(
      isAllowedVoicePermission({
        permission: 'media',
        isMainFrame: true,
        mediaTypes: ['audio'],
        requestingUrl: documentUrl,
        documentUrl,
      }),
    ).toBe(true);
  });

  it.each([
    ['camera', ['video']],
    ['camera+microphone', ['audio', 'video']],
    ['subframe', ['audio']],
    ['another file', ['audio']],
    ['another permission', ['audio']],
  ])('拒绝 %s', (scenario, mediaTypes) => {
    expect(
      isAllowedVoicePermission({
        permission:
          scenario === 'another permission' ? 'notifications' : 'media',
        isMainFrame: scenario !== 'subframe',
        mediaTypes: mediaTypes as Array<'audio' | 'video'>,
        requestingUrl:
          scenario === 'another file'
            ? 'file:///D:/tmp/untrusted.html'
            : documentUrl,
        documentUrl,
      }),
    ).toBe(false);
  });

  it('开发服务器只允许当前页面 URL，不放宽到同源任意页面', () => {
    const devUrl = 'http://127.0.0.1:5173/index.html';
    expect(
      isAllowedVoicePermission({
        permission: 'media',
        isMainFrame: true,
        mediaTypes: ['audio'],
        requestingUrl: devUrl,
        documentUrl: devUrl,
      }),
    ).toBe(true);
    expect(
      isAllowedVoicePermission({
        permission: 'media',
        isMainFrame: true,
        mediaTypes: ['audio'],
        requestingUrl: 'http://127.0.0.1:5173/other.html',
        documentUrl: devUrl,
      }),
    ).toBe(false);
  });
});
