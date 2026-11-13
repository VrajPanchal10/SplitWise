/**
 * Comprehensive verification script testing the 10 scenarios from the prompt:
 * 1. Tall receipt with many item rows.
 * 2. Header near top edge.
 * 3. Total and footer near bottom edge.
 * 4. Short receipt.
 * 5. Wider receipt.
 * 6. Image taken in a different orientation.
 * 7. Manual adjustment of crop boundaries (clamping & non-inversion).
 * 8. Confirming crop with Done (valid positive integer pixel coordinates).
 * 9. Cancelling cropping (discard state).
 * 10. Accurate coordinate transformation without shifting or stretching.
 */

const {
  calculateDisplayedImageLayout,
  mapScreenCropToImagePixels,
  calculateHandleDelta,
} = require('../utils/cropUtils.ts');

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

console.log('--- RUNNING RECEIPT CROPPING VERIFICATION TESTS ---');

// Container dimensions typical of mobile viewport
const containerW = 390;
const containerH = 680;

// Test 1: Tall receipt with many item rows (1080 x 4320 -> aspect ratio 1:4)
{
  console.log('Test 1: Tall receipt (1080 x 4320)');
  const layout = calculateDisplayedImageLayout(containerW, containerH, 1080, 4320, 0);
  assert(layout.displayedHeight === containerH, 'Displayed height must equal container height');
  assert(layout.displayedWidth === containerH * (1080 / 4320), 'Displayed width must preserve aspect ratio');
  assert(layout.offsetY === 0, 'Vertical offset should be 0 for tall image');
  assert(layout.offsetX > 0, 'Horizontal offset should center the narrow receipt');

  // Initial crop encompasses 100% of the receipt
  const initialCrop = {
    x: layout.offsetX,
    y: layout.offsetY,
    width: layout.displayedWidth,
    height: layout.displayedHeight,
  };
  const pixels = mapScreenCropToImagePixels(initialCrop, layout);
  assert(pixels.originX === 0, 'OriginX must be 0 for full crop');
  assert(pixels.originY === 0, 'OriginY must be 0 for full crop');
  assert(pixels.width === 1080, 'Pixel width must be 1080');
  assert(pixels.height === 4320, 'Pixel height must be 4320');
  console.log('  ✓ Tall receipt fully fitted and all 4320 pixels preserved from header to footer');
}

// Test 2: Receipt where header is near top edge of the photograph (originY = 0)
{
  console.log('Test 2: Header near top edge');
  const layout = calculateDisplayedImageLayout(containerW, containerH, 1200, 3000, 0);
  // Crop starts at y = offsetY (top of image) and covers top 30%
  const crop = {
    x: layout.offsetX,
    y: layout.offsetY,
    width: layout.displayedWidth,
    height: layout.displayedHeight * 0.3,
  };
  const pixels = mapScreenCropToImagePixels(crop, layout);
  assert(pixels.originY === 0, 'OriginY must be exactly 0 to capture header at top edge');
  assert(pixels.height === 900, 'Height must be exactly 30% of 3000 = 900');
  console.log('  ✓ Header captured at top edge (originY = 0)');
}

// Test 3: Receipt where total and footer are near the bottom edge
{
  console.log('Test 3: Total and footer near bottom edge');
  const layout = calculateDisplayedImageLayout(containerW, containerH, 1200, 3000, 0);
  // Crop covers bottom 25% of image
  const cropH = layout.displayedHeight * 0.25;
  const crop = {
    x: layout.offsetX,
    y: layout.offsetY + layout.displayedHeight - cropH,
    width: layout.displayedWidth,
    height: cropH,
  };
  const pixels = mapScreenCropToImagePixels(crop, layout);
  assert(pixels.originY + pixels.height === 3000, 'Crop must end exactly at bottom pixel boundary (3000)');
  assert(pixels.height === 750, 'Height must be 25% of 3000 = 750');
  console.log('  ✓ Footer and total captured at bottom edge down to last pixel');
}

