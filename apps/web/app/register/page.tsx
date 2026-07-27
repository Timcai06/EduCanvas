import { redirect } from 'next/navigation';

/**
 * 注册已改为首页上的抽屉（见 features/auth/auth-drawer.tsx），不再是独立页面。
 * 保留此路由只为兼容旧书签/外链：重定向回首页并带意图，由 UserMenu 自动弹开注册抽屉。
 */
export default function RegisterPage() {
  redirect('/?auth=register');
}
