/**
 * LiquidEther — interactive fluid background (React Bits, MIT) ported to the
 * design system.
 *
 * A Navier-Stokes solver runs on the GPU at a fraction of the canvas size;
 * the pointer (or an automatic driver while nobody hovers) pushes the fluid
 * and the flow speed picks a colour from `colors`. The canvas is transparent
 * where the fluid rests, so the surface underneath provides the base colour.
 *
 * - Colours accept any CSS colour or a token as `var(--color-x)` (resolved at mount).
 * - Nothing is rendered for `prefers-reduced-motion` or when WebGL is unavailable:
 *   keep a static background behind it.
 * - Load it with `React.lazy` + `<Suspense fallback={null}>`; `three` only ships where it is used.
 *
 *   <div className="absolute inset-0"><LiquidEther colors={[…]} /></div>
 */

import { useEffect, useRef } from 'react';
import { useReducedMotion } from 'motion/react';
import * as THREE from 'three';
import { cn } from '../lib/cn';

export interface LiquidEtherProps {
  /** Palette sampled by flow speed, slow → fast. */
  colors?: readonly string[];
  /** Push the pointer applies to the fluid. */
  mouseForce?: number;
  /** Pointer radius, in simulation cells. */
  cursorSize?: number;
  isViscous?: boolean;
  viscous?: number;
  iterationsViscous?: number;
  iterationsPoisson?: number;
  /** Simulation time step. */
  dt?: number;
  /** Second-order advection (sharper flow at a small cost). */
  BFECC?: boolean;
  /** Simulation size relative to the canvas (0.5 = a quarter of the pixels). */
  resolution?: number;
  /** Bounce off the edges instead of flowing out. */
  isBounce?: boolean;
  /** Keep the fluid moving on its own while nobody hovers the canvas. */
  autoDemo?: boolean;
  autoSpeed?: number;
  autoIntensity?: number;
  /** Seconds the pointer takes over from the automatic driver. */
  takeoverDuration?: number;
  /** Milliseconds of idle pointer before the driver resumes. */
  autoResumeDelay?: number;
  /** Seconds the driver ramps up when it resumes. */
  autoRampDuration?: number;
  /** Chroma-only ink for light surfaces. */
  lightMode?: boolean;
  className?: string;
}

const DEFAULT_COLORS = [
  'var(--color-accent-pressed)',
  'var(--color-accent)',
  'var(--color-surface)',
];

/* ── Shaders (GLSL 1, clip-space quads) ─────────────────────────────── */

const FACE_VERT = /* glsl */ `
attribute vec3 position;
uniform vec2 px;
uniform vec2 boundarySpace;
varying vec2 uv;
precision highp float;
void main(){
  vec3 pos = position;
  vec2 scale = 1.0 - boundarySpace * 2.0;
  pos.xy = pos.xy * scale;
  uv = vec2(0.5) + (pos.xy) * 0.5;
  gl_Position = vec4(pos, 1.0);
}
`;

const LINE_VERT = /* glsl */ `
attribute vec3 position;
uniform vec2 px;
precision highp float;
varying vec2 uv;
void main(){
  vec3 pos = position;
  uv = 0.5 + pos.xy * 0.5;
  vec2 n = sign(pos.xy);
  pos.xy = abs(pos.xy) - px * 1.0;
  pos.xy *= n;
  gl_Position = vec4(pos, 1.0);
}
`;

const MOUSE_VERT = /* glsl */ `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
uniform vec2 center;
uniform vec2 scale;
uniform vec2 px;
varying vec2 vUv;
void main(){
  vec2 pos = position.xy * scale * 2.0 * px + center;
  vUv = uv;
  gl_Position = vec4(pos, 0.0, 1.0);
}
`;

