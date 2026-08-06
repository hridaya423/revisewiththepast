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
  const local = clampLocalCropBox(cropBox, page.width, page.height);
  return {
    left: page.x + local.left,
    right: page.x + local.right,
    bottom: page.y + local.bottom,
    top: page.y + local.top,
  };
}
