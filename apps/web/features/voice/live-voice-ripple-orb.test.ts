import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LiveVoiceOrb } from './live-voice-orb';
import {
  LIVE_VOICE_RIPPLE_PALETTES,
  resolveLiveVoiceRippleAppearance,
} from './live-voice-ripple-orb';

const panelCss = readFileSync(
  fileURLToPath(new URL('./live-voice-panel.css', import.meta.url)),
  'utf8',
);
const orbCss = readFileSync(
  fileURLToPath(new URL('./live-voice-orb.css', import.meta.url)),
  'utf8',
);

describe('Live Voice ripple appearance', () => {
  it('为每个语音相位提供不同的双端色场', () => {
    const pairs = Object.values(LIVE_VOICE_RIPPLE_PALETTES).map(
      ({ colorA, colorB }) => `${colorA}:${colorB}`,
    );

    expect(new Set(pairs).size).toBe(pairs.length);
    expect(LIVE_VOICE_RIPPLE_PALETTES.listening).toMatchObject({
      colorA: '#137fbe',
      colorB: '#6ef0d2',
    });
    expect(LIVE_VOICE_RIPPLE_PALETTES.speaking).toMatchObject({
      colorA: '#e85d68',
      colorB: '#ffc466',
    });
  });

  it('只让聆听和播报阶段随真实音频能量增强', () => {
    const listeningQuiet = resolveLiveVoiceRippleAppearance('listening', 0);
    const listeningLoud = resolveLiveVoiceRippleAppearance('listening', 1);
    const thinkingQuiet = resolveLiveVoiceRippleAppearance('thinking', 0);
    const thinkingLoud = resolveLiveVoiceRippleAppearance('thinking', 1);

    expect(listeningLoud.brightness).toBeGreaterThan(listeningQuiet.brightness);
    expect(listeningLoud.saturation).toBeGreaterThan(listeningQuiet.saturation);
    expect(listeningLoud.glint).toBeGreaterThan(listeningQuiet.glint);
    expect(thinkingLoud).toEqual(thinkingQuiet);
  });

  it('钳制异常音量，避免 shader 参数越界', () => {
    expect(resolveLiveVoiceRippleAppearance('speaking', 8)).toEqual(
      resolveLiveVoiceRippleAppearance('speaking', 1),
    );
    expect(resolveLiveVoiceRippleAppearance('speaking', -2)).toEqual(
      resolveLiveVoiceRippleAppearance('speaking', 0),
    );
  });

  it('SVG 辅助光与 WebGL 使用同一组相位色', () => {
    for (const { colorA, colorB } of Object.values(
      LIVE_VOICE_RIPPLE_PALETTES,
    )) {
      expect(panelCss).toContain(`--live-voice-accent: ${colorA}`);
      expect(panelCss).toContain(`--live-voice-orb-secondary: ${colorB}`);
    }
    expect(orbCss).toContain('var(--live-voice-orb-secondary)');
  });

  it('用户与 Agent 发声阶段都会启用球体外圈声波', () => {
    const listening = renderToStaticMarkup(
      createElement(LiveVoiceOrb, { phase: 'listening', audioLevel: 0.4 }),
    );
    const speaking = renderToStaticMarkup(
      createElement(LiveVoiceOrb, { phase: 'speaking', audioLevel: 0.8 }),
    );
    const thinking = renderToStaticMarkup(
      createElement(LiveVoiceOrb, { phase: 'thinking', audioLevel: 0.8 }),
    );

    expect(listening).toContain('data-voice-active="true"');
    expect(listening).toContain('data-voice-speaker="user"');
    expect(speaking).toContain('data-voice-active="true"');
    expect(speaking).toContain('data-voice-speaker="agent"');
    expect(thinking).toContain('data-voice-active="false"');
    expect(listening.match(/<span><\/span>/g)).toHaveLength(3);
    expect(orbCss).toContain('@keyframes live-voice-wave-out');
  });

  it('本轮上下文资料带保留横向滚动但不显示滚动条', () => {
    expect(panelCss).toMatch(
      /\.live-voice-context-rail\s*\{[^}]*overflow-x:\s*auto;[^}]*scrollbar-width:\s*none;/s,
    );
    expect(panelCss).toMatch(
      /\.live-voice-context-rail::\-webkit-scrollbar\s*\{[^}]*display:\s*none;/s,
    );
  });
});
