'use client';

import { motion } from 'motion/react';
import type { ReactNode } from 'react';
import { useReducedMotion } from '@/features/workspace/shared/use-reduced-motion';

/**
 * 页面进入过渡（B4 轻量版）：路由切换时页面内容做一次极轻的 opacity + y 入场。
 * 只动 transform/opacity，不影响布局；`prefers-reduced-motion` 下不加动画直接渲染。
 * template 会随路由切换重新挂载，用于承载「换页要有交代」的氛围，而非装饰。
 */
export default function Template({ children }: { children: ReactNode }) {
  const reducedMotion = useReducedMotion();
  if (reducedMotion) return <>{children}</>;
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.26, ease: 'easeOut' }}
    >
      {children}
    </motion.div>
  );
}
