import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { useRef, type RefObject } from 'react';

gsap.registerPlugin(useGSAP);

export function useConversationSidebarMotion(input: {
  open: boolean;
  width: number;
  sidebarRef: RefObject<HTMLElement | null>;
  panelRef: RefObject<HTMLDivElement | null>;
}) {
  const previousOpenRef = useRef(input.open);

  useGSAP(
    () => {
      const sidebar = input.sidebarRef.current;
      const panel = input.panelRef.current;
      if (!sidebar || !panel) return;
      const wasOpen = previousOpenRef.current;
      previousOpenRef.current = input.open;
      const media = gsap.matchMedia();
      media.add('(prefers-reduced-motion: reduce)', () => {
        gsap.set(sidebar, { xPercent: input.open ? 0 : -100 });
        gsap.set(panel, { autoAlpha: input.open ? 1 : 0, x: 0 });
      });
      media.add(
        '(min-width: 1024px) and (prefers-reduced-motion: no-preference)',
        () => {
          gsap.set(sidebar, { xPercent: 0 });
          gsap.killTweensOf([sidebar, panel]);
          if (wasOpen === input.open) {
            gsap.set(sidebar, {
              width: input.open ? input.width : 0,
              clearProps: 'willChange',
            });
            gsap.set(panel, {
              autoAlpha: input.open ? 1 : 0,
              x: input.open ? 0 : -18,
              clearProps: 'willChange',
            });
            return;
          }
          if (!input.open) {
            gsap.set(sidebar, { willChange: 'width' });
            gsap.set(panel, { willChange: 'transform,opacity' });
            gsap
              .timeline({
                defaults: { overwrite: 'auto' },
                onComplete: () =>
                  gsap.set([sidebar, panel], { clearProps: 'willChange' }),
              })
              .to(panel, {
                autoAlpha: 0,
                x: -14,
                duration: 0.16,
                ease: 'power2.in',
              })
              .fromTo(
                sidebar,
                { width: input.width },
                {
                  width: 0,
                  duration: 0.22,
                  ease: 'power2.inOut',
                  clearProps: 'willChange',
                },
                0,
              );
            return;
          }
          gsap
            .timeline({
              defaults: { overwrite: 'auto' },
              onComplete: () =>
                gsap.set([sidebar, panel], { clearProps: 'willChange' }),
            })
            .fromTo(
              sidebar,
              { width: 0, willChange: 'width' },
              { width: input.width, duration: 0.32, ease: 'power3.out' },
            )
            .fromTo(
              panel,
              { autoAlpha: 0, x: -18, willChange: 'transform,opacity' },
              { autoAlpha: 1, x: 0, duration: 0.26, ease: 'power3.out' },
              0.035,
            );
        },
      );
      media.add(
        '(max-width: 1023px) and (prefers-reduced-motion: no-preference)',
        () => {
          gsap.killTweensOf(sidebar);
          gsap.to(sidebar, {
            xPercent: input.open ? 0 : -100,
            duration: input.open ? 0.26 : 0.2,
            ease: input.open ? 'power3.out' : 'power2.in',
            willChange: 'transform',
            onComplete: () => gsap.set(sidebar, { clearProps: 'willChange' }),
          });
          gsap.set(panel, { autoAlpha: 1, x: 0 });
        },
      );
      return () => media.revert();
    },
    {
      dependencies: [input.open, input.width],
      scope: input.sidebarRef,
      revertOnUpdate: true,
    },
  );
}
