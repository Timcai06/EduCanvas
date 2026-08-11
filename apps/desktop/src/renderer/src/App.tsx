import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { parseManifest } from '../../shared/pet-manifest';
import type { PetManifest } from '../../shared/pet-manifest';
import { transition } from '../../shared/pet-state';
import type { PetEvent, PetState } from '../../shared/pet-state';
import { PetSprite } from './pet-sprite';
import { runDemo } from './pet-demo';
import sheetUrl from '../../../assets/pet/sprite-sheet.png';
import manifestRaw from '../../../assets/pet/manifest.json';

interface DragState {
  sx: number;
  sy: number;
  ox: number;
  oy: number;
  dragging: boolean;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export default function App() {
  const [state, setState] = useState<PetState>('idle');
  const [reduced, setReduced] = useState(false);
  const [walking, setWalking] = useState(false);
  const [manifest, setManifest] = useState<PetManifest | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const demoCancelRef = useRef<() => void>(() => {});
  const walkingRef = useRef(false);
  const stateRef = useRef<PetState>('idle');
  const pet = window.desktopPet;

  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  useEffect(() => {
    walkingRef.current = walking;
  }, [walking]);

  // 加载角色包：vite 资源导入（PNG 为 URL、manifest 为对象）。
  // 不用 fetch——index.html 的 CSP connect-src 'none' 会拦截运行时请求。
  useEffect(() => {
    try {
      setManifest(parseManifest(manifestRaw));
    } catch (e) {
      console.error('manifest 无效', e);
    }
  }, []);

  // 系统「减少动态效果」：matchMedia 原生读取 OS 设置
  // （electron 43 已移除 nativeTheme.shouldUseReducedMotion，故不走 IPC）。
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = (): void => setReduced(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  // 动画循环：walking && idle 时渲染 walk 帧序列，否则渲染业务状态帧
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !manifest) return;
    const sprite = new PetSprite(canvas, manifest, sheetUrl);
    const renderState = walking && state === 'idle' ? 'walk' : state;
    let raf = 0;
    const tick = (t: number): void => {
      sprite.draw(renderState, t);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [manifest, state, walking]);

  const emit = (event: PetEvent): void => setState((s) => transition(s, event));

  const startDemo = (): void => {
    demoCancelRef.current();
    demoCancelRef.current = runDemo(emit, () => stateRef.current);
  };

  // 点击：idle 启动演示序列；交互中点击 = cancel（spec §5）
  const handleClick = (): void => {
    setWalking(false);
    if (state === 'idle') {
      emit('pet_click');
      startDemo();
    } else {
      demoCancelRef.current();
      emit('cancel');
    }
  };

  // 拖动：>6px 判定拖动；拖动期间窗口跟随指针（位置计算在 main 侧钳制）
  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    // offsetX/Y 相对捕获目标（canvas），抓取偏移不变；React 合成类型不含，读 native
    const native = e.nativeEvent;
    dragRef.current = {
      sx: e.screenX,
      sy: e.screenY,
      ox: native.offsetX,
      oy: native.offsetY,
      dragging: false,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    const d = dragRef.current;
    if (!d) return;
    if (!d.dragging && Math.hypot(e.screenX - d.sx, e.screenY - d.sy) > 6) {
      d.dragging = true;
      setWalking(false); // 用户抓起来时打断踱步
    }
    if (d.dragging && pet) {
      void pet.dragMove({
        screenX: e.screenX,
        screenY: e.screenY,
        offsetX: d.ox,
        offsetY: d.oy,
      });
    }
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    const d = dragRef.current;
    dragRef.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
    if (d && !d.dragging) handleClick();
  };

  // idle 踱步：walk 是渲染层动画变体，不进入业务状态机（spec §5 冻结 6 状态）。
  // walking 只改变 idle 下渲染的帧序列；每轮 ≤3 步 × 20px（≤60px），碰边界停住
  // （≥15s 后再调度，满足边界停顿 ≥2s）；reduced motion 时不调度（spec §6）。
  useEffect(() => {
    if (reduced || state !== 'idle' || walking || !pet) return;
    const delay = 15000 + Math.random() * 15000;
    const timer = setTimeout(async () => {
      walkingRef.current = true;
      setWalking(true);
      try {
        for (let i = 0; i < 3; i++) {
          if (!walkingRef.current) return; // 被拖动/点击打断
          const dir = Math.random() > 0.5 ? 1 : -1;
          const before = (await pet.getBounds()).x;
          const after = (await pet.moveBy(dir * 20, 0)).x;
          if (after === before) return; // 碰边界停住，等下次调度
          await sleep(250);
        }
      } finally {
        setWalking(false);
      }
    }, delay);
    return () => clearTimeout(timer);
  }, [state, reduced, walking, pet]);

  return (
    <canvas
      ref={canvasRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    />
  );
}
