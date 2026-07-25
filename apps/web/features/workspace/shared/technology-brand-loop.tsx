'use client';

import type { ReactNode } from 'react';
import {
  SiDocker,
  SiDrizzle,
  SiGreensock,
  SiNextdotjs,
  SiPnpm,
  SiPostgresql,
  SiReact,
  SiThreedotjs,
  SiTurborepo,
  SiTypescript,
} from 'react-icons/si';
import { LogoLoop, type LogoItem } from '@/components/LogoLoop';

const TECHNOLOGIES: readonly LogoItem[] = [
  technology(<SiNextdotjs />, 'Next.js', 'https://nextjs.org'),
  technology(<SiReact />, 'React', 'https://react.dev'),
  technology(<SiTypescript />, 'TypeScript', 'https://typescriptlang.org'),
  technology(<SiPostgresql />, 'PostgreSQL', 'https://postgresql.org'),
  technology(<SiDrizzle />, 'Drizzle', 'https://orm.drizzle.team'),
  technology(<SiGreensock />, 'GSAP', 'https://gsap.com'),
  technology(<SiThreedotjs />, 'Three.js', 'https://threejs.org'),
  technology(<SiTurborepo />, 'Turborepo', 'https://turborepo.com'),
  technology(<SiPnpm />, 'pnpm', 'https://pnpm.io'),
  technology(<SiDocker />, 'Docker', 'https://docker.com'),
];

/** 空白工作区的真实技术品牌带，不将开源技术伪装成商业合作伙伴。 */
export function TechnologyBrandLoop() {
  return (
    <div className="absolute inset-x-0 bottom-5 z-10">
      <p className="mb-3 text-center text-[10px] font-semibold uppercase tracking-[0.2em] text-ink-faint">
        Built on an open learning stack
      </p>
      <LogoLoop
        logos={TECHNOLOGIES}
        speed={34}
        logoHeight={20}
        gap={42}
        hoverSpeed={7}
        fadeOut
        scaleOnHover
        ariaLabel="EduCanvas 技术栈"
      />
    </div>
  );
}

function technology(icon: ReactNode, title: string, href: string): LogoItem {
  return {
    title,
    href,
    node: (
      <span className="inline-flex items-center gap-2 font-mono text-[11px] font-medium tracking-wide">
        {icon}
        {title}
      </span>
    ),
  };
}