const ADVECTION_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D velocity;
uniform float dt;
uniform bool isBFECC;
uniform vec2 fboSize;
uniform vec2 px;
varying vec2 uv;
void main(){
  vec2 ratio = max(fboSize.x, fboSize.y) / fboSize;
  if (isBFECC == false) {
    vec2 vel = texture2D(velocity, uv).xy;
    vec2 uv2 = uv - vel * dt * ratio;
    vec2 newVel = texture2D(velocity, uv2).xy;
    gl_FragColor = vec4(newVel, 0.0, 0.0);
  } else {
    vec2 spot_new = uv;
    vec2 vel_old = texture2D(velocity, uv).xy;
    vec2 spot_old = spot_new - vel_old * dt * ratio;
    vec2 vel_new1 = texture2D(velocity, spot_old).xy;
    vec2 spot_new2 = spot_old + vel_new1 * dt * ratio;
    vec2 error = spot_new2 - spot_new;
    vec2 spot_new3 = spot_new - error / 2.0;
    vec2 vel_2 = texture2D(velocity, spot_new3).xy;
    vec2 spot_old2 = spot_new3 - vel_2 * dt * ratio;
    vec2 newVel2 = texture2D(velocity, spot_old2).xy;
    gl_FragColor = vec4(newVel2, 0.0, 0.0);
  }
}
`;

const COLOR_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D velocity;
uniform sampler2D palette;
uniform vec4 bgColor;
uniform bool lightMode;
varying vec2 uv;
void main(){
  vec2 vel = texture2D(velocity, uv).xy;
  float lenv = clamp(length(vel), 0.0, 1.0);
  vec3 c = texture2D(palette, vec2(lenv, 0.5)).rgb;
  float peak = max(c.r, max(c.g, c.b));
  vec3 chroma = clamp(c / max(peak, 0.0001), 0.0, 1.0);
  chroma = pow(chroma, vec3(1.25));
  vec3 ink = lightMode ? chroma : c;
  vec3 outRGB = mix(bgColor.rgb, ink, lenv);
  float outA = mix(bgColor.a, 1.0, lenv);
  gl_FragColor = vec4(outRGB, outA);
}
`;

const DIVERGENCE_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D velocity;
uniform float dt;
uniform vec2 px;
varying vec2 uv;
void main(){
  float x0 = texture2D(velocity, uv - vec2(px.x, 0.0)).x;
  float x1 = texture2D(velocity, uv + vec2(px.x, 0.0)).x;
  float y0 = texture2D(velocity, uv - vec2(0.0, px.y)).y;
  float y1 = texture2D(velocity, uv + vec2(0.0, px.y)).y;
  float divergence = (x1 - x0 + y1 - y0) / 2.0;
  gl_FragColor = vec4(divergence / dt);
}
`;

const EXTERNAL_FORCE_FRAG = /* glsl */ `
precision highp float;
uniform vec2 force;
uniform vec2 center;
uniform vec2 scale;
uniform vec2 px;
varying vec2 vUv;
void main(){
  vec2 circle = (vUv - 0.5) * 2.0;
  float d = 1.0 - min(length(circle), 1.0);
  d *= d;
  gl_FragColor = vec4(force * d, 0.0, 1.0);
}
`;

const POISSON_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D pressure;
uniform sampler2D divergence;
uniform vec2 px;
varying vec2 uv;
void main(){
  float p0 = texture2D(pressure, uv + vec2(px.x * 2.0, 0.0)).r;
  float p1 = texture2D(pressure, uv - vec2(px.x * 2.0, 0.0)).r;
  float p2 = texture2D(pressure, uv + vec2(0.0, px.y * 2.0)).r;
  float p3 = texture2D(pressure, uv - vec2(0.0, px.y * 2.0)).r;
  float div = texture2D(divergence, uv).r;
  float newP = (p0 + p1 + p2 + p3) / 4.0 - div;
  gl_FragColor = vec4(newP);
}
`;

