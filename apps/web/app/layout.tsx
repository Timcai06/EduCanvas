import type { Metadata } from 'next';
import '@fontsource-variable/inter';
/* 衬线显示字体只引入实际使用的字重；fontsource 按 unicode-range 分块，浏览器按需下载 */
import '@fontsource/noto-serif-sc/400.css';
import '@fontsource/noto-serif-sc/600.css';
import './globals.css';

/** 统一站点标题和摘要，避免各页面自行维护时出现产品定位漂移。 */
export const metadata: Metadata = {
  title: 'EduCanvas — K12 AI 通识课教学助手',
  description: '多模态K12人工智能通识课教学助手',
};

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
    <html lang="zh-CN">
      <body className="min-h-screen bg-canvas text-ink antialiased">
        {children}
      </body>
    </html>
  );
}
