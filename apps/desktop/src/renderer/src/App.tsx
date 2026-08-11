import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { parseManifest } from '../../shared/pet-manifest';
import type { PetManifest } from '../../shared/pet-manifest';
import type { PetState } from '../../shared/pet-state';
import { PetSprite } from './pet-sprite';
import { playSpeech } from './speech-player';
import { recordVoice } from './voice-recorder';
import { runVoiceSession } from './voice-session';
import type { VoiceSessionPhase, VoiceSessionSnapshot } from './voice-session';
import sheetUrl from '../../../assets/pet/sprite-sheet.png';
import manifestRaw from '../../../assets/pet/manifest.json';
import './styles.css';

interface DragState {
  sx: number;
  sy: number;
  ox: number;
  oy: number;
  dragging: boolean;
}

type UiPhase = 'idle' | VoiceSessionPhase;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const ACTIVE_PHASES = new Set<UiPhase>([
  'starting',
  'listening',
  'transcribing',
  'thinking',
  'speaking',
]);

function petStateFor(phase: UiPhase): PetState {
  if (phase === 'starting' || phase === 'listening') return 'listen';
  if (phase === 'transcribing' || phase === 'thinking') return 'think';
  if (phase === 'speaking') return 'speak';
  if (phase === 'success') return 'success';
  if (phase === 'error') return 'error';
  return 'idle';
}

function phaseCopy(phase: UiPhase): { eyebrow: string; title: string } {
  switch (phase) {
    case 'starting':
      return { eyebrow: '语音助手', title: '正在准备麦克风…' };
    case 'listening':
      return { eyebrow: '正在聆听', title: '请说，我在听' };
    case 'transcribing':
      return { eyebrow: '正在识别', title: '让我听清楚一点…' };
    case 'thinking':
      return { eyebrow: '正在思考', title: '正在处理你的请求…' };
    case 'speaking':
      return { eyebrow: '回复', title: '这是我的回答' };
    case 'success':
      return { eyebrow: '已完成', title: '处理好了' };
    case 'error':
      return { eyebrow: '没有完成', title: '再试一次吧' };
    default:
      return { eyebrow: 'EduCanvas', title: '点击开始说话' };
  }
}