const PRESSURE_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D pressure;
uniform sampler2D velocity;
uniform vec2 px;
uniform float dt;
varying vec2 uv;
void main(){
  float step = 1.0;
  float p0 = texture2D(pressure, uv + vec2(px.x * step, 0.0)).r;
  float p1 = texture2D(pressure, uv - vec2(px.x * step, 0.0)).r;
  float p2 = texture2D(pressure, uv + vec2(0.0, px.y * step)).r;
  float p3 = texture2D(pressure, uv - vec2(0.0, px.y * step)).r;
  vec2 v = texture2D(velocity, uv).xy;
  vec2 gradP = vec2(p0 - p1, p2 - p3) * 0.5;
  v = v - gradP * dt;
  gl_FragColor = vec4(v, 0.0, 1.0);
}
`;

const VISCOUS_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D velocity;
uniform sampler2D velocity_new;
uniform float v;
uniform vec2 px;
uniform float dt;
varying vec2 uv;
void main(){
  vec2 old = texture2D(velocity, uv).xy;
  vec2 new0 = texture2D(velocity_new, uv + vec2(px.x * 2.0, 0.0)).xy;
  vec2 new1 = texture2D(velocity_new, uv - vec2(px.x * 2.0, 0.0)).xy;
  vec2 new2 = texture2D(velocity_new, uv + vec2(0.0, px.y * 2.0)).xy;
  vec2 new3 = texture2D(velocity_new, uv - vec2(0.0, px.y * 2.0)).xy;
  vec2 newv = 4.0 * old + v * dt * (new0 + new1 + new2 + new3);
  newv /= 4.0 * (1.0 + v * dt);
  gl_FragColor = vec4(newv, 0.0, 0.0);
}
`;

/* ── Pointer + automatic driver ─────────────────────────────────────── */

interface SimulationOptions {
  mouseForce: number;
  cursorSize: number;
  isViscous: boolean;
  viscous: number;
  iterationsViscous: number;
  iterationsPoisson: number;
  dt: number;
  bfecc: boolean;
  resolution: number;
  isBounce: boolean;
}

interface DriverOptions {
  autoDemo: boolean;
  autoSpeed: number;
  autoIntensity: number;
  takeoverDuration: number;
  autoResumeDelay: number;
  autoRampDuration: number;
}

/** Pointer position in clip space (-1..1) plus its per-frame delta. */
class Pointer {
  readonly coords = new THREE.Vector2();
  readonly diff = new THREE.Vector2();
  hoverInside = false;
  autoActive = false;
  autoIntensity = 2;
  takeoverDuration = 0.25;
  lastInteraction = performance.now();

  private readonly previous = new THREE.Vector2();
  private hasControl = false;
  private takeover: { from: THREE.Vector2; to: THREE.Vector2; startedAt: number } | null = null;
  private readonly onMouseMove = (event: MouseEvent) =>
    this.handleMove(event.clientX, event.clientY);
  private readonly onTouch = (event: TouchEvent) => {
    const touch = event.touches[0];
    if (event.touches.length !== 1 || !touch) return;
    this.handleMove(touch.clientX, touch.clientY, true);
  };
  private readonly onLeave = () => {
    this.hoverInside = false;
  };

  constructor(private readonly container: HTMLElement) {}

  listen(): void {
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('touchstart', this.onTouch, { passive: true });
    window.addEventListener('touchmove', this.onTouch, { passive: true });
    window.addEventListener('touchend', this.onLeave);
    document.addEventListener('mouseleave', this.onLeave);
  }

  dispose(): void {
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('touchstart', this.onTouch);
    window.removeEventListener('touchmove', this.onTouch);
    window.removeEventListener('touchend', this.onLeave);
    document.removeEventListener('mouseleave', this.onLeave);
  }

  /** The driver moves the pointer directly in clip space. */
  setNormalized(x: number, y: number): void {
    this.coords.set(x, y);
  }

  update(): void {
    if (this.takeover) {
      const t = (performance.now() - this.takeover.startedAt) / (this.takeoverDuration * 1000);
      if (t >= 1) {
        this.coords.copy(this.takeover.to);
        this.previous.copy(this.coords);
        this.diff.set(0, 0);
        this.takeover = null;
      } else {
        const k = t * t * (3 - 2 * t);
        this.coords.copy(this.takeover.from).lerp(this.takeover.to, k);
      }
    }
    this.diff.subVectors(this.coords, this.previous);
    this.previous.copy(this.coords);
    if (this.previous.x === 0 && this.previous.y === 0) this.diff.set(0, 0);
    if (this.autoActive && !this.takeover) this.diff.multiplyScalar(this.autoIntensity);
  }