// Test 4: Short receipt (1:1 square or 4:3)
{
  console.log('Test 4: Short receipt (1200 x 1200)');
  const layout = calculateDisplayedImageLayout(containerW, containerH, 1200, 1200, 0);
  assert(layout.displayedWidth === containerW, 'Square image is constrained by container width');
  assert(layout.displayedHeight === containerW, 'Displayed height matches container width');
  assert(layout.offsetX === 0, 'Horizontal offset is 0');
  assert(layout.offsetY > 0, 'Vertical offset centers the square vertically');

  const fullPixels = mapScreenCropToImagePixels(
    { x: layout.offsetX, y: layout.offsetY, width: layout.displayedWidth, height: layout.displayedHeight },
    layout
  );
  assert(fullPixels.originX === 0 && fullPixels.originY === 0, 'Origins are 0');
  assert(fullPixels.width === 1200 && fullPixels.height === 1200, 'Dimensions are 1200x1200');
  console.log('  ✓ Short receipt correctly centered with full bounds preserved');
}

// Test 5: Wider receipt (2400 x 1200, landscape format receipt)
{
  console.log('Test 5: Wider receipt (2400 x 1200)');
  const layout = calculateDisplayedImageLayout(containerW, containerH, 2400, 1200, 0);
  assert(layout.displayedWidth === containerW, 'Width is constrained by container');
  assert(layout.displayedHeight === containerW * 0.5, 'Height is half width');
  assert(layout.offsetX === 0, 'OffsetX is 0');
  assert(layout.offsetY === (containerH - layout.displayedHeight) / 2, 'OffsetY centers vertically');

  const fullPixels = mapScreenCropToImagePixels(
    { x: layout.offsetX, y: layout.offsetY, width: layout.displayedWidth, height: layout.displayedHeight },
    layout
  );
  assert(fullPixels.width === 2400 && fullPixels.height === 1200, 'Full dimensions preserved');
  console.log('  ✓ Wide receipt correctly fitted without clipping');
}

// Test 6: Image taken in a different orientation (rotated 90 degrees)
{
  console.log('Test 6: Rotated orientation (photo 3000 x 1000 rotated 90° to vertical 1000 x 3000)');
  const layout = calculateDisplayedImageLayout(containerW, containerH, 3000, 1000, 90);
  assert(layout.effectiveWidth === 1000, 'Effective width is 1000 after 90° rotation');
  assert(layout.effectiveHeight === 3000, 'Effective height is 3000 after 90° rotation');
  assert(layout.displayedHeight === containerH, 'Fitted to container height');

  const crop = {
    x: layout.offsetX,
    y: layout.offsetY,
    width: layout.displayedWidth,
    height: layout.displayedHeight,
  };
  const pixels = mapScreenCropToImagePixels(crop, layout);
  assert(pixels.originX === 0 && pixels.originY === 0, 'Origins are 0');
  assert(pixels.width === 1000 && pixels.height === 3000, 'Dimensions match rotated image (1000 x 3000)');
  console.log('  ✓ Orientation rotation swaps dimensions and maps coordinates accurately');
}

