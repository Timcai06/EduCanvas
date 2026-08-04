import type {
  ButtonHTMLAttributes,
  ForwardedRef,
  HTMLAttributes,
  PropsWithChildren,
} from 'react';
import { forwardRef } from 'react';

const BASE_SURFACE =
  'rounded-2xl border border-line/70 bg-surface/50 px-8 py-6';

export const CanvasSurface = forwardRef(function CanvasSurface(
  {
    children,
    className = '',
    ...props
  }: PropsWithChildren<HTMLAttributes<HTMLDivElement>>,
  ref: ForwardedRef<HTMLDivElement>,
) {
  return (
    <div ref={ref} className={`${BASE_SURFACE} ${className}`} {...props}>
      {children}
    </div>
  );
});

export function CanvasActionSurface({
  children,
  className = '',
  type = 'button',
  ...props
}: PropsWithChildren<ButtonHTMLAttributes<HTMLButtonElement>>) {
  return (
    <button
      type={type}
      className={`${BASE_SURFACE} transition-colors hover:border-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