  private handleMove(clientX: number, clientY: number, touch = false): void {
    const rect = this.container.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const nx = (clientX - rect.left) / rect.width;
    const ny = (clientY - rect.top) / rect.height;
    this.hoverInside = nx >= 0 && nx <= 1 && ny >= 0 && ny <= 1;
    if (!this.hoverInside) return;
    this.lastInteraction = performance.now();
    const target = new THREE.Vector2(nx * 2 - 1, -(ny * 2 - 1));
    // Ease from the driver's position to the real pointer instead of jumping.
    if (!touch && this.autoActive && !this.hasControl && !this.takeover) {
      this.takeover = { from: this.coords.clone(), to: target, startedAt: performance.now() };
      this.hasControl = true;
      this.autoActive = false;
      return;
    }
    this.coords.copy(target);
    this.hasControl = true;
  }
}

/** Wanders between random targets while the pointer is idle or away. */
class AutoDriver {
  enabled = true;
  speed = 0.5;
  resumeDelay = 1000;
  rampDurationMs = 600;

  private active = false;
  private readonly current = new THREE.Vector2();
  private readonly target = new THREE.Vector2();
  private readonly direction = new THREE.Vector2();
  private lastTime = performance.now();
  private activatedAt = 0;
  private readonly margin = 0.2;

  constructor(private readonly pointer: Pointer) {
    this.pickTarget();
  }

  update(): void {
    if (!this.enabled) return this.stop();
    const now = performance.now();
    if (now - this.pointer.lastInteraction < this.resumeDelay || this.pointer.hoverInside) {
      return this.stop();
    }
    if (!this.active) {
      this.active = true;
      this.current.copy(this.pointer.coords);
      this.lastTime = now;
      this.activatedAt = now;
    }
    this.pointer.autoActive = true;
    let dtSec = (now - this.lastTime) / 1000;
    this.lastTime = now;
    if (dtSec > 0.2) dtSec = 0.016;
    const distance = this.direction.subVectors(this.target, this.current).length();
    if (distance < 0.01) {
      this.pickTarget();
      return;
    }
    this.direction.normalize();
    let ramp = 1;
    if (this.rampDurationMs > 0) {
      const t = Math.min(1, (now - this.activatedAt) / this.rampDurationMs);
      ramp = t * t * (3 - 2 * t);
    }
    const move = Math.min(this.speed * dtSec * ramp, distance);
    this.current.addScaledVector(this.direction, move);
    this.pointer.setNormalized(this.current.x, this.current.y);
  }

  private stop(): void {
    this.active = false;
    this.pointer.autoActive = false;
  }

  private pickTarget(): void {
    const spread = 1 - this.margin;
    this.target.set((Math.random() * 2 - 1) * spread, (Math.random() * 2 - 1) * spread);
  }
}

/* ── Simulation ─────────────────────────────────────────────────────── */

interface Pass {
  scene: THREE.Scene;
  material: THREE.RawShaderMaterial;
}

const FBO_NAMES = [
  'vel0',
  'vel1',
  'viscous0',
  'viscous1',
  'divergence',
  'pressure0',
  'pressure1',
] as const;
type FboName = (typeof FBO_NAMES)[number];

/**
 * Uniform declared by a pass, typed. three types them as an `any` index, which
 * `noUncheckedIndexedAccess` and `no-unsafe-*` reject; every name used here is
 * declared in the same file, so a miss is a programming error.
 */
function uniform<T>(material: THREE.ShaderMaterial, name: string): THREE.IUniform<T> {
  const found = material.uniforms[name];
  if (!found) throw new Error(`LiquidEther: missing uniform "${name}"`);
  return found as THREE.IUniform<T>;
}

function createPass(
  vertexShader: string,
  fragmentShader: string,
  uniforms: Record<string, THREE.IUniform>,
): Pass {
  const scene = new THREE.Scene();
  const material = new THREE.RawShaderMaterial({ vertexShader, fragmentShader, uniforms });
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));
  return { scene, material };
}

