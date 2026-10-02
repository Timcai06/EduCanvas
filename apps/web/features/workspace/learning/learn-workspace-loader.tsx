'use client';

import dynamic from 'next/dynamic';
import type { LearnWorkspaceProps } from './learn-workspace';

const LazyLearnWorkspace = dynamic(() =>
  import('./learn-workspace').then((module) => module.LearnWorkspace),
);

export function LearnWorkspaceLoader(props: LearnWorkspaceProps) {
  return <LazyLearnWorkspace {...props} />;
}
