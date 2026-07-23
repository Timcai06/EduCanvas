import {
  EffectComposer,
  EffectPass,
  RenderPass,
  type Effect,
} from 'postprocessing';
import {
  GLSL3,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Uniform,
  WebGLRenderer,
} from 'three';
import {
  createPixelBlastLiquidEffect,
  createPixelBlastNoiseEffect,
  PIXEL_BLAST_FRAGMENT_SHADER,
  PIXEL_BLAST_MAX_CLICKS,
  PIXEL_BLAST_SHAPE_MAP,
  PIXEL_BLAST_VERTEX_SHADER,
} from './pixel-blast-shaders';
import {
  createPixelBlastUniforms,
  randomPixelBlastTimeOffset,
  setPixelBlastEffectTime,
  type PixelBlastUniforms,
} from './pixel-blast-runtime-support';
import {
  createPixelBlastPointerInput,
  type PixelBlastPointerPosition,
} from './pixel-blast-pointer-input';
import { createPixelBlastTouchTexture } from './pixel-blast-touch-texture';
import type { PixelBlastRuntimeConfig } from './pixel-blast-types';

/**
 * PixelBlast 的浏览器资源边界。实例拥有且只拥有一个 WebGL context，dispose 可重复调用。
 */
export class PixelBlastRuntime {
  private config: PixelBlastRuntimeConfig;
  private renderer: WebGLRenderer | null = null;
  private material: ShaderMaterial | null = null;
  private geometry: PlaneGeometry | null = null;
  private composer: EffectComposer | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private intersectionObserver: IntersectionObserver | null = null;
  private touch: ReturnType<typeof createPixelBlastTouchTexture> | null = null;
  private effects: Effect[] = [];
  private liquidEffect: Effect | null = null;
  private pointerInput: ReturnType<typeof createPixelBlastPointerInput> | null =
    null;
  private raf: number | null = null;
  private elapsedSeconds = 0;
  private lastFrame: number | null = null;
  private clickIndex = 0;
  private visible = true;
  private contextAvailable = true;
  private disposed = false;
  private usesWindowResize = false;
  private readonly timeOffset = randomPixelBlastTimeOffset();
  private uniforms: PixelBlastUniforms | null = null;

  constructor(
    private readonly container: HTMLDivElement,
    config: PixelBlastRuntimeConfig,
  ) {
    this.config = config;
    try {
      this.initialize();
    } catch (error) {
      this.dispose();
      throw error;
    }
  }

  private initialize() {
    const canvas = document.createElement('canvas');
    const renderer = new WebGLRenderer({
      canvas,
      antialias: this.config.antialias,
      alpha: true,
      powerPreference: 'high-performance',
    });
    this.renderer = renderer;
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.container.appendChild(canvas);
    this.setClearColor();

    const uniforms = createPixelBlastUniforms(this.config, renderer);
    this.uniforms = uniforms;

    const scene = new Scene();
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const material = new ShaderMaterial({
      vertexShader: PIXEL_BLAST_VERTEX_SHADER,
      fragmentShader: PIXEL_BLAST_FRAGMENT_SHADER,
      uniforms,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      glslVersion: GLSL3,
    });
    const geometry = new PlaneGeometry(2, 2);
    scene.add(new Mesh(geometry, material));
    this.material = material;
    this.geometry = geometry;

    this.setupPostprocessing(scene, camera);
    this.resize();
    this.setupObservers();
    this.setupEvents();
    this.syncAnimation();
  }

