export type TransitionKind = "wipe" | "ripple" | "scatter" | "collapse" | "columns";
export type StyleKind = "drift" | "grain" | "swell" | "streak" | null;

export type Scene = {
  kind: "text" | "rings" | "checker" | "bars" | "columns" | "boxes";
  value?: string;
  transition: TransitionKind;
  palette: number;
  style?: StyleKind;
};

export const SCENES: Scene[] = [
  { kind: "text", value: "A", transition: "wipe", palette: 0, style: "drift" },
  { kind: "rings", transition: "ripple", palette: 1, style: "grain" },
  { kind: "columns", transition: "columns", palette: 2, style: "streak" },
  { kind: "checker", transition: "scatter", palette: 3, style: "swell" },
  { kind: "boxes", transition: "collapse", palette: 4, style: "grain" },
  { kind: "bars", transition: "wipe", palette: 5, style: "drift" },
];

export const PALETTES: [string, string][] = [
  ["#8aa9ff", "#1f45f5"],
  ["#ffd166", "#e5484d"],
  ["#b8f2c9", "#0f8a5f"],
  ["#ffc2e2", "#c81d77"],
  ["#c7d2fe", "#4338ca"],
  ["#fde68a", "#b45309"],
];

const clamp = (value: number) => Math.min(1, Math.max(0, value));
const smooth = (value: number, start: number, end: number) => {
  const amount = clamp((value - start) / (end - start));
  return amount * amount * (3 - 2 * amount);
};

function hash2(x: number, y: number) {
  const value = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return value - Math.floor(value);
}

export function cellMotion(kind: TransitionKind, time: number, direction: number, random: number) {
  const clampedTime = clamp(time);
  const movement = clampedTime === 0 || clampedTime === 1 ? 0 : Math.sin(clampedTime * Math.PI);
  if (movement === 0) return { scale: 1, dx: 0, dy: 0, spin: 0 };
  switch (kind) {
    case "wipe": return { scale: 1, dx: movement * 0.16 * -direction, dy: 0, spin: 0 };
    case "ripple": return { scale: 1 - movement * 0.1, dx: 0, dy: movement * -0.13, spin: 0 };
    case "scatter": return { scale: 1, dx: movement * 0.18 * Math.cos(random * Math.PI * 2), dy: movement * 0.18 * Math.sin(random * Math.PI * 2), spin: 0 };
    case "collapse": return { scale: 1 - movement * 0.18, dx: 0, dy: 0, spin: 0 };
    case "columns": return { scale: 1, dx: 0, dy: movement * 0.22, spin: 0 };
  }
}

export function styleField(scene: Scene, cols: number, rows: number, time: number, output: Float32Array, previous?: Scene) {
  const centerX = (cols - 1) / 2;
  const centerY = (rows - 1) / 2;
  const maximumRadius = Math.hypot(cols, rows) / 2;
  const flipWindow = 0.32;

  const state = (style: StyleKind | undefined, x: number, y: number) => {
    switch (style) {
      case "drift": return smooth((Math.sin(x * 0.41 + y * 0.23) + Math.sin(x * 0.17 - y * 0.53 + 2.1)) * 0.25, -0.15, 0.75);
      case "grain": return smooth(hash2(x, y) * 0.55 + hash2(x + 1, y) * 0.15 + hash2(x, y + 1) * 0.15 + hash2(x + 1, y + 1) * 0.15, 0.34, 0.86);
      case "swell": {
        const distance = Math.hypot(x - centerX, y - centerY) / maximumRadius;
        const warp = Math.sin(Math.atan2(y - centerY, x - centerX) * 3) * 0.14;
        return smooth(1 - distance - warp, 0.28, 0.92);
      }
      case "streak": return smooth(Math.sin(x * 0.28 + y * 0.62) * (Math.sin(x * 0.09 - y * 0.11 + 1.3) * 0.5 + 0.5), -0.05, 0.7);
      default: return 0;
    }
  };

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      let order = 0;
      switch (scene.style) {
        case "drift": order = x / cols * 0.75 + Math.sin(y * 0.5) * 0.12 + 0.12; break;
        case "grain": order = x / cols * 0.55 + y / rows * 0.25 + hash2(x, y) * 0.2; break;
        case "swell": order = Math.hypot(x - centerX, y - centerY) / maximumRadius; break;
        case "streak": order = x / cols * 0.8 + y / rows * 0.2; break;
      }
      const from = state(previous?.style ?? scene.style, x, y);
      const to = state(scene.style, x, y);
      const local = clamp((time - order * (1 - flipWindow)) / flipWindow);
      const eased = local * local * (3 - 2 * local);
      output[y * cols + x] = from + (to - from) * eased;
    }
  }
}

