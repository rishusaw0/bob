/**
 * Converts screenshot coordinates (pixels or 0..1000 normalized) into physical Win32 cursor coordinates,
 * compensating for DPI scale factors (125%, 150%, etc.) and thumbnail downscaling.
 */
function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

function mapCoordsToPhysical({
  x = 0,
  y = 0,
  coordSpace = 'pixels',
  screenshotMeta = null,
  primaryDisplay = null,
} = {}) {
  const numX = Number(x);
  const numY = Number(y);
  if (!Number.isFinite(numX) || !Number.isFinite(numY)) {
    return { x: 0, y: 0, mapped: false };
  }

  const scaleFactor = Number(primaryDisplay?.scaleFactor || screenshotMeta?.scaleFactor || 1);
  const logicalW = Number(primaryDisplay?.size?.width || screenshotMeta?.logicalWidth || 1920);
  const logicalH = Number(primaryDisplay?.size?.height || screenshotMeta?.logicalHeight || 1080);
  const boundsX = Number(primaryDisplay?.bounds?.x || 0);
  const boundsY = Number(primaryDisplay?.bounds?.y || 0);

  const physicalW = Number(screenshotMeta?.physicalWidth || Math.round(logicalW * scaleFactor));
  const physicalH = Number(screenshotMeta?.physicalHeight || Math.round(logicalH * scaleFactor));
  const originX = Math.round(boundsX * scaleFactor);
  const originY = Math.round(boundsY * scaleFactor);

  if (String(coordSpace).toLowerCase() === 'normalized_1000') {
    const px = originX + Math.round((clamp(numX, 0, 1000) / 1000) * physicalW);
    const py = originY + Math.round((clamp(numY, 0, 1000) / 1000) * physicalH);
    return {
      x: clamp(px, originX, originX + physicalW - 1),
      y: clamp(py, originY, originY + physicalH - 1),
      mapped: true,
      scaleFactor,
    };
  }

  if (screenshotMeta && screenshotMeta.imageWidth > 0 && screenshotMeta.imageHeight > 0) {
    const ratioX = physicalW / screenshotMeta.imageWidth;
    const ratioY = physicalH / screenshotMeta.imageHeight;
    const px = originX + Math.round(numX * ratioX);
    const py = originY + Math.round(numY * ratioY);
    return {
      x: clamp(px, originX, originX + physicalW - 1),
      y: clamp(py, originY, originY + physicalH - 1),
      mapped: true,
      scaleFactor,
    };
  }

  // Raw physical fallback
  return {
    x: Math.round(numX),
    y: Math.round(numY),
    mapped: false,
    scaleFactor,
  };
}

module.exports = {
  mapCoordsToPhysical,
};
