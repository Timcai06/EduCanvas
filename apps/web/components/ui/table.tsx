'use client';

import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from 'react';

/*
 * 数据表格（Table）：只做排版原语（容器/行/表头/单元格），样式全走 token，
 * 便于在「学习档案/成绩单」等数据密集场景建立一致的表格骨架。语义由语义化元素承担；
 * 视觉焦点、选中态等业务样式由调用方叠加。
 */
export function Table({
  className = '',
  ...props
}: HTMLAttributes<HTMLTableElement>) {
  return (
    <table
      className={`w-full caption-bottom text-sm text-ink ${className}`}
      {...props}
    />
  );
}

export function TableHeader({
  className = '',
  ...props
}: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={`border-b border-line ${className}`} {...props} />;
}

export function TableBody({
  className = '',
  ...props
}: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <tbody className={`[&>tr:last-child]:border-0 ${className}`} {...props} />
  );
}

export function TableFooter({
  className = '',
  ...props
}: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <tfoot
      className={`border-t border-line bg-surface/50 font-medium ${className}`}
      {...props}
    />
  );
}

export function TableRow({
  className = '',
  ...props
}: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={`border-b border-line/60 transition-colors hover:bg-surface/40 ${className}`}
      {...props}
    />
  );
}

export function TableHead({
  className = '',
  ...props
}: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={`h-11 px-4 text-left align-middle text-xs font-semibold uppercase tracking-wider text-ink-muted ${className}`}
      {...props}
    />
  );
}

export function TableCell({
  className = '',
  ...props
}: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={`px-4 py-3 align-middle ${className}`} {...props} />;
}
