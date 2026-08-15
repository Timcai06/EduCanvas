import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import App from '../src/renderer/src/App';

describe('MVP pet controls', () => {
  it('starts with the greeting animation instead of a celebration', () => {
    const html = renderToStaticMarkup(createElement(App));

    expect(html).toContain('alt="EduCanvas 桌宠正在打招呼"');
    expect(html).not.toContain('alt="EduCanvas 桌宠正在庆祝"');
  });

  it('renders an explicit control for hiding the desktop pet', () => {
    const html = renderToStaticMarkup(createElement(App));

    expect(html).toContain('aria-label="隐藏桌宠"');
  });

  it('renders a keyboard-accessible control for folding the chat dialog', () => {
    const html = renderToStaticMarkup(createElement(App));

    expect(html).toContain('aria-label="折叠对话框"');
    expect(html).toContain('aria-expanded="true"');
  });

  it('exposes the enlarged chat window before authentication', () => {
    const html = renderToStaticMarkup(createElement(App));

    expect(html).toContain('aria-label="放大对话框"');
  });

  it('keeps transient pet behavior outside the conversation history log', () => {
    const source = readFileSync(
      new URL('../src/renderer/src/pet-chat-panel.tsx', import.meta.url),
      'utf8',
    );
    const historyView = source.slice(
      source.indexOf('className="pet-chat__history"'),
      source.indexOf('className="pet-chat__status"'),
    );
    const chatPanel = source.slice(
      source.indexOf('className="pet-chat__status"'),
    );

    expect(historyView).not.toContain('pet-chat__status');
    expect(historyView).not.toContain('{message}');
    expect(historyView).toContain('还没有对话。');
    expect(chatPanel).toContain('role="status"');
  });

  it('hides the dialog content and renders a restore control when folded', () => {
    const html = renderToStaticMarkup(
      createElement(App as ComponentType<{ initialChatCollapsed?: boolean }>, {
        initialChatCollapsed: true,
      }),
    );

    expect(html).not.toContain('aria-label="桌宠聊天"');
    expect(html).toContain('aria-label="展开对话框"');
    expect(html).toContain('aria-expanded="false"');
  });

  it('keeps an empty chat grid slot before the pet when the dialog is folded', () => {
    const html = renderToStaticMarkup(
      createElement(App as ComponentType<{ initialChatCollapsed?: boolean }>, {
        initialChatCollapsed: true,
      }),
    );

    const chatSlotIndex = html.indexOf('class="pet-chat-slot"');
    const petIndex = html.indexOf('class="pet-drag-region"');

    expect(chatSlotIndex).toBeGreaterThanOrEqual(0);
    expect(chatSlotIndex).toBeLessThan(petIndex);
  });
});