export default function App() {
  const [snapshot, setSnapshot] = useState<VoiceSessionSnapshot>({
    phase: 'cancelled',
  });
  const phase: UiPhase =
    snapshot.phase === 'cancelled' ? 'idle' : snapshot.phase;
  const [reduced, setReduced] = useState(false);
  const [walking, setWalking] = useState(false);
  const [manifest, setManifest] = useState<PetManifest | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const sessionRef = useRef<AbortController | null>(null);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const walkingRef = useRef(false);
  const pet = window.desktopPet;
  const copy = useMemo(() => phaseCopy(phase), [phase]);
  const expanded = phase !== 'idle';
  const active = ACTIVE_PHASES.has(phase);

  useEffect(() => {
    walkingRef.current = walking;
  }, [walking]);

  useEffect(() => {
    try {
      setManifest(parseManifest(manifestRaw));
    } catch (error) {
      console.error('manifest 无效', error);
    }
  }, []);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = (): void => setReduced(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  // forward:true 让透明区域穿透后仍可收到 mousemove，从而在指针回到交互区时恢复命中。
  useEffect(() => {
    let passthrough = false;
    const updateHitTesting = (event: MouseEvent): void => {
      const target = document.elementFromPoint(event.clientX, event.clientY);
      const next = !target?.closest('.pet-button, .voice-card');
      if (next === passthrough) return;
      passthrough = next;
      pet?.setMousePassthrough(next);
    };
    window.addEventListener('mousemove', updateHitTesting);
    return () => {
      window.removeEventListener('mousemove', updateHitTesting);
      pet?.setMousePassthrough(false);
    };
  }, [pet]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !manifest) return;
    const sprite = new PetSprite(canvas, manifest, sheetUrl);
    const state = petStateFor(phase);
    const renderState = walking && state === 'idle' ? 'walk' : state;
    let raf = 0;
    const tick = (time: number): void => {
      sprite.draw(renderState, time);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [manifest, phase, walking]);

  const collapse = (): void => {
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    resetTimerRef.current = null;
    setSnapshot({ phase: 'cancelled' });
    void pet?.setExpanded(false);
  };

  const startSession = async (): Promise<void> => {
    sessionRef.current?.abort();
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    resetTimerRef.current = null;
    setWalking(false);
    const controller = new AbortController();
    sessionRef.current = controller;
    setSnapshot({ phase: 'starting' });
    try {
      await pet?.setExpanded(true);
    } catch {
      // 窗口 resize 失败不阻断语音能力，Renderer 仍可呈现当前内容区。
    }
    if (sessionRef.current !== controller) return;
    const result = await runVoiceSession(
      {
        record: (options) => recordVoice(options),
        transcribe: (input, requestId) =>
          window.desktopVoice.transcribe(input, requestId),
        turn: (text, requestId) =>
          window.desktopAssistant.turn(text, requestId),
        synthesize: (text, requestId) =>
          window.desktopVoice.synthesize(text, requestId),
        play: (bytes, signal) => playSpeech(bytes, { signal }),
        cancelRemote: (requestId) => {
          window.desktopVoice.cancel(requestId);
          window.desktopAssistant.cancel(requestId);
        },
        createRequestId: () => crypto.randomUUID(),
      },
      { signal: controller.signal, onChange: setSnapshot },
    );
    if (sessionRef.current !== controller) return;
    sessionRef.current = null;
    if (result.outcome === 'cancelled') {
      collapse();
    } else if (result.outcome === 'success') {
      resetTimerRef.current = setTimeout(collapse, 5000);
    }
  };

  const activatePet = (): void => {
    if (active) {
      sessionRef.current?.abort();
      return;
    }
    void startSession();
  };

  useEffect(
    () => () => {
      sessionRef.current?.abort();
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    },
    [],
  );

  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    dragRef.current = {
      sx: event.screenX,
      sy: event.screenY,
      ox: event.clientX,
      oy: event.clientY,
      dragging: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    const drag = dragRef.current;
    if (!drag) return;
    if (
      !drag.dragging &&
      Math.hypot(event.screenX - drag.sx, event.screenY - drag.sy) > 6
    ) {
      drag.dragging = true;
      setWalking(false);
    }
    if (drag.dragging && pet) {
      void pet.dragMove({
        screenX: event.screenX,
        screenY: event.screenY,
        offsetX: drag.ox,
        offsetY: drag.oy,
      });
    }
  };
  const onPointerUp = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    if (drag && !drag.dragging) activatePet();
  };

  useEffect(() => {
    if (reduced || phase !== 'idle' || walking || !pet) return;
    const delay = 15000 + Math.random() * 15000;
    const timer = setTimeout(async () => {
      walkingRef.current = true;
      setWalking(true);
      try {
        for (let index = 0; index < 3; index++) {
          if (!walkingRef.current) return;
          const direction = Math.random() > 0.5 ? 1 : -1;
          const before = (await pet.getBounds()).x;
          const after = (await pet.moveBy(direction * 20, 0)).x;
          if (after === before) return;
          await sleep(250);
        }
      } finally {
        setWalking(false);
      }
    }, delay);
    return () => clearTimeout(timer);
  }, [phase, reduced, walking, pet]);

  return (
    <main className={`pet-shell${expanded ? ' is-expanded' : ''}`}>
      {expanded ? (
        <section
          className={`voice-card phase-${phase}`}
          role={phase === 'error' ? 'alert' : 'status'}
          aria-live={phase === 'error' ? 'assertive' : 'polite'}
        >
          <div className="voice-card__header">
            <span className="voice-card__eyebrow">{copy.eyebrow}</span>
            {phase === 'listening' ? (
              <span className="level-bars" aria-hidden="true">
                {[0.25, 0.45, 0.7, 0.45, 0.25].map((weight, index) => (
                  <i
                    key={weight + index}
                    style={{
                      transform: `scaleY(${Math.max(
                        0.2,
                        Math.min(1, (snapshot.level ?? 0) * 6 * weight),
                      )})`,
                    }}
                  />
                ))}
              </span>
            ) : null}
          </div>
          <h1>{copy.title}</h1>
          {snapshot.transcript && !snapshot.reply ? (
            <p className="voice-card__transcript">“{snapshot.transcript}”</p>
          ) : null}
          {snapshot.reply ? (
            <p className="voice-card__reply">{snapshot.reply}</p>
          ) : null}
          {snapshot.error ? (
            <p className="voice-card__error">{snapshot.error}</p>
          ) : null}
          {snapshot.notice ? (
            <p className="voice-card__notice">{snapshot.notice}</p>
          ) : null}
          <div className="voice-card__actions">
            {phase === 'error' ? (
              <button
                type="button"
                className="action-primary"
                onClick={() => void startSession()}
              >
                重试
              </button>
            ) : null}
            <button
              type="button"
              className="action-quiet"
              onClick={() =>
                active ? sessionRef.current?.abort() : collapse()
              }
            >
              {active ? '停止' : '关闭'}
            </button>
          </div>
        </section>
      ) : null}

      <button
        type="button"
        className="pet-button"
        aria-label={active ? '停止语音助手' : '开始语音助手'}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          dragRef.current = null;
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            activatePet();
          }
        }}
      >
        <canvas ref={canvasRef} width={128} height={128} aria-hidden="true" />
      </button>
    </main>
  );
}
