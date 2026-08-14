export type GridLayout = {
  cols: number;
  rows: number;
  pitch: number;
  offsetX: number;
  offsetY: number;
};

export function layoutGrid(width: number, height: number, columns: number): GridLayout {
  const cols = Math.max(6, Math.round(columns));
  const margin = 0.75;
  const pitch = width / (cols + margin * 2);
  const rows = Math.max(3, Math.floor((height - margin * 2 * pitch) / pitch));
  return {
    cols,
    rows,
    pitch,
    offsetX: (width - cols * pitch) / 2,
    offsetY: (height - rows * pitch) / 2,
  };
}

export function cellGeometry(solidity: number, texture: number, radius: number, stroke: number) {
  const clampedSolidity = Math.max(0, Math.min(1, solidity));
  const clampedTexture = Math.max(0, Math.min(1, texture));
  const carvedRadius = radius * (1 - clampedSolidity);
  const texturedRadius = Math.max(0, radius - stroke) * clampedTexture;
  return { outerRadius: radius, boreRadius: Math.max(carvedRadius, texturedRadius) };
}
