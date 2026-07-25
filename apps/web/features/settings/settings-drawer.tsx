'use client';

import { ArrowRight } from '@phosphor-icons/react';
import { useRouter } from 'next/navigation';
import { ThemeToggle } from '@/features/theme/theme-toggle';
import { Sheet } from '@/features/workspace/shared/sheet';
import { ProfileSettings } from './profile-settings';

/**
 * 设置抽屉：从顶栏齿轮打开的「快速配置」，只放能用的账号与外观。通信方式（gateway
 * 渠道）尚未接入，暂不放进抽屉；完整配置（含通信方式占位）在 /settings 页面，由底部
 * 「全部设置 →」进入。抽屉=快速改，页面=全部项。
 *
 * 版式：各区块不再各自套厚卡片（抽屉纸页本身就是卡），改为发丝线分隔的扁平段落。
 */
export function SettingsDrawer({ onClose }: { onClose: () => void }) {
  const router = useRouter();

  return (
    <Sheet label="设置" eyebrow="Preferences" onClose={onClose}>
      <div className="flex flex-col gap-7">
        <div data-sheet-item>
          <ProfileSettings />
        </div>

        <section data-sheet-item className="border-t border-line/60 pt-7">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h3 className="font-display text-lg font-semibold">外观</h3>
              <p className="mt-1 max-w-xs text-sm leading-6 text-ink-muted">
                纸色亮如白日铺纸，砚墨暗如晚自习灯下。默认跟随系统。
              </p>
            </div>
            <ThemeToggle />
          </div>
        </section>

        <button
          data-sheet-item
          type="button"
          onClick={() => {
            router.push('/settings');
            onClose();
          }}
          className="group inline-flex min-h-11 items-center justify-between rounded-full border border-line px-5 text-sm font-medium text-ink transition-colors hover:border-accent/40 hover:bg-accent-soft"
        >
          <span>全部设置（含通信方式）</span>
          <ArrowRight
            aria-hidden="true"
            size={16}
            weight="bold"
            className="text-accent transition-transform group-hover:translate-x-0.5"
          />
        </button>
      </div>
    </Sheet>
  );
}
