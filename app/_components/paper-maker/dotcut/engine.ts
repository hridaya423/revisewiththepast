import { cellGeometry, layoutGrid } from "@/app/_components/paper-maker/dotcut/geometry";
import { PALETTES, SCENES, cellDelay, cellMotion, rasterize, styleField, type Scene } from "@/app/_components/paper-maker/dotcut/scenes";

const HOLD_MS = 600;
const MORPH_MS = 520;
const easeOut = (time: number) => 1 - (1 - time) ** 3;
const easeInOut = (time: number) => time < 0.5 ? 4 * time ** 3 : 1 - (-2 * time + 2) ** 3 / 2;

function hash(value: number) {
  const result = Math.sin(value * 127.1 + 311.7) * 43758.5453;
  return result - Math.floor(result);
}

export class DotCutEngine {
  private readonly host: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private context: CanvasRenderingContext2D | null;
  private cols = 42;
  private rows = 12;
  private pitch = 10;
  private offsetX = 0;
  private offsetY = 0;
  private target = new Uint8Array(0);
  private live = new Float32Array(0);
  private from = new Float32Array(0);
  private delays = new Float32Array(0);
  private random = new Float32Array(0);
  private progress = new Float32Array(0);
  private direction = new Float32Array(0);
  private textureBore = new Float32Array(0);
  private brushField = new Float32Array(0);
  private styleTime = 0;
  private sceneIndex = 0;
  private previousSceneIndex = 0;
  private phase: "hold" | "morph" = "hold";
  private phaseTime = 0;
  private paletteMix = 1;
  private previousPalette = 0;
  private pointer: { x: number; y: number } | null = null;
  private animationFrame = 0;
  private lastFrame = 0;
  private running = false;
  private dpr = 1;
  private resizeObserver: ResizeObserver | null = null;
  private disposed = false;
  private fontFamily: string;

  constructor(host: HTMLElement, fontFamily: string) {
    this.host = host;
    this.fontFamily = fontFamily;
    this.canvas = document.createElement("canvas");
    Object.assign(this.canvas.style, { position: "absolute", inset: "0", display: "block", width: "100%", height: "100%" });
    this.canvas.setAttribute("aria-hidden", "true");
    host.appendChild(this.canvas);
    this.context = this.canvas.getContext("2d");
    if (!this.context) return;
    this.resize();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
  }

  get ready() {
    return this.context !== null;
  }

