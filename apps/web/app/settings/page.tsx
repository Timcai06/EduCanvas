import { redirect } from 'next/navigation';

/**
 * 旧设置书签的兼容入口。设置能力已经并入头像抽屉，此路由不再维护第二套界面。
 */
export default function SettingsRedirectPage(): never {
  redirect('/?profile=1');
}
