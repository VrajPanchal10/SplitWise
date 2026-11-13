/**
 * Utilities for receipt image cropping coordinate transformations and layout calculations.
 */

export interface DisplayedImageLayout {
  effectiveWidth: number;
  effectiveHeight: number;
  displayedWidth: number;
  displayedHeight: number;
  offsetX: number;
  offsetY: number;
  scale: number;
}

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PixelCrop {
  originX: number;
  originY: number;
  width: number;
  height: number;
}

export type HandleType =
  | 'tl'
  | 'tr'
  | 'bl'
  | 'br'
  | 'top'
  | 'bottom'
  | 'left'
  | 'right'
  | 'body';

/**
 * Calculates the displayed image rectangle within a container using 'contain' aspect ratio fitting,
 * accounting for 90-degree step rotations.
 */
export function calculateDisplayedImageLayout(
  containerWidth: number,
  containerHeight: number,
  imageWidth: number,
  imageHeight: number,
  rotation: number = 0
): DisplayedImageLayout {
  if (containerWidth <= 0 || containerHeight <= 0 || imageWidth <= 0 || imageHeight <= 0) {
    return {
      effectiveWidth: Math.max(1, imageWidth),
      effectiveHeight: Math.max(1, imageHeight),
      displayedWidth: Math.max(1, containerWidth),
      displayedHeight: Math.max(1, containerHeight),
      offsetX: 0,
      offsetY: 0,
      scale: 1,
    };
  }

  const isRotated90or270 = Math.abs(rotation % 180) === 90;
  const effectiveWidth = isRotated90or270 ? imageHeight : imageWidth;
  const effectiveHeight = isRotated90or270 ? imageWidth : imageHeight;

  const imageAspect = effectiveWidth / effectiveHeight;
  const containerAspect = containerWidth / containerHeight;

  let displayedWidth: number;
  let displayedHeight: number;
  let offsetX: number;
  let offsetY: number;

  if (imageAspect > containerAspect) {
    // Image is wider than container: constrained by container width
    displayedWidth = containerWidth;
    displayedHeight = containerWidth / imageAspect;
    offsetX = 0;
    offsetY = (containerHeight - displayedHeight) / 2;
  } else {
    // Image is taller than container: constrained by container height
    displayedHeight = containerHeight;
    displayedWidth = containerHeight * imageAspect;
    offsetX = (containerWidth - displayedWidth) / 2;
    offsetY = 0;
  }

  const scale = displayedWidth / effectiveWidth;

  return {
    effectiveWidth,
    effectiveHeight,
    displayedWidth,
    displayedHeight,
    offsetX,
    offsetY,
    scale,
  };
}

/**
 * Maps screen crop coordinates (relative to the container) to exact integer pixel coordinates
 * on the source (or rotated) image.
 */
export function mapScreenCropToImagePixels(
  cropRect: CropRect,
  layout: DisplayedImageLayout
): PixelCrop {
  const { offsetX, offsetY, displayedWidth, displayedHeight, effectiveWidth, effectiveHeight } =
    layout;

  if (displayedWidth <= 0 || displayedHeight <= 0) {
    return {
      originX: 0,
      originY: 0,
      width: Math.max(1, Math.round(effectiveWidth)),
      height: Math.max(1, Math.round(effectiveHeight)),
    };
  }

  // Clamp crop rectangle inside the displayed image bounds
  const clampedX = Math.max(offsetX, Math.min(offsetX + displayedWidth, cropRect.x));
  const clampedY = Math.max(offsetY, Math.min(offsetY + displayedHeight, cropRect.y));
  const maxAvailableW = offsetX + displayedWidth - clampedX;
  const maxAvailableH = offsetY + displayedHeight - clampedY;
  const clampedW = Math.max(1, Math.min(maxAvailableW, cropRect.width));
  const clampedH = Math.max(1, Math.min(maxAvailableH, cropRect.height));

  // Compute normalized coordinates [0..1]
  const relX = (clampedX - offsetX) / displayedWidth;
  const relY = (clampedY - offsetY) / displayedHeight;
  const relW = clampedW / displayedWidth;
  const relH = clampedH / displayedHeight;

  // Convert to image pixel coordinates
  let originX = Math.floor(relX * effectiveWidth);
  let originY = Math.floor(relY * effectiveHeight);
  let width = Math.round(relW * effectiveWidth);
  let height = Math.round(relH * effectiveHeight);

  // Guard against boundaries
  if (originX < 0) originX = 0;
  if (originY < 0) originY = 0;
  if (originX >= effectiveWidth) originX = Math.max(0, effectiveWidth - 1);
  if (originY >= effectiveHeight) originY = Math.max(0, effectiveHeight - 1);

  if (originX + width > effectiveWidth) {
    width = effectiveWidth - originX;
  }
  if (originY + height > effectiveHeight) {
    height = effectiveHeight - originY;
  }

  // Ensure width and height are at least 1 pixel
  width = Math.max(1, Math.min(effectiveWidth - originX, width));
  height = Math.max(1, Math.min(effectiveHeight - originY, height));

  return {
    originX,
    originY,
    width,
    height,
  };
}

