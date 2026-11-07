export type LocalCropBox = {
  left: number;
  right: number;
  bottom: number;
  top: number;
};

export type VisiblePageGeometry = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export function clampLocalCropBox(
  cropBox: LocalCropBox,
  pageWidth: number,
  pageHeight: number,
): LocalCropBox {
  return {
    left: Math.max(0, Math.min(pageWidth, cropBox.left)),
    right: Math.max(0, Math.min(pageWidth, cropBox.right)),
    bottom: Math.max(0, Math.min(pageHeight, cropBox.bottom)),
    top: Math.max(0, Math.min(pageHeight, cropBox.top)),
  };
}

export function isValidLocalCropBox(
  cropBox: LocalCropBox,
  pageWidth: number,
  pageHeight: number,
  minimumHeight = 1,
): boolean {
  return cropBox.left >= 0
    && cropBox.bottom >= 0
    && cropBox.right <= pageWidth
    && cropBox.top <= pageHeight
    && cropBox.right - cropBox.left > 1
    && cropBox.top - cropBox.bottom >= minimumHeight;
}

export function toPdfCropBox(cropBox: LocalCropBox, page: VisiblePageGeometry): LocalCropBox {
  const left = Math.max(page.x, Math.min(page.x + page.width, cropBox.left));
  const right = Math.max(left, Math.min(page.x + page.width, cropBox.right));
  const bottom = Math.max(page.y, Math.min(page.y + page.height, cropBox.bottom));
  const top = Math.max(bottom, Math.min(page.y + page.height, cropBox.top));
  return { left, right, bottom, top };
}