function disposePass({ scene, material }: Pass): void {
  scene.traverse((object) => {
    if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
      (object.geometry as THREE.BufferGeometry).dispose();
    }
  });
  material.dispose();
}

class FluidSimulation {
  private readonly camera = new THREE.Camera();
  private readonly fboSize = new THREE.Vector2();
  private readonly cellScale = new THREE.Vector2();
  private readonly boundarySpace = new THREE.Vector2();
  private readonly fbos: Record<FboName, THREE.WebGLRenderTarget>;
  private readonly advection: Pass;
  private readonly boundary: THREE.LineSegments<THREE.BufferGeometry, THREE.RawShaderMaterial>;
  private readonly force: Pass;
  private readonly viscous: Pass;
  private readonly divergence: Pass;
  private readonly poisson: Pass;
  private readonly pressure: Pass;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    width: number,
    height: number,
    private resolution: number,
  ) {
    this.measure(width, height);
    // iOS cannot render to full float targets.
    const type = /(iPad|iPhone|iPod)/i.test(navigator.userAgent)
      ? THREE.HalfFloatType
      : THREE.FloatType;
    const targetOptions: THREE.RenderTargetOptions = {
      type,
      depthBuffer: false,
      stencilBuffer: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
    };
    this.fbos = Object.fromEntries(
      FBO_NAMES.map((name) => [
        name,
        new THREE.WebGLRenderTarget(this.fboSize.x, this.fboSize.y, targetOptions),
      ]),
    ) as Record<FboName, THREE.WebGLRenderTarget>;

    this.advection = createPass(FACE_VERT, ADVECTION_FRAG, {
      boundarySpace: { value: this.cellScale },
      px: { value: this.cellScale },
      fboSize: { value: this.fboSize },
      velocity: { value: this.fbos.vel0.texture },
      dt: { value: 0.014 },
      isBFECC: { value: true },
    });
    // Edge segments re-advected with the same shader when the fluid should bounce.
    const boundaryGeometry = new THREE.BufferGeometry();
    boundaryGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(
        new Float32Array([
          -1, -1, 0, -1, 1, 0, -1, 1, 0, 1, 1, 0, 1, 1, 0, 1, -1, 0, 1, -1, 0, -1, -1, 0,
        ]),
        3,
      ),
    );
    this.boundary = new THREE.LineSegments(
      boundaryGeometry,
      new THREE.RawShaderMaterial({
        vertexShader: LINE_VERT,
        fragmentShader: ADVECTION_FRAG,
        uniforms: this.advection.material.uniforms,
      }),
    );
    this.advection.scene.add(this.boundary);

    this.force = {
      scene: new THREE.Scene(),
      material: new THREE.RawShaderMaterial({
        vertexShader: MOUSE_VERT,
        fragmentShader: EXTERNAL_FORCE_FRAG,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        uniforms: {
          px: { value: this.cellScale },
          force: { value: new THREE.Vector2() },
          center: { value: new THREE.Vector2() },
          scale: { value: new THREE.Vector2() },
        },
      }),
    };
    this.force.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.force.material));

    this.viscous = createPass(FACE_VERT, VISCOUS_FRAG, {
      boundarySpace: { value: this.boundarySpace },
      velocity: { value: this.fbos.vel1.texture },
      velocity_new: { value: this.fbos.viscous0.texture },
      v: { value: 30 },
      px: { value: this.cellScale },
      dt: { value: 0.014 },
    });
    this.divergence = createPass(FACE_VERT, DIVERGENCE_FRAG, {
      boundarySpace: { value: this.boundarySpace },
      velocity: { value: this.fbos.viscous0.texture },
      px: { value: this.cellScale },
      dt: { value: 0.014 },
    });
    this.poisson = createPass(FACE_VERT, POISSON_FRAG, {
      boundarySpace: { value: this.boundarySpace },
      pressure: { value: this.fbos.pressure0.texture },
      divergence: { value: this.fbos.divergence.texture },
      px: { value: this.cellScale },
    });
    this.pressure = createPass(FACE_VERT, PRESSURE_FRAG, {
      boundarySpace: { value: this.boundarySpace },
      pressure: { value: this.fbos.pressure0.texture },
      velocity: { value: this.fbos.viscous0.texture },
      px: { value: this.cellScale },
      dt: { value: 0.014 },
    });
  }

  /** Texture the colour pass reads: the divergence-free velocity field. */
  get velocityTexture(): THREE.Texture {
    return this.fbos.vel0.texture;
  }

  resize(width: number, height: number, resolution = this.resolution): void {
    this.resolution = resolution;
    this.measure(width, height);
    for (const fbo of Object.values(this.fbos)) fbo.setSize(this.fboSize.x, this.fboSize.y);
  }

  step(options: SimulationOptions, pointer: Pointer): void {
    if (options.isBounce) this.boundarySpace.set(0, 0);
    else this.boundarySpace.copy(this.cellScale);

    // Advect the velocity field by itself.
    uniform<number>(this.advection.material, 'dt').value = options.dt;
    uniform<boolean>(this.advection.material, 'isBFECC').value = options.bfecc;
    this.boundary.visible = options.isBounce;
    this.render(this.advection, this.fbos.vel1);

    // Add the pointer's push on top (additive blending).
    const cursorX = options.cursorSize * this.cellScale.x;
    const cursorY = options.cursorSize * this.cellScale.y;
    const force = this.force.material;
    uniform<THREE.Vector2>(force, 'force').value.set(
      (pointer.diff.x / 2) * options.mouseForce,
      (pointer.diff.y / 2) * options.mouseForce,
    );
    uniform<THREE.Vector2>(force, 'center').value.set(
      THREE.MathUtils.clamp(
        pointer.coords.x,
        -1 + cursorX + this.cellScale.x * 2,
        1 - cursorX - this.cellScale.x * 2,
      ),
      THREE.MathUtils.clamp(
        pointer.coords.y,
        -1 + cursorY + this.cellScale.y * 2,
        1 - cursorY - this.cellScale.y * 2,
      ),
    );
    uniform<THREE.Vector2>(force, 'scale').value.set(options.cursorSize, options.cursorSize);
    this.render(this.force, this.fbos.vel1);

    // Optional viscosity, solved iteratively between two targets.
    let velocity = this.fbos.vel1;
    if (options.isViscous) {
      uniform<number>(this.viscous.material, 'v').value = options.viscous;
      uniform<number>(this.viscous.material, 'dt').value = options.dt;
      for (let i = 0; i < options.iterationsViscous; i += 1) {
        const input = i % 2 === 0 ? this.fbos.viscous0 : this.fbos.viscous1;
        const output = i % 2 === 0 ? this.fbos.viscous1 : this.fbos.viscous0;
        uniform<THREE.Texture>(this.viscous.material, 'velocity_new').value = input.texture;
        this.render(this.viscous, output);
        velocity = output;
      }
    }

    // Project the field so it stays divergence-free.
    uniform<THREE.Texture>(this.divergence.material, 'velocity').value = velocity.texture;
    this.render(this.divergence, this.fbos.divergence);
    let pressure = this.fbos.pressure1;
    for (let i = 0; i < options.iterationsPoisson; i += 1) {
      const input = i % 2 === 0 ? this.fbos.pressure0 : this.fbos.pressure1;
      const output = i % 2 === 0 ? this.fbos.pressure1 : this.fbos.pressure0;
      uniform<THREE.Texture>(this.poisson.material, 'pressure').value = input.texture;
      this.render(this.poisson, output);
      pressure = output;
    }
    uniform<THREE.Texture>(this.pressure.material, 'velocity').value = velocity.texture;
    uniform<THREE.Texture>(this.pressure.material, 'pressure').value = pressure.texture;
    uniform<number>(this.pressure.material, 'dt').value = options.dt;
    this.render(this.pressure, this.fbos.vel0);
  }

  dispose(): void {
    for (const fbo of Object.values(this.fbos)) fbo.dispose();
    for (const pass of [
      this.advection,
      this.force,
      this.viscous,
      this.divergence,
      this.poisson,
      this.pressure,
    ]) {
      disposePass(pass);
    }
    this.boundary.material.dispose();
  }

  private measure(width: number, height: number): void {
    const w = Math.max(1, Math.round(this.resolution * width));
    const h = Math.max(1, Math.round(this.resolution * height));
    this.fboSize.set(w, h);
    this.cellScale.set(1 / w, 1 / h);
  }

  private render(pass: Pass, target: THREE.WebGLRenderTarget): void {
    this.renderer.setRenderTarget(target);
    this.renderer.render(pass.scene, this.camera);
    this.renderer.setRenderTarget(null);
  }
}

