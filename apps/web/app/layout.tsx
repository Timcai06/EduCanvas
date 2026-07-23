import type { Metadata } from 'next';
import '@fontsource-variable/inter';
/* 衬线显示字体只引入实际使用的字重；fontsource 按 unicode-range 分块，浏览器按需下载 */
import '@fontsource/noto-serif-sc/400.css';
import '@fontsource/noto-serif-sc/600.css';
import './globals.css';
import './effects.css';
import { ThemeSync } from '@/features/theme/theme-sync';

/** 统一站点标题和摘要，避免各页面自行维护时出现产品定位漂移。 */
export const metadata: Metadata = {
  title: 'EduCanvas — K12 AI 通识课教学助手',
  description: '多模态K12人工智能通识课教学助手',
};

/*
 * 主题偏好在水合前落到 <html>，避免首帧按系统主题渲染再跳变（FOUC）。
 * 「跟随系统」在此解析成具体 light/dark 写进 data-theme——globals.css 用属性覆写而非
 * light-dark()（后者动态切 color-scheme 时 Chromium 不重算），故 CSS 无媒体查询兜底，
 * 必须由 JS 解析。同时写内联 style.color-scheme 让原生表单/滚动条一致。挂载后的实时
 * 跟随由 theme-sync.tsx 接管。只读 localStorage；出错静默回落 light。键名与 use-theme.ts 一致。
 */
const THEME_INIT_SCRIPT = `(function(){try{var p=localStorage.getItem('educanvas.theme');var t=(p==='light'||p==='dark')?p:(matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light');var r=document.documentElement;r.setAttribute('data-theme',t);r.style.colorScheme=t}catch(e){}})()`;

/**
 * 提供全站唯一的 HTML 语义与视觉基线；`zh-CN` 也供读屏器和浏览器选择正确的中文规则。
 * 页面级布局应留在具体路由中，避免根布局承担教学业务，见 docs/05-engineering/frontend.md。
 */
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // suppressHydrationWarning：内联脚本会在水合前改写 data-theme，属于预期的服务端/客户端差异
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-screen bg-canvas text-ink antialiased">
        <ThemeSync />
        {children}
      </body>
    </html>
  );
}