export function rasterize(scene: Scene, cols: number, rows: number, fontFamily: string) {
  const output = new Uint8Array(cols * rows).fill(1);
  const centerX = (cols - 1) / 2;
  const centerY = (rows - 1) / 2;

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const index = y * cols + x;
      if (scene.kind === "checker") {
        const block = Math.max(2, Math.round(cols / 14));
        if ((Math.floor(x / block) + Math.floor(y / block)) % 2 === 0) output[index] = 0;
      } else if (scene.kind === "bars") {
        if (Math.floor((x + y) / 3) % 2 === 0) output[index] = 0;
      } else if (scene.kind === "columns") {
        const band = Math.floor(y / 3);
        const shift = band % 2 === 0 ? 0 : 2;
        if (Math.floor((x + shift) / 4) % 2 === 0) output[index] = 0;
      } else if (scene.kind === "boxes") {
        if (Math.floor(Math.max(Math.abs(x - centerX), Math.abs(y - centerY)) / 2.5) % 2 === 0) output[index] = 0;
      } else if (scene.kind === "rings") {
        const distance = Math.hypot(x - centerX, y - centerY) / (Math.hypot(cols, rows) / 2);
        if (Math.floor(distance * 6) % 2 === 0) output[index] = 0;
      }
    }
  }

  if (scene.kind !== "text") return output;
  const canvas = document.createElement("canvas");
  canvas.width = cols;
  canvas.height = rows;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return output;
  const text = scene.value?.trim() ?? "";
  if (!text) return output;
  context.fillStyle = "#000";
  context.fillRect(0, 0, cols, rows);
  context.fillStyle = "#fff";
  context.textAlign = "center";
  context.textBaseline = "middle";
  let size = rows * 0.8;
  context.font = `700 ${size}px ${fontFamily}`;
  const widthLimit = cols * 0.36;
  const measuredWidth = context.measureText(text).width;
  if (measuredWidth > widthLimit) {
    size *= widthLimit / measuredWidth;
    context.font = `700 ${size}px ${fontFamily}`;
  }
  const heightLimit = rows * 0.58;
  const metrics = context.measureText(text);
  const measuredHeight = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
  if (measuredHeight > heightLimit) {
    size *= heightLimit / measuredHeight;
    context.font = `700 ${size}px ${fontFamily}`;
  }
  context.fillText(text, cols / 2, rows / 2 + rows * 0.02);
  const pixels = context.getImageData(0, 0, cols, rows).data;
  for (let index = 0; index < output.length; index++) if (pixels[index * 4] > 110) output[index] = 0;
  return output;
}

export function cellDelay(kind: TransitionKind, x: number, y: number, cols: number, rows: number, random: number) {
  const horizontal = cols > 1 ? x / (cols - 1) : 0;
  const vertical = rows > 1 ? y / (rows - 1) : 0;
  switch (kind) {
    case "wipe": return clamp((horizontal * 0.75 + vertical * 0.25) * 0.85 + random * 0.15);
    case "ripple": return clamp(Math.hypot(horizontal - 0.5, vertical - 0.5) / 0.707 * 0.9 + random * 0.1);
    case "scatter": return random;
    case "collapse": return clamp((1 - Math.hypot(horizontal - 0.5, vertical - 0.5) / 0.707) * 0.85 + random * 0.15);
    case "columns": return clamp(horizontal * 0.9 + random * 0.1);
  }
}