/* ── Palette ────────────────────────────────────────────────────────── */

/** Resolves `var(--token)` against the element; other values pass through. */
function resolveColor(value: string, element: Element): string {
  const name = /^var\((--[\w-]+)\)$/.exec(value.trim())?.[1];
  if (name === undefined) return value;
  return getComputedStyle(element).getPropertyValue(name).trim() || '#ffffff';
}

/**
 * `THREE.Color` only parses hex, rgb() and hsl(), and warns on anything else. The
 * tokens of this app are oklch(), so the browser converts them: a 1x1 canvas in
 * sRGB returns the bytes the colour pass expects.
 */
function toSrgb(color: string, context: CanvasRenderingContext2D | null): string {
  if (!context) return color;
  context.fillStyle = '#ffffff';
  context.fillStyle = color;
  context.clearRect(0, 0, 1, 1);
  context.fillRect(0, 0, 1, 1);
  const [r = 255, g = 255, b = 255] = context.getImageData(0, 0, 1, 1).data;
  return `rgb(${r}, ${g}, ${b})`;
}

function createPalette(colors: readonly string[], element: Element): THREE.DataTexture {
  const given = colors.filter(Boolean);
  const [first] = given;
  const stops =
    given.length > 1 ? given : first !== undefined ? [first, first] : ['#ffffff', '#ffffff'];
  const data = new Uint8Array(stops.length * 4);
  const rgb = { r: 0, g: 0, b: 0 };
  const context = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  stops.forEach((stop, index) => {
    // Raw sRGB bytes: the colour pass writes straight to the canvas.
    new THREE.Color(toSrgb(resolveColor(stop, element), context)).getRGB(rgb, THREE.SRGBColorSpace);
    data.set(
      [Math.round(rgb.r * 255), Math.round(rgb.g * 255), Math.round(rgb.b * 255), 255],
      index * 4,
    );
  });
  const texture = new THREE.DataTexture(data, stops.length, 1, THREE.RGBAFormat);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

/* ── Component ──────────────────────────────────────────────────────── */

interface Scene {
  renderer: THREE.WebGLRenderer;
  simulation: FluidSimulation;
  output: Pass;
  pointer: Pointer;
  driver: AutoDriver;
}

export function LiquidEther({
  colors = DEFAULT_COLORS,
  mouseForce = 20,
  cursorSize = 100,
  isViscous = false,
  viscous = 30,
  iterationsViscous = 32,
  iterationsPoisson = 32,
  dt = 0.014,
  BFECC = true,
  resolution = 0.5,
  isBounce = false,
  autoDemo = true,
  autoSpeed = 0.5,
  autoIntensity = 2.2,
  takeoverDuration = 0.25,
  autoResumeDelay = 1000,
  autoRampDuration = 0.6,
  lightMode = false,
  className,
}: LiquidEtherProps) {
  const reduceMotion = useReducedMotion();
  const mountRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<Scene | null>(null);
  // Tuning props are read per frame from a ref, so changing them never rebuilds the scene.
  const options: SimulationOptions & DriverOptions = {
    mouseForce,
    cursorSize,
    isViscous,
    viscous,
    iterationsViscous,
    iterationsPoisson,
    dt,
    bfecc: BFECC,
    resolution,
    isBounce,
    autoDemo,
    autoSpeed,
    autoIntensity,
    takeoverDuration,
    autoResumeDelay,
    autoRampDuration,
  };
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });
  const paletteKey = colors.join('|');

  useEffect(() => {
    const container = mountRef.current;
    if (!container || reduceMotion) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      return; // No WebGL: the static background behind the canvas stays.
    }
    const rect = container.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    renderer.autoClear = false;
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height);
    const canvas = renderer.domElement;
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';
    container.prepend(canvas);

    const simulation = new FluidSimulation(renderer, width, height, optionsRef.current.resolution);
    const output = createPass(FACE_VERT, COLOR_FRAG, {
      velocity: { value: simulation.velocityTexture },
      boundarySpace: { value: new THREE.Vector2() },
      palette: { value: createPalette(paletteKey.split('|'), container) },
      bgColor: { value: new THREE.Vector4(0, 0, 0, 0) },
      lightMode: { value: lightMode },
    });
    output.material.transparent = true;
    output.material.depthWrite = false;
    // The colour pass already outputs premultiplied colour (ink * speed over a clear
    // background). Normal blending multiplies by alpha again, which darkens the ink:
    // on dark surfaces it reads as depth, on light ones as grey smudges. Light mode
    // blends it as what it is.
    output.material.premultipliedAlpha = lightMode;
    const pointer = new Pointer(container);
    pointer.listen();
    const driver = new AutoDriver(pointer);
    const camera = new THREE.Camera();
    sceneRef.current = { renderer, simulation, output, pointer, driver };

    let frame: number | null = null;
    let visible = true;
    const render = () => {
      const options = optionsRef.current;
      driver.enabled = options.autoDemo;
      driver.speed = options.autoSpeed;
      driver.resumeDelay = options.autoResumeDelay;
      driver.rampDurationMs = options.autoRampDuration * 1000;
      pointer.autoIntensity = options.autoIntensity;
      pointer.takeoverDuration = options.takeoverDuration;
      driver.update();
      pointer.update();
      simulation.step(options, pointer);
      renderer.setRenderTarget(null);
      renderer.render(output.scene, camera);
    };
    const loop = () => {
      render();
      frame = requestAnimationFrame(loop);
    };
    const start = () => {
      if (frame === null) loop();
    };
    const pause = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
    };
    const onVisibility = () => {
      if (document.hidden) pause();
      else if (visible) start();
    };
    document.addEventListener('visibilitychange', onVisibility);

    // Only burn GPU time while the canvas is on screen.
    const intersection = new IntersectionObserver(
      ([entry]) => {
        visible = entry !== undefined && entry.isIntersecting && entry.intersectionRatio > 0;
        if (visible && !document.hidden) start();
        else pause();
      },
      { threshold: [0, 0.01, 0.1] },
    );
    intersection.observe(container);

    let resizeFrame: number | null = null;
    const resizeObserver = new ResizeObserver(() => {
      if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => {
        const next = container.getBoundingClientRect();
        const w = Math.max(1, Math.floor(next.width));
        const h = Math.max(1, Math.floor(next.height));
        renderer.setSize(w, h, false);
        simulation.resize(w, h, optionsRef.current.resolution);
      });
    });
    resizeObserver.observe(container);
    start();

    return () => {
      pause();
      if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
      resizeObserver.disconnect();
      intersection.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      pointer.dispose();
      simulation.dispose();
      uniform<THREE.DataTexture>(output.material, 'palette').value.dispose();
      disposePass(output);
      canvas.remove();
      renderer.dispose();
      renderer.forceContextLoss();
      sceneRef.current = null;
    };
    // The palette and light mode are baked into the output pass; everything else is read per frame.
  }, [lightMode, paletteKey, reduceMotion]);

  // A new resolution needs the simulation targets rebuilt at that size.
  useEffect(() => {
    const scene = sceneRef.current;
    const container = mountRef.current;
    if (!scene || !container) return;
    const rect = container.getBoundingClientRect();
    scene.simulation.resize(
      Math.max(1, Math.floor(rect.width)),
      Math.max(1, Math.floor(rect.height)),
      resolution,
    );
  }, [resolution]);

  return (
    <div
      ref={mountRef}
      aria-hidden
      className={cn(
        'pointer-events-none relative h-full w-full touch-none overflow-hidden',
        className,
      )}
    />
  );
}

export default LiquidEther;
