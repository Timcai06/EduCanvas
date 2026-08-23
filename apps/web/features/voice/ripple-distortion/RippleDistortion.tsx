import { useEffect, useRef } from 'react';
import { Program, Mesh, Geometry, Triangle, RenderTarget } from 'ogl';
import {
  LIFE_CONSTANT,
  MAX_WAVES,
  QUALITY_SCALE,
  START_SCALE,
  approachColor,
  clamp,
  compositeFragment,
  createRippleRenderer,
  getRippleLocalPoint,
  hexToRGB,
  loadRippleImage,
  screenVertex,
  waveFragment,
  waveVertex,
  type ColorTarget,
  type CompositeUniforms,
  type RippleDistortionProps,
  type RippleUniforms,
  type Wave,
  type WaveConfig,
  type WaveUniforms,
} from './ripple-distortion-runtime';
import './RippleDistortion.css';

const RippleDistortion = ({
  src = 'https://images.unsplash.com/photo-1782977389500-dd7adad33ebe?q=80&w=3416&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D',
  brushSize = 150,
  strength = 0.2,
  swirl = 1,
  rings = 4,
  spread = 5,
  fade = 3,
  spacing = 15,
  dispersion = 0,
  glint = 0,
  tint = '#a855f7',
  tintAmount = 0.1,
  grayscale = true,
  colorA = '#000000',
  colorB = '#ffffff',
  colorAmount = 0,
  saturation = 1,
  brightness = 1,
  colorTransition = 0.48,
  highlightColor = '#ffffff',
  trigger = 'hover',
  clickStrength = 2,
  quality = 'low',
  enabled = true,
  className = '',
  style,
}: RippleDistortionProps) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const configRef = useRef<WaveConfig>({
    brushSize,
    spread,
    fade,
    spacing,
    clickStrength,
    trigger,
    enabled,
  });
  const uniformsRef = useRef<RippleUniforms | null>(null);
  const colorTargetRef = useRef<ColorTarget>({
    colorA: hexToRGB(colorA),
    colorB: hexToRGB(colorB),
    amount: clamp(colorAmount, 0, 1),
    saturation: clamp(saturation, 0, 2.5),
    brightness: clamp(brightness, 0, 2),
    transition: Math.max(0, colorTransition),
  });

  useEffect(() => {
    configRef.current = {
      brushSize,
      spread,
      fade,
      spacing,
      clickStrength,
      trigger,
      enabled,
    };
  }, [brushSize, clickStrength, enabled, fade, spacing, spread, trigger]);

  useEffect(() => {
    colorTargetRef.current = {
      colorA: hexToRGB(colorA),
      colorB: hexToRGB(colorB),
      amount: clamp(colorAmount, 0, 1),
      saturation: clamp(saturation, 0, 2.5),
      brightness: clamp(brightness, 0, 2),
      transition: Math.max(0, colorTransition),
    };
  }, [brightness, colorA, colorAmount, colorB, colorTransition, saturation]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const reduceMotion =
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const { renderer, gl, canvas, imageTexture } = createRippleRenderer(mount);
    const disposeImage = loadRippleImage(src, imageTexture, (width, height) => {
      compositeUniforms.uTextureSize.value = [width, height];
    });

    const offsets = new Float32Array(MAX_WAVES * 2);
    const scales = new Float32Array(MAX_WAVES * 2);
    const opacities = new Float32Array(MAX_WAVES);

    const waves: Wave[] = Array.from({ length: MAX_WAVES }, () => ({
      x: 0,
      y: 0,
      scale: START_SCALE,
      target: START_SCALE,
      size: 1,
      opacity: 0,
    }));
    let current = 0;

    const geometry = new Geometry(gl, {
      position: {
        size: 2,
        data: new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      },
      uv: {
        size: 2,
        data: new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]),
      },
      iOffset: { instanced: 1, size: 2, data: offsets },
      iScale: { instanced: 1, size: 2, data: scales },
      iOpacity: { instanced: 1, size: 1, data: opacities },
    });

    const waveUniforms: WaveUniforms = { uRings: { value: rings } };
    const waveProgram = new Program(gl, {
      vertex: waveVertex,
      fragment: waveFragment,
      uniforms: waveUniforms,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      cullFace: false,
    });
    waveProgram.setBlendFunc(gl.ONE, gl.ONE);
    const waveMesh = new Mesh(gl, {
      geometry,
      program: waveProgram,
      frustumCulled: false,
    });

    const displacementTarget = new RenderTarget(gl, {
      width: 2,
      height: 2,
      depth: false,
      minFilter: gl.LINEAR,
      magFilter: gl.LINEAR,
      wrapS: gl.CLAMP_TO_EDGE,
      wrapT: gl.CLAMP_TO_EDGE,
    });

    const compositeUniforms: CompositeUniforms = {
      uTexture: { value: imageTexture },
      uDisplacement: { value: displacementTarget.texture },
      uResolution: { value: [1, 1] },
      uTextureSize: { value: [1, 1] },
      uTexel: { value: [1, 1] },
      uTint: { value: hexToRGB(tint) },
      uHighlight: { value: hexToRGB(highlightColor) },
      uColorA: { value: hexToRGB(colorA) },
      uColorB: { value: hexToRGB(colorB) },
      uStrength: { value: strength },
      uSwirl: { value: swirl },
      uDispersion: { value: dispersion },
      uGlint: { value: glint },
      uTintAmount: { value: tintAmount },
      uGrayscale: { value: grayscale ? 1 : 0 },
      uColorAmount: { value: clamp(colorAmount, 0, 1) },
      uSaturation: { value: clamp(saturation, 0, 2.5) },
      uBrightness: { value: clamp(brightness, 0, 2) },
    };

    const compositeMesh = new Mesh(gl, {
      geometry: new Triangle(gl),
      program: new Program(gl, {
        vertex: screenVertex,
        fragment: compositeFragment,
        uniforms: compositeUniforms,
        depthTest: false,
        depthWrite: false,
      }),
    });

    uniformsRef.current = { wave: waveUniforms, composite: compositeUniforms };

    let width = 1;
    let height = 1;

    const resize = () => {
      width = Math.max(1, mount.clientWidth);
      height = Math.max(1, mount.clientHeight);
      renderer.setSize(width, height);
      compositeUniforms.uResolution.value = [width, height];

      const scale = QUALITY_SCALE[quality] ?? 1;
      const fieldW = Math.max(2, Math.round(width * scale));
      const fieldH = Math.max(2, Math.round(height * scale));
      displacementTarget.setSize(fieldW, fieldH);
      compositeUniforms.uTexel.value = [1 / fieldW, 1 / fieldH];
    };

    const ro = new ResizeObserver(resize);
    ro.observe(mount);
    resize();

    const setNewWave = (x: number, y: number, power: number) => {
      const cfg = configRef.current;
      const wave = waves[current]!;
      current = (current + 1) % MAX_WAVES;
      wave.x = x;
      wave.y = y;
      wave.scale = START_SCALE * power;
      wave.target = START_SCALE * Math.max(1, cfg.spread) * power;
      wave.size = Math.max(1, cfg.brushSize);
      wave.opacity = 1;
    };

    let previousX = 0;
    let previousY = 0;

    const onMove = (event: PointerEvent) => {
      const cfg = configRef.current;
      if (!cfg.enabled || reduceMotion || cfg.trigger === 'click') return;
      const point = getRippleLocalPoint(mount, event.clientX, event.clientY);
      if (!point) return;
      const step = Math.max(1, cfg.spacing);
      if (
        Math.abs(point[0] - previousX) > step ||
        Math.abs(point[1] - previousY) > step
      ) {
        setNewWave(point[0], point[1], 1);
        previousX = point[0];
        previousY = point[1];
      }
    };

    const onDown = (event: PointerEvent) => {
      const cfg = configRef.current;
      if (!cfg.enabled || reduceMotion || cfg.trigger === 'hover') return;
      const point = getRippleLocalPoint(mount, event.clientX, event.clientY);
      if (!point) return;
      setNewWave(point[0], point[1], Math.max(1, cfg.clickStrength));
    };

    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerdown', onDown, { passive: true });

    let raf = 0;
    let previousTime = 0;

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const delta = previousTime
        ? Math.min(0.05, (now - previousTime) / 1000)
        : 0;
      previousTime = now;
      const cfg = configRef.current;
      const colorTarget = colorTargetRef.current;
      const colorBlend =
        reduceMotion || colorTarget.transition === 0
          ? 1
          : 1 - Math.exp(-delta / colorTarget.transition);

      approachColor(
        compositeUniforms.uColorA.value,
        colorTarget.colorA,
        colorBlend,
      );
      approachColor(
        compositeUniforms.uColorB.value,
        colorTarget.colorB,
        colorBlend,
      );
      compositeUniforms.uColorAmount.value +=
        (colorTarget.amount - compositeUniforms.uColorAmount.value) *
        colorBlend;
      compositeUniforms.uSaturation.value +=
        (colorTarget.saturation - compositeUniforms.uSaturation.value) *
        colorBlend;
      compositeUniforms.uBrightness.value +=
        (colorTarget.brightness - compositeUniforms.uBrightness.value) *
        colorBlend;

      const growth = reduceMotion ? 0 : 1 - Math.exp(-delta * 1.09);
      const decay = reduceMotion
        ? 1
        : Math.exp((-delta * LIFE_CONSTANT) / Math.max(0.15, cfg.fade));

      for (let i = 0; i < MAX_WAVES; i += 1) {
        const wave = waves[i]!;
        if (wave.opacity <= 0) {
          opacities[i] = 0;
          continue;
        }

        wave.opacity *= decay;
        wave.scale += (wave.target - wave.scale) * growth;

        if (wave.opacity < 0.002) {
          wave.opacity = 0;
          opacities[i] = 0;
          continue;
        }

        const half = (wave.scale * wave.size) / 2;
        offsets[i * 2] = (wave.x / width) * 2 - 1;
        offsets[i * 2 + 1] = (wave.y / height) * 2 - 1;
        scales[i * 2] = (half / width) * 2;
        scales[i * 2 + 1] = (half / height) * 2;
        opacities[i] = wave.opacity;
      }

      geometry.attributes.iOffset!.needsUpdate = true;
      geometry.attributes.iScale!.needsUpdate = true;
      geometry.attributes.iOpacity!.needsUpdate = true;

      renderer.render({
        scene: waveMesh,
        target: displacementTarget,
        clear: true,
      });
      renderer.render({ scene: compositeMesh });
    };
    raf = requestAnimationFrame(loop);

    return () => {
      disposeImage();
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onDown);
      uniformsRef.current = null;
      if (canvas.parentNode === mount) mount.removeChild(canvas);
      const ext = gl.getExtension('WEBGL_lose_context');
      if (ext) ext.loseContext();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, quality]);

  useEffect(() => {
    const u = uniformsRef.current;
    if (!u) return;
    u.wave.uRings.value = rings;
    u.composite.uStrength.value = strength;
    u.composite.uSwirl.value = swirl;
    u.composite.uDispersion.value = dispersion;
    u.composite.uGlint.value = glint;
    u.composite.uTintAmount.value = tintAmount;
    u.composite.uGrayscale.value = grayscale ? 1 : 0;
    u.composite.uHighlight.value = hexToRGB(highlightColor);
    u.composite.uTint.value = hexToRGB(tint);
  }, [
    rings,
    strength,
    swirl,
    dispersion,
    glint,
    tintAmount,
    grayscale,
    highlightColor,
    tint,
  ]);

  return (
    <div
      ref={mountRef}
      className={`ripple-distortion ${className}`.trim()}
      style={style}
    />
  );
};

export default RippleDistortion;