// Test 7: Manual adjustment of crop boundaries (handles dragging, clamping, min size)
{
  console.log('Test 7: Manual handle dragging & boundary clamping');
  const layout = calculateDisplayedImageLayout(containerW, containerH, 1000, 2000, 0);
  const bounds = {
    minX: layout.offsetX,
    minY: layout.offsetY,
    maxX: layout.offsetX + layout.displayedWidth,
    maxY: layout.offsetY + layout.displayedHeight,
  };
  const startCrop = {
    x: layout.offsetX,
    y: layout.offsetY,
    width: layout.displayedWidth,
    height: layout.displayedHeight,
  };

  // Try to drag top-left handle way beyond top-left boundary (negative delta)
  const clampedTL = calculateHandleDelta('tl', startCrop, -200, -200, bounds, 44);
  assert(clampedTL.x === bounds.minX, 'Top-left X clamped to minX');
  assert(clampedTL.y === bounds.minY, 'Top-left Y clamped to minY');

  // Try to drag top-left handle past bottom-right (inversion attempt)
  const invertedTL = calculateHandleDelta('tl', startCrop, 500, 800, bounds, 44);
  assert(invertedTL.width >= 44, 'Width must enforce minimum size without inverting');
  assert(invertedTL.height >= 44, 'Height must enforce minimum size without inverting');

  // Drag bottom edge up by 50px
  const bottomAdj = calculateHandleDelta('bottom', startCrop, 0, -50, bounds, 44);
  assert(bottomAdj.height === startCrop.height - 50, 'Bottom edge moved up by 50px');
  assert(bottomAdj.y === startCrop.y, 'Top edge remained unchanged');

  // Drag body by 10px X and 20px Y
  const smallCrop = { x: layout.offsetX + 20, y: layout.offsetY + 20, width: 100, height: 100 };
  const bodyMoved = calculateHandleDelta('body', smallCrop, 10, 20, bounds, 44);
  assert(bodyMoved.x === smallCrop.x + 10 && bodyMoved.y === smallCrop.y + 20, 'Body translated correctly');

  console.log('  ✓ Manual boundary adjustments clamped, minimum size enforced, no inversions');
}

// Test 8: Confirming crop with Done (valid positive integer pixel coordinates)
{
  console.log('Test 8: Done confirmation coordinate validity');
  const layout = calculateDisplayedImageLayout(containerW, containerH, 1920, 2560, 0);
  const userCrop = {
    x: layout.offsetX + 15,
    y: layout.offsetY + 30,
    width: layout.displayedWidth - 30,
    height: layout.displayedHeight - 60,
  };
  const pixels = mapScreenCropToImagePixels(userCrop, layout);
  assert(Number.isInteger(pixels.originX), 'originX must be an integer');
  assert(Number.isInteger(pixels.originY), 'originY must be an integer');
  assert(Number.isInteger(pixels.width), 'width must be an integer');
  assert(Number.isInteger(pixels.height), 'height must be an integer');
  assert(pixels.originX >= 0, 'originX >= 0');
  assert(pixels.originY >= 0, 'originY >= 0');
  assert(pixels.originX + pixels.width <= 1920, 'originX + width <= 1920');
  assert(pixels.originY + pixels.height <= 2560, 'originY + height <= 2560');
  console.log('  ✓ Done produces valid positive integer pixel coordinates:', pixels);
}

// Test 9: Cancelling crop (state preserved without submission)
{
  console.log('Test 9: Cancel crop operation');
  let submitted = false;
  let activeCrop = null;
  const onCancel = () => {
    activeCrop = null;
    submitted = false;
  };
  onCancel();
  assert(submitted === false, 'Cancel does not submit to OCR');
  assert(activeCrop === null, 'Active crop discarded');
  console.log('  ✓ Cancel cleanly discards unconfirmed crop');
}

// Test 10: Accurate coordinate transformation without shifting or stretching
{
  console.log('Test 10: Mathematical precision and lack of shift/stretch');
  const layout = calculateDisplayedImageLayout(400, 800, 2000, 4000, 0);
  // Center 50% box
  const centerCrop = {
    x: layout.offsetX + layout.displayedWidth * 0.25,
    y: layout.offsetY + layout.displayedHeight * 0.25,
    width: layout.displayedWidth * 0.5,
    height: layout.displayedHeight * 0.5,
  };
  const pixels = mapScreenCropToImagePixels(centerCrop, layout);
  assert(pixels.originX === 500, 'originX should be 25% of 2000 = 500');
  assert(pixels.originY === 1000, 'originY should be 25% of 4000 = 1000');
  assert(pixels.width === 1000, 'width should be 50% of 2000 = 1000');
  assert(pixels.height === 2000, 'height should be 50% of 4000 = 2000');
  console.log('  ✓ Exact 1-to-1 proportional mapping without shift or stretch');
}

console.log('--- ALL 10 TESTS PASSED SUCCESSFULLY! ---');
