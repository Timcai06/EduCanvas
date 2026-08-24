import type { Metadata, Viewport } from 'next';
import 'katex/dist/katex.min.css';

import '@fontsource-variable/inter';
/* 衬线字体只引入用到的字重（400/600）。
   fontsource 按 unicode-range 分块，浏览器按需下载。 */
import '@fontsource/noto-serif-sc/400.css';
import '@fontsource/noto-serif-sc/600.css';
import './globals.css';
import './interactive-controls.css';
import './conversation-content.css';
import './effects.css';
import { ThemeSync } from '@/features/theme/theme-sync';
import { InkSplashHost } from '@/features/celebrate/ink-splash-host';
import { AssistantPanel } from '@/features/assistant/assistant-panel';
import { ExperienceModeGate } from '@/features/experience-mode/experience-mode-gate';
import { readExperienceMode } from '@/server/experience-mode';

/** 统一站点标题和摘要，避免各页面自行维护时出现产品定位漂移。 */
export const metadata: Metadata = {
  title: 'EduCanvas — K12 AI 通识课教学助手',
  description: '多模态K12人工智能通识课教学助手',
  openGraph: {
    title: 'EduCanvas — K12 AI 通识课教学助手',
    description: '多模态K12人工智能通识课教学助手',
    type: 'website',
    locale: 'zh_CN',
  },
};

/**
 * 浏览器 chrome 与纸面背景对齐（design-8）：移动端地址栏、桌面主题条默认用纸色，
 * 水合后由 theme-sync → applyThemePreference 按当前主题实时覆写。首帧即可见，避免白条闪跳。
 */
export const viewport: Viewport = {
  themeColor: '#f7f4ec',
  colorScheme: 'light',
};

/*
 * 主题偏好在水合前落到 <html>，避免首帧按系统主题渲染再跳变（FOUC）。
 * 「跟随系统」在此解析成具体 light/dark 写进 data-theme——globals.css 用属性覆写而非
 * light-dark()（后者动态切 color-scheme 时 Chromium 不重算），故 CSS 无媒体查询兜底，
 * 必须由 JS 解析。同时写内联 style.color-scheme 让原生表单/滚动条一致，并同步 theme-color。
 * 挂载后的实时跟随由 theme-sync.tsx 接管。只读 localStorage；出错静默回落 light。
 * 键名与 use-theme.ts 一致。
 */
const THEME_INIT_SCRIPT = `(function(){try{var p=localStorage.getItem('educanvas.theme');var t=(p==='light'||p==='dark')?p:(matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light');var r=document.documentElement;r.setAttribute('data-theme',t);r.style.colorScheme=t;var m=document.querySelector('meta[name="theme-color"]')||document.createElement('meta');m.name='theme-color';if(!m.parentNode)document.head.appendChild(m);m.content=t==='dark'?'#1a1712':'#f7f4ec'}catch(e){}})()`;

/**
 * 提供全站唯一的 HTML 语义与视觉基线；`zh-CN` 也供读屏器和浏览器选择正确的中文规则。
 * 页面级布局应留在具体路由中，避免根布局承担教学业务，见 docs/05-engineering/03-前端工程.md。
 */
export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const experienceMode = await readExperienceMode();
  return (
    // suppressHydrationWarning：内联脚本会在水合前改写 data-theme，属于预期的服务端/客户端差异
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        {/* 「两支笔」favicon：纸面亮/砚墨暗两档，避免与 OS 页签底色冲突（design-9） */}
        <link
          rel="icon"
          href="/favicon-light.svg"
          sizes="any"
          media="(prefers-color-scheme: light)"
        />
        <link
          rel="icon"
          href="/favicon-dark.svg"
          sizes="any"
          media="(prefers-color-scheme: dark)"
        />
      </head>
      <body className="min-h-screen bg-canvas text-ink antialiased">
        <ThemeSync />
        <ExperienceModeGate initialMode={experienceMode}>
          {children}
          <InkSplashHost />
          <AssistantPanel />
        </ExperienceModeGate>
      </body>
    </html>
  );
}
