import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'EduCanvas — K12 AI 通识课教学助手',
  description: '多模态K12人工智能通识课教学助手',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">
        {children}
      </body>
    </html>
  );
}
