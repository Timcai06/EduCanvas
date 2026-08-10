import 'server-only';

import { cookies } from 'next/headers';
import {
  experienceModeSchema,
  type ExperienceMode,
} from '@/features/experience-mode/experience-mode-contract';

export const EXPERIENCE_MODE_COOKIE =
  process.env.NODE_ENV === 'production'
    ? '__Host-educanvas_experience_mode'
    : 'educanvas_experience_mode';

const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 180;

/** 环境默认值只用于测试或受控演示；非法值保持未选择。 */
export function parseConfiguredExperienceMode(
  value: string | undefined,
): ExperienceMode | null {
  const parsed = experienceModeSchema.safeParse(value?.trim());
  return parsed.success ? parsed.data : null;
}

export async function readExperienceMode(): Promise<ExperienceMode | null> {
  const configured = parseConfiguredExperienceMode(
    process.env.EDUCANVAS_EXPERIENCE_MODE_DEFAULT,
  );
  if (configured) return configured;
  const value = (await cookies()).get(EXPERIENCE_MODE_COOKIE)?.value;
  const parsed = experienceModeSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** 仅由同源 Route Handler 调用；Cookie 是产品模式偏好，不是监护关系证明。 */
export async function writeExperienceMode(mode: ExperienceMode): Promise<void> {
  (await cookies()).set(EXPERIENCE_MODE_COOKIE, mode, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });
}
