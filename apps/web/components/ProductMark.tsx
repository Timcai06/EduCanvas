'use client';

import Link from 'next/link';
import { CircularText } from './CircularText';

/** 全站统一产品标识；href 仅决定是否承担返回主对话的导航职责。 */
export function ProductMark({
  href,
  className = '',
}: {
  href?: string;
  className?: string;
}) {
  const mark = (
    <CircularText text="EDUCANVAS*" spinDuration={18} onHover="speedUp" />
  );
  if (!href) return mark;
  return (
    <Link
      href={href}
      aria-label="返回 EduCanvas 主对话"
      className={`inline-flex rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent${className ? ` ${className}` : ''}`}
    >
      {mark}
    </Link>
  );
}