  private applyScene(scene: Scene, instant: boolean) {
    const next = rasterize(scene, this.cols, this.rows, this.fontFamily);
    this.from.set(this.live);
    this.target = next;
    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        const index = y * this.cols + x;
        this.delays[index] = cellDelay(scene.transition, x, y, this.cols, this.rows, this.random[index]);
      }
    }
    if (!instant) return;
    for (let index = 0; index < next.length; index++) this.live[index] = next[index];
    this.from.set(this.live);
  }

  private resize() {
    if (!this.context || this.disposed) return;
    const width = this.host.clientWidth;
    const height = this.host.clientHeight;
    if (!width || !height) return;
    this.dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const bufferWidth = Math.round(width * this.dpr);
    const bufferHeight = Math.round(height * this.dpr);
    if (this.canvas.width === bufferWidth && this.canvas.height === bufferHeight && this.live.length) return;
    this.canvas.width = bufferWidth;
    this.canvas.height = bufferHeight;
    const layout = layoutGrid(width, height, 42);
    this.cols = layout.cols;
    this.rows = layout.rows;
    this.pitch = layout.pitch;
    this.offsetX = layout.offsetX;
    this.offsetY = layout.offsetY;
    const count = this.cols * this.rows;
    this.target = new Uint8Array(count);
    this.live = new Float32Array(count);
    this.from = new Float32Array(count);
    this.delays = new Float32Array(count);
    this.random = new Float32Array(count);
    this.progress = new Float32Array(count);
    this.direction = new Float32Array(count);
    this.textureBore = new Float32Array(count);
    this.brushField = new Float32Array(count).fill(1);
    for (let index = 0; index < count; index++) this.random[index] = hash(index * 1.37 + 0.5);
    this.applyScene(SCENES[this.sceneIndex], true);
    styleField(SCENES[this.sceneIndex], this.cols, this.rows, 1, this.textureBore);
    this.draw(0);
  }

  private advance() {
    this.previousSceneIndex = this.sceneIndex;
    this.sceneIndex = (this.sceneIndex + 1) % SCENES.length;
    this.previousPalette = SCENES[this.previousSceneIndex].palette;
    this.paletteMix = 0;
    this.phase = "morph";
    this.phaseTime = 0;
    this.styleTime = 0;
    this.applyScene(SCENES[this.sceneIndex], false);
  }

  private step(delta: number) {
    this.phaseTime += delta * 1000;
    if (this.phase === "hold" && this.phaseTime >= HOLD_MS) this.advance();
    else if (this.phase === "morph" && this.phaseTime >= MORPH_MS) {
      this.phase = "hold";
      this.phaseTime = 0;
    }

    const phaseProgress = this.phase === "morph" ? Math.min(1, this.phaseTime / MORPH_MS) : 1;
    for (let index = 0; index < this.live.length; index++) {
      const local = Math.min(1, Math.max(0, (phaseProgress - this.delays[index] * 0.72) / 0.28));
      this.live[index] = this.from[index] + (this.target[index] - this.from[index]) * easeOut(local);
      const changing = this.from[index] !== this.target[index] && this.phase === "morph";
      this.progress[index] = changing ? local : 0;
      this.direction[index] = this.target[index] > this.from[index] ? 1 : -1;
    }

    this.paletteMix = Math.min(1, this.paletteMix + delta * 2.2);
    this.styleTime = this.phase === "morph" ? Math.min(1, this.styleTime + delta / (MORPH_MS / 1000)) : 1;
    styleField(SCENES[this.sceneIndex], this.cols, this.rows, this.styleTime, this.textureBore, SCENES[this.previousSceneIndex]);

    const brushRadius = 1.6;
    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        const index = y * this.cols + x;
        let target = 1;
        if (this.pointer) {
          const distance = Math.hypot(x + 0.5 - this.pointer.x, y + 0.5 - this.pointer.y);
          if (distance < brushRadius) target = Math.min(1, (distance / brushRadius) ** 2);
        }
        const response = target < this.brushField[index] ? 0.38 : 0.16;
        this.brushField[index] += (target - this.brushField[index]) * (1 - (1 - response) ** (delta * 60));
      }
    }
  }

  private draw(delta: number) {
    const context = this.context;
    if (!context) return;
    this.step(delta);
    const scale = this.dpr;
    const width = this.canvas.width;
    const height = this.canvas.height;
    const scene = SCENES[this.sceneIndex];
    const [previousCircle, previousBackground] = PALETTES[this.previousPalette % PALETTES.length];
    const [nextCircle, nextBackground] = PALETTES[scene.palette % PALETTES.length];
    const paletteTime = easeInOut(this.paletteMix);
    context.fillStyle = mixHex(previousBackground, nextBackground, paletteTime);
    context.fillRect(0, 0, width, height);
    context.fillStyle = mixHex(previousCircle, nextCircle, paletteTime);

    const pitch = this.pitch * scale;
    const radius = pitch / 2;
    const stroke = Math.max(1.1 * scale, radius * 0.3);
    const path = new Path2D();

    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        const index = y * this.cols + x;
        const solidity = this.live[index] * this.brushField[index];
        if (solidity <= 0.004) continue;
        const motion = cellMotion(scene.transition, this.progress[index], this.direction[index], this.random[index]);
        const centerX = this.offsetX * scale + (x + 0.5) * pitch + motion.dx * pitch;
        const centerY = this.offsetY * scale + (y + 0.5) * pitch + motion.dy * pitch;
        const motionRadius = radius * motion.scale;
        const geometry = cellGeometry(solidity, this.textureBore[index] * solidity, motionRadius, stroke);
        if (geometry.outerRadius <= 0.3) continue;
        path.moveTo(centerX + geometry.outerRadius, centerY);
        path.arc(centerX, centerY, geometry.outerRadius, 0, Math.PI * 2);
        if (geometry.boreRadius > 0.4) {
          path.moveTo(centerX + geometry.boreRadius, centerY);
          path.arc(centerX, centerY, geometry.boreRadius, 0, Math.PI * 2, true);
        }
      }
    }

    context.fill(path, "evenodd");
  }

  start() {
    if (this.running || !this.ready || this.disposed) return;
    this.running = true;
    this.lastFrame = performance.now();
    const tick = (now: number) => {
      if (!this.running) return;
      const delta = Math.min((now - this.lastFrame) / 1000, 1 / 30);
      this.lastFrame = now;
      this.draw(delta);
      this.animationFrame = requestAnimationFrame(tick);
    };
    this.animationFrame = requestAnimationFrame(tick);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.animationFrame);
    this.animationFrame = 0;
  }

  renderStill() {
    this.phase = "hold";
    this.phaseTime = 0;
    this.paletteMix = 1;
    this.applyScene(SCENES[this.sceneIndex], true);
    this.draw(0);
  }

  refreshFont(fontFamily: string) {
    if (this.disposed) return;
    this.fontFamily = fontFamily;
    this.applyScene(SCENES[this.sceneIndex], true);
    this.draw(0);
  }

  setPointer(pointer: { x: number; y: number } | null) {
    this.pointer = pointer;
  }

  toCell(x: number, y: number) {
    return { x: (x - this.offsetX) / this.pitch, y: (y - this.offsetY) / this.pitch };
  }

  destroy() {
    this.disposed = true;
    this.stop();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.context = null;
    this.canvas.remove();
  }
}

function mixHex(from: string, to: string, time: number) {
  const first = parseInt(from.slice(1), 16);
  const second = parseInt(to.slice(1), 16);
  const red = Math.round(((first >> 16) & 255) * (1 - time) + ((second >> 16) & 255) * time);
  const green = Math.round(((first >> 8) & 255) * (1 - time) + ((second >> 8) & 255) * time);
  const blue = Math.round((first & 255) * (1 - time) + (second & 255) * time);
  return `rgb(${red},${green},${blue})`;
}