/**
 * Calculates new crop rectangle when user drags a handle, ensuring strict containment
 * within the displayed image boundaries and enforcing minimum dimensions without inversion.
 */
export function calculateHandleDelta(
  handleType: HandleType,
  startCrop: CropRect,
  dx: number,
  dy: number,
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  minSize: number = 44
): CropRect {
  const { minX, minY, maxX, maxY } = bounds;
  let { x, y, width, height } = startCrop;

  switch (handleType) {
    case 'tl': {
      const targetX = Math.max(minX, Math.min(startCrop.x + startCrop.width - minSize, startCrop.x + dx));
      const targetY = Math.max(minY, Math.min(startCrop.y + startCrop.height - minSize, startCrop.y + dy));
      x = targetX;
      y = targetY;
      width = startCrop.x + startCrop.width - targetX;
      height = startCrop.y + startCrop.height - targetY;
      break;
    }
    case 'tr': {
      const targetY = Math.max(minY, Math.min(startCrop.y + startCrop.height - minSize, startCrop.y + dy));
      const targetW = Math.max(minSize, Math.min(maxX - startCrop.x, startCrop.width + dx));
      y = targetY;
      width = targetW;
      height = startCrop.y + startCrop.height - targetY;
      break;
    }
    case 'bl': {
      const targetX = Math.max(minX, Math.min(startCrop.x + startCrop.width - minSize, startCrop.x + dx));
      const targetH = Math.max(minSize, Math.min(maxY - startCrop.y, startCrop.height + dy));
      x = targetX;
      width = startCrop.x + startCrop.width - targetX;
      height = targetH;
      break;
    }
    case 'br': {
      width = Math.max(minSize, Math.min(maxX - startCrop.x, startCrop.width + dx));
      height = Math.max(minSize, Math.min(maxY - startCrop.y, startCrop.height + dy));
      break;
    }
    case 'top': {
      const targetY = Math.max(minY, Math.min(startCrop.y + startCrop.height - minSize, startCrop.y + dy));
      y = targetY;
      height = startCrop.y + startCrop.height - targetY;
      break;
    }
    case 'bottom': {
      height = Math.max(minSize, Math.min(maxY - startCrop.y, startCrop.height + dy));
      break;
    }
    case 'left': {
      const targetX = Math.max(minX, Math.min(startCrop.x + startCrop.width - minSize, startCrop.x + dx));
      x = targetX;
      width = startCrop.x + startCrop.width - targetX;
      break;
    }
    case 'right': {
      width = Math.max(minSize, Math.min(maxX - startCrop.x, startCrop.width + dx));
      break;
    }
    case 'body': {
      x = Math.max(minX, Math.min(maxX - startCrop.width, startCrop.x + dx));
      y = Math.max(minY, Math.min(maxY - startCrop.height, startCrop.y + dy));
      break;
    }
  }

  return { x, y, width, height };
}