  private setupPostprocessing(scene: Scene, camera: OrthographicCamera) {
    const renderer = this.renderer;
    if (!renderer) return;
    let composer: EffectComposer | null = null;

    if (this.config.liquid) {
      this.touch = createPixelBlastTouchTexture();
      this.touch.radiusScale = this.config.liquidRadius;
      composer = new EffectComposer(renderer);
      this.composer = composer;
      composer.addPass(new RenderPass(scene, camera));
      const liquidEffect = createPixelBlastLiquidEffect(
        this.touch.texture,
        this.config.liquidStrength,
        this.config.liquidWobbleSpeed,
      );
      this.liquidEffect = liquidEffect;
      this.effects.push(liquidEffect);
      const liquidPass = new EffectPass(camera, liquidEffect);
      liquidPass.renderToScreen = true;
      composer.addPass(liquidPass);
    }

    if (this.config.noiseAmount > 0) {
      if (!composer) {
        composer = new EffectComposer(renderer);
        this.composer = composer;
        composer.addPass(new RenderPass(scene, camera));
      }
      for (const pass of composer.passes) pass.renderToScreen = false;
      const noiseEffect = createPixelBlastNoiseEffect(this.config.noiseAmount);
      this.effects.push(noiseEffect);
      const noisePass = new EffectPass(camera, noiseEffect);
      noisePass.renderToScreen = true;
      composer.addPass(noisePass);
    }

    this.composer = composer;
    this.scene = scene;
    this.camera = camera;
  }

  private scene: Scene | null = null;
  private camera: OrthographicCamera | null = null;
  private setupObservers() {
    if (typeof ResizeObserver === 'undefined') {
      this.usesWindowResize = true;
      window.addEventListener('resize', this.resize);
    } else {
      this.resizeObserver = new ResizeObserver(this.resize);
      this.resizeObserver.observe(this.container);
    }

    if (
      this.config.autoPauseOffscreen &&
      typeof IntersectionObserver !== 'undefined'
    ) {
      this.intersectionObserver = new IntersectionObserver((entries) => {
        const entry = entries.find(
          (candidate) => candidate.target === this.container,
        );
        if (!entry) return;
        this.visible = entry.isIntersecting;
        if (!this.visible) this.touch?.resetPointer();
        this.syncAnimation();
      });
      this.intersectionObserver.observe(this.container);
    }
  }

  private setupEvents() {
    const canvas = this.renderer?.domElement;
    if (!canvas) return;
    this.pointerInput = createPixelBlastPointerInput(canvas, {
      onDown: this.onPointerDown,
      onMove: this.onPointerMove,
      onLeave: this.resetPointer,
    });
    document.addEventListener('visibilitychange', this.syncAnimation);
    canvas.addEventListener('webglcontextlost', this.onContextLost);
    canvas.addEventListener('webglcontextrestored', this.onContextRestored);
  }

  private readonly onPointerDown = (position: PixelBlastPointerPosition) => {
    const uniforms = this.uniforms;
    if (!uniforms) return;
    uniforms.uClickPos.value[this.clickIndex]?.set(position.x, position.y);
    uniforms.uClickTimes.value[this.clickIndex] = uniforms.uTime.value;
    this.clickIndex = (this.clickIndex + 1) % PIXEL_BLAST_MAX_CLICKS;
  };

  private readonly onPointerMove = (position: PixelBlastPointerPosition) => {
    this.touch?.addTouch({
      x: position.x / position.width,
      y: position.y / position.height,
    });
  };

  private readonly resetPointer = () => this.touch?.resetPointer();

  private readonly onContextLost = (event: Event) => {
    event.preventDefault();
    this.contextAvailable = false;
    this.syncAnimation();
  };

  private readonly onContextRestored = () => {
    this.contextAvailable = true;
    this.resize();
    this.syncAnimation();
  };

  private readonly resize = () => {
    const renderer = this.renderer;
    const uniforms = this.uniforms;
    if (!renderer || !uniforms || this.disposed) return;
    const width = this.container.clientWidth || 1;
    const height = this.container.clientHeight || 1;
    renderer.setSize(width, height, false);
    uniforms.uResolution.value.set(
      renderer.domElement.width,
      renderer.domElement.height,
    );
    this.composer?.setSize(width, height, false);
    uniforms.uPixelSize.value =
      this.config.pixelSize * renderer.getPixelRatio();
    // resize 会重建并清空绘制缓冲，立即以新尺寸补渲一帧，消除侧栏展开连续 resize 的透明帧闪烁
    this.renderOnce();
  };

