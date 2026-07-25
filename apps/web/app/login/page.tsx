import { redirect } from 'next/navigation';

/**
 * 登录已改为首页上的抽屉（见 features/auth/auth-drawer.tsx），不再是独立页面。
 * 保留此路由只为兼容旧书签/外链：重定向回首页并带意图，由 UserMenu 自动弹开登录抽屉。
 */
export default function LoginPage() {
  redirect('/?auth=login');
}