  private shouldAnimate() {
    return (
      !this.disposed &&
      this.contextAvailable &&
      this.visible &&
      !document.hidden
    );
  }

  private readonly syncAnimation = () => {
    if (!this.shouldAnimate()) {
      if (this.raf !== null) cancelAnimationFrame(this.raf);
      this.raf = null;
      this.lastFrame = null;
      return;
    }
    if (this.raf === null) this.raf = requestAnimationFrame(this.renderFrame);
  };

  private readonly renderFrame = (timestamp: number) => {
    this.raf = null;
    if (!this.shouldAnimate()) return;
    if (this.lastFrame !== null) {
      this.elapsedSeconds +=
        ((timestamp - this.lastFrame) / 1000) * this.config.speed;
    }
    this.lastFrame = timestamp;
    const time = this.timeOffset + this.elapsedSeconds;
    if (this.uniforms) this.uniforms.uTime.value = time;
    for (const effect of this.effects) setPixelBlastEffectTime(effect, time);
    this.touch?.update();
    this.renderOnce();
    this.raf = requestAnimationFrame(this.renderFrame);
  };

  private renderOnce() {
    if (this.composer) this.composer.render();
    else if (this.renderer && this.scene && this.camera)
      this.renderer.render(this.scene, this.camera);
  }

  update(config: PixelBlastRuntimeConfig) {
    this.config = config;
    const uniforms = this.uniforms;
    const renderer = this.renderer;
    if (!uniforms || !renderer || this.disposed) return;
    uniforms.uShapeType.value = PIXEL_BLAST_SHAPE_MAP[config.variant];
    uniforms.uColor.value.set(config.color);
    uniforms.uScale.value = config.patternScale;
    uniforms.uDensity.value = config.patternDensity;
    uniforms.uPixelJitter.value = config.pixelSizeJitter;
    uniforms.uEnableRipples.value = config.enableRipples ? 1 : 0;
    uniforms.uRippleIntensity.value = config.rippleIntensityScale;
    uniforms.uRippleThickness.value = config.rippleThickness;
    uniforms.uRippleSpeed.value = config.rippleSpeed;
    uniforms.uEdgeFade.value = config.edgeFade;
    if (this.touch) this.touch.radiusScale = config.liquidRadius;
    const liquidEffect = this.liquidEffect as
      (Effect & { uniforms: Map<string, Uniform> }) | null;
    const strength = liquidEffect?.uniforms.get('uStrength');
    const frequency = liquidEffect?.uniforms.get('uFreq');
    if (strength) strength.value = config.liquidStrength;
    if (frequency) frequency.value = config.liquidWobbleSpeed;
    this.setClearColor();
    this.resize();
  }

  private setClearColor() {
    if (!this.renderer) return;
    if (this.config.transparent) this.renderer.setClearAlpha(0);
    else this.renderer.setClearColor(0x000000, 1);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.raf !== null) cancelAnimationFrame(this.raf);
    this.raf = null;
    this.resizeObserver?.disconnect();
    this.intersectionObserver?.disconnect();
    if (this.usesWindowResize)
      window.removeEventListener('resize', this.resize);
    this.pointerInput?.dispose();
    document.removeEventListener('visibilitychange', this.syncAnimation);
    const canvas = this.renderer?.domElement;
    canvas?.removeEventListener('webglcontextlost', this.onContextLost);
    canvas?.removeEventListener('webglcontextrestored', this.onContextRestored);
    this.composer?.dispose();
    this.touch?.dispose();
    this.geometry?.dispose();
    this.material?.dispose();
    this.renderer?.dispose();
    this.renderer?.forceContextLoss();
    canvas?.remove();
    this.effects = [];
    this.liquidEffect = null;
    this.pointerInput = null;
    this.composer = null;
    this.touch = null;
    this.geometry = null;
    this.material = null;
    this.renderer = null;
    this.uniforms = null;
    this.scene = null;
    this.camera = null;
  }
}
