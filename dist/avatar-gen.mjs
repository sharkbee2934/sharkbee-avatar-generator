// molanko-avatar-generator/src/main.js
// Fixed build — fixes:
// 1. outlineType ("none"/"solid"/"glow"/"pulse") now properly mapped to outline rendering
// 2. bgType ("none"/"solid"/"gradient"/"blur"/"noise") fully implemented
// 3. outlineColor2 used for glow/pulse; bgColor2 used for gradient
// 4. Added: applyGlow, applyNoiseBackground, applyOutlineWithColor

function get2dContext(canvas, options = {}) {
  const ctxOptions = { willReadFrequently: !!options.willReadFrequently, ...options };
  if (ctxOptions.colorSpace === void 0) ctxOptions.colorSpace = "srgb";
  const ctx = canvas.getContext("2d", options);
  if (!ctx) throw new Error("Failed to get 2d context");
  ctx.imageSmoothingEnabled = false;
  if ("mozImageSmoothingEnabled" in ctx) ctx.mozImageSmoothingEnabled = false;
  if ("webkitImageSmoothingEnabled" in ctx) ctx.webkitImageSmoothingEnabled = false;
  if ("patternQuality" in ctx) ctx.patternQuality = "nearest";
  if ("imageSmoothingQuality" in ctx) ctx.imageSmoothingQuality = "low";
  return ctx;
}

function createBrowserCanvas(width, height) {
  if (typeof document === "undefined") {
    throw new Error("createBrowserCanvas only works in browser. Node.js pass options.createCanvas");
  }
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(width));
  canvas.height = Math.max(1, Math.floor(height));
  return canvas;
}

function getSourceImageData(srcImg, sx, sy, sw, sh, createCanvas) {
  if (srcImg.getContext && sx === 0 && sy === 0 && sw === srcImg.width && sh === srcImg.height) {
    return get2dContext(srcImg, { willReadFrequently: true }).getImageData(0, 0, sw, sh);
  }
  const temp = createCanvas(sw, sh);
  const tctx = get2dContext(temp, { willReadFrequently: true });
  tctx.drawImage(srcImg, sx, sy, sw, sh, 0, 0, sw, sh);
  return tctx.getImageData(0, 0, sw, sh);
}

function drawNearestNeighbor(destCtx, srcData, srcW, srcH, dx, dy, dw, dh, overlayAlpha = 0) {
  const destW = destCtx.canvas.width, destH = destCtx.canvas.height;
  const x0 = Math.max(0, Math.floor(dx)), y0 = Math.max(0, Math.floor(dy));
  const x1 = Math.min(destW, Math.ceil(dx + dw)), y1 = Math.min(destH, Math.ceil(dy + dh));
  if (x0 >= x1 || y0 >= y1) return;
  const destImgData = destCtx.getImageData(x0, y0, x1 - x0, y1 - y0);
  const destPixels = destImgData.data, srcPixels = srcData.data;
  const scaleX = srcW / dw, scaleY = srcH / dh;
  const hasOverlay = overlayAlpha > 0, invAlpha = hasOverlay ? 1 - overlayAlpha : 1;
  for (let py = y0; py < y1; py++) {
    const srcY = Math.floor((py - dy + 0.5) * scaleY), srcRow = srcY * srcW;
    for (let px = x0; px < x1; px++) {
      const srcX = Math.floor((px - dx + 0.5) * scaleX);
      const si = (srcRow + srcX) * 4;
      const di = ((py - y0) * (x1 - x0) + (px - x0)) * 4;
      let r = srcPixels[si], g = srcPixels[si + 1], b = srcPixels[si + 2];
      const a = srcPixels[si + 3];
      if (a === 0) continue;
      if (hasOverlay) { r = Math.round(r * invAlpha); g = Math.round(g * invAlpha); b = Math.round(b * invAlpha); }
      destPixels[di] = r; destPixels[di + 1] = g; destPixels[di + 2] = b; destPixels[di + 3] = a;
    }
  }
  destCtx.putImageData(destImgData, x0, y0);
}

function drawStretch(ctx, srcImg, sx, sy, sw, sh, dx, dy, dw, dh, overlayAlpha, createCanvas) {
  ctx.imageSmoothingEnabled = false;
  if ("patternQuality" in ctx) ctx.patternQuality = "nearest";
  if (sw === dw && sh === dh && overlayAlpha <= 0) { ctx.drawImage(srcImg, sx, sy, sw, sh, dx, dy, dw, dh); return; }
  const srcData = getSourceImageData(srcImg, sx, sy, sw, sh, createCanvas);
  drawNearestNeighbor(ctx, srcData, sw, sh, dx, dy, dw, dh, overlayAlpha);
}

function createBaseTexture(sourceImage, createCanvas, applySideShade = true) {
  const canvas = createCanvas(32, 32);
  const ctx = get2dContext(canvas, { willReadFrequently: true });
  const alpha = applySideShade ? 76 / 255 : 0;
  drawStretch(ctx, sourceImage, 56, 8, 8, 8, 10, 7, 18, 18, 0, createCanvas);
  drawStretch(ctx, sourceImage, 48, 8, 8, 8, 4, 7, 6, 18, alpha, createCanvas);
  drawStretch(ctx, sourceImage, 24, 8, 8, 8, 11, 8, 16, 16, 0, createCanvas);
  drawStretch(ctx, sourceImage, 16, 8, 8, 8, 5, 8, 6, 16, alpha, createCanvas);
  const flipped = createCanvas(32, 32);
  const fctx = get2dContext(flipped, { willReadFrequently: true });
  const srcData = ctx.getImageData(0, 0, 32, 32);
  const dstData = fctx.createImageData(32, 32);
  const src = srcData.data, dst = dstData.data;
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const si = (y * 32 + x) * 4, di = (y * 32 + (31 - x)) * 4;
      dst[di] = src[si]; dst[di + 1] = src[si + 1]; dst[di + 2] = src[si + 2]; dst[di + 3] = src[si + 3];
    }
  }
  fctx.putImageData(dstData, 0, 0);
  drawStretch(fctx, sourceImage, 8, 8, 8, 8, 11, 8, 16, 16, 0, createCanvas);
  drawStretch(fctx, sourceImage, 0, 8, 8, 8, 5, 8, 6, 16, alpha, createCanvas);
  drawStretch(fctx, sourceImage, 40, 8, 8, 8, 10, 7, 18, 18, 0, createCanvas);
  drawStretch(fctx, sourceImage, 32, 8, 8, 8, 4, 7, 6, 18, alpha, createCanvas);
  return flipped;
}

function getAverageColor(canvas) {
  const ctx = get2dContext(canvas, { willReadFrequently: true });
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let r = 0, g = 0, b = 0, count = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] > 0) { r += data[i]; g += data[i + 1]; b += data[i + 2]; count++; }
  }
  if (count === 0) return { r: 128, g: 128, b: 128 };
  return { r: Math.round(r / count), g: Math.round(g / count), b: Math.round(b / count) };
}

var outlineGenerators = {
  auto: (avg) => ({
    r: Math.min(80, Math.round(avg.r * 0.25)),
    g: Math.min(80, Math.round(avg.g * 0.25)),
    b: Math.min(80, Math.round(avg.b * 0.25))
  }),
  auto_darker: (avg) => ({
    r: Math.min(50, Math.round(avg.r * 0.15)),
    g: Math.min(50, Math.round(avg.g * 0.15)),
    b: Math.min(50, Math.round(avg.b * 0.15))
  }),
  auto_lighter: (avg) => ({
    r: Math.min(120, Math.round(avg.r * 0.4)),
    g: Math.min(120, Math.round(avg.g * 0.4)),
    b: Math.min(120, Math.round(avg.b * 0.4))
  })
};

var bgGenerators = {
  auto: (avg) => ({
    r: Math.min(230, Math.round(avg.r * 1.2 + 10)),
    g: Math.min(230, Math.round(avg.g * 1.2 + 10)),
    b: Math.min(230, Math.round(avg.b * 1.2 + 10))
  }),
  auto_lighter: (avg) => ({
    r: Math.min(250, Math.round(avg.r * 1.5 + 30)),
    g: Math.min(250, Math.round(avg.g * 1.5 + 30)),
    b: Math.min(250, Math.round(avg.b * 1.5 + 30))
  }),
  auto_darker: (avg) => ({
    r: Math.min(200, Math.round(avg.r * 0.9 + 30)),
    g: Math.min(200, Math.round(avg.g * 0.9 + 30)),
    b: Math.min(200, Math.round(avg.g * 0.9 + 30))
  })
};

function rgbToHex(r, g, b) {
  return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
}

function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [0, 0, 0];
}

function resolveOutlineColor(presetOrHex, avg) {
  if (typeof presetOrHex === "string" && presetOrHex.startsWith("auto")) {
    const gen = outlineGenerators[presetOrHex];
    return gen ? rgbToHex(gen(avg).r, gen(avg).g, gen(avg).b) : "#000000";
  }
  return presetOrHex || "#000000";
}

function resolveBgColor(presetOrHex, avg) {
  if (typeof presetOrHex === "string" && presetOrHex.startsWith("auto")) {
    const gen = bgGenerators[presetOrHex];
    return gen ? rgbToHex(gen(avg).r, gen(avg).g, gen(avg).b) : "#ffffff";
  }
  return presetOrHex || "#ffffff";
}

// --- Outline helpers ---

function _buildSolidSet(contentCanvas, offsetX, offsetY) {
  const srcCtx = get2dContext(contentCanvas, { willReadFrequently: true });
  const srcData = srcCtx.getImageData(0, 0, contentCanvas.width, contentCanvas.height).data;
  const cw = contentCanvas.width, ch = contentCanvas.height;
  const solidSet = /* @__PURE__ */ new Set();
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      if (srcData[(y * cw + x) * 4 + 3] > 0) solidSet.add((y + offsetY) * 0 + (x + offsetX)); // placeholder
    }
  }
  return solidSet;
}

function applyOutline(destCtx, contentCanvas, offsetX, offsetY, outlineRadius, outlineColorHex) {
  const dw = destCtx.canvas.width, dh = destCtx.canvas.height;
  const imgData = destCtx.getImageData(0, 0, dw, dh);
  const pixels = imgData.data;
  const solidSet = /* @__PURE__ */ new Set();
  const srcCtx = get2dContext(contentCanvas, { willReadFrequently: true });
  const srcData = srcCtx.getImageData(0, 0, contentCanvas.width, contentCanvas.height).data;
  const cw = contentCanvas.width, ch = contentCanvas.height;
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      if (srcData[(y * cw + x) * 4 + 3] > 0) {
        const gx = x + offsetX, gy = y + offsetY;
        if (gx >= 0 && gx < dw && gy >= 0 && gy < dh) solidSet.add(gy * dw + gx);
      }
    }
  }
  const outlineSet = /* @__PURE__ */ new Set();
  const minX = Math.max(0, offsetX - outlineRadius), maxX = Math.min(dw - 1, offsetX + cw - 1 + outlineRadius);
  const minY = Math.max(0, offsetY - outlineRadius), maxY = Math.min(dh - 1, offsetY + ch - 1 + outlineRadius);
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const idx = y * dw + x;
      if (solidSet.has(idx)) continue;
      let found = false;
      for (let dy = -outlineRadius; dy <= outlineRadius && !found; dy++) {
        for (let dx = -outlineRadius; dx <= outlineRadius; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || nx >= dw || ny < 0 || ny >= dh) continue;
          if (solidSet.has(ny * dw + nx)) { found = true; break; }
        }
      }
      if (found) outlineSet.add(idx);
    }
  }
  const [r, g, b] = hexToRgb(outlineColorHex);
  for (const idx of outlineSet) {
    const pi = idx * 4;
    pixels[pi] = r; pixels[pi + 1] = g; pixels[pi + 2] = b; pixels[pi + 3] = 255;
  }
  destCtx.putImageData(imgData, 0, 0);
}

// Glow: layered outline rings fading outward
function applyGlow(destCtx, contentCanvas, offsetX, offsetY, outlineRadius, outlineColorHex, outlineColor2Hex) {
  const [r1, g1, b1] = hexToRgb(outlineColorHex);
  const [r2, g2, b2] = hexToRgb(outlineColor2Hex || "#ffffff");
  // Build solid set once
  const dw = destCtx.canvas.width, dh = destCtx.canvas.height;
  const imgData = destCtx.getImageData(0, 0, dw, dh);
  const pixels = imgData.data;
  const solidSet = /* @__PURE__ */ new Set();
  const srcCtx = get2dContext(contentCanvas, { willReadFrequently: true });
  const srcData = srcCtx.getImageData(0, 0, contentCanvas.width, contentCanvas.height).data;
  const cw = contentCanvas.width, ch = contentCanvas.height;
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      if (srcData[(y * cw + x) * 4 + 3] > 0) {
        const gx = x + offsetX, gy = y + offsetY;
        if (gx >= 0 && gx < dw && gy >= 0 && gy < dh) solidSet.add(gy * dw + gx);
      }
    }
  }
  // Draw glow layers from outside in
  for (let layer = outlineRadius; layer >= 1; layer--) {
    const t = layer / outlineRadius;
    const r = Math.round(r1 + (r2 - r1) * t);
    const g = Math.round(g1 + (g2 - g1) * t);
    const b = Math.round(b1 + (b2 - b1) * t);
    const alpha = Math.round(60 + 140 * (1 - t));
    const minX = Math.max(0, offsetX - layer), maxX = Math.min(dw - 1, offsetX + cw - 1 + layer);
    const minY = Math.max(0, offsetY - layer), maxY = Math.min(dh - 1, offsetY + ch - 1 + layer);
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const idx = y * dw + x;
        if (solidSet.has(idx)) continue;
        let found = false;
        for (let dy = -layer; dy <= layer && !found; dy++) {
          for (let dx = -layer; dx <= layer; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || nx >= dw || ny < 0 || ny >= dh) continue;
            if (solidSet.has(ny * dw + nx)) { found = true; break; }
          }
        }
        if (found) {
          const pi = idx * 4;
          const existingAlpha = pixels[pi + 3] / 255;
          const newAlpha = alpha / 255;
          const outAlpha = Math.min(1, existingAlpha + newAlpha * (1 - existingAlpha));
          if (outAlpha > 0) {
            pixels[pi] = Math.round((r * newAlpha + pixels[pi] * existingAlpha * (1 - newAlpha)) / outAlpha);
            pixels[pi + 1] = Math.round((g * newAlpha + pixels[pi + 1] * existingAlpha * (1 - newAlpha)) / outAlpha);
            pixels[pi + 2] = Math.round((b * newAlpha + pixels[pi + 2] * existingAlpha * (1 - newAlpha)) / outAlpha);
            pixels[pi + 3] = Math.round(outAlpha * 255);
          }
        }
      }
    }
  }
  destCtx.putImageData(imgData, 0, 0);
}

// Noise background
function applyNoiseBackground(ctx, width, height, baseColorHex) {
  const base = hexToRgb(baseColorHex);
  const data = ctx.getImageData(0, 0, width, height);
  const pixels = data.data;
  let seed = (width * 7 + height * 13 + 12345) | 0;
  const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let i = 0; i < pixels.length; i += 4) {
    const t = rand() * 0.35 - 0.175;
    pixels[i] = Math.max(0, Math.min(255, Math.round(base[0] * (1 + t))));
    pixels[i + 1] = Math.max(0, Math.min(255, Math.round(base[1] * (1 + t))));
    pixels[i + 2] = Math.max(0, Math.min(255, Math.round(base[2] * (1 + t))));
    pixels[i + 3] = 255;
  }
  ctx.putImageData(data, 0, 0);
}

function buildFinalCanvas(base32Canvas, options, createCanvas, customAvg = null) {
  const {
    outlineType = "none",
    outlineColor = "#000000",
    outlineColor2 = "#ffffff",
    outlineWidth = 2,
    bgType = "solid",
    bgColor = "#ffffff",
    bgColor2 = "#16213e",
    upscale48 = false,
    fillBackground = true
  } = options;

  const avg = customAvg || getAverageColor(base32Canvas);
  const finalOutlineColor = resolveOutlineColor(outlineColor, avg);
  const finalBgColor = resolveBgColor(bgColor, avg);
  const finalBgColor2 = resolveBgColor(bgColor2, avg);

  let finalWidth, finalHeight, offsetX, offsetY;
  if (upscale48) { finalWidth = 48; finalHeight = 48; offsetX = 8; offsetY = 8; }
  else { finalWidth = 32; finalHeight = 32; offsetX = 0; offsetY = 0; }

  const canvas = createCanvas(finalWidth, finalHeight);
  const ctx = get2dContext(canvas, { willReadFrequently: true });

  // --- Background ---
  if (fillBackground) {
    if (bgType === "solid") {
      ctx.fillStyle = finalBgColor;
      ctx.fillRect(0, 0, finalWidth, finalHeight);
    } else if (bgType === "gradient") {
      const grad = ctx.createLinearGradient(0, 0, finalWidth, finalHeight);
      grad.addColorStop(0, finalBgColor);
      grad.addColorStop(1, finalBgColor2);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, finalWidth, finalHeight);
    } else if (bgType === "blur") {
      ctx.fillStyle = finalBgColor;
      ctx.fillRect(0, 0, finalWidth, finalHeight);
      const grad = ctx.createRadialGradient(
        finalWidth / 2, finalHeight / 2, 0,
        finalWidth / 2, finalHeight / 2, finalWidth * 0.7
      );
      grad.addColorStop(0, "rgba(255,255,255,0.1)");
      grad.addColorStop(1, "rgba(0,0,0,0.2)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, finalWidth, finalHeight);
    } else if (bgType === "noise") {
      ctx.fillStyle = finalBgColor;
      ctx.fillRect(0, 0, finalWidth, finalHeight);
      applyNoiseBackground(ctx, finalWidth, finalHeight, finalBgColor);
    }
    // "none" → no fill (transparent)
  }
  // If fillBackground=false, leave canvas transparent

  // --- Draw base texture ---
  ctx.drawImage(base32Canvas, offsetX, offsetY);

  // --- Outline ---
  const outlineRadius = Math.max(1, Math.min(8, parseInt(outlineWidth) || 2));

  if (outlineType === "glow" && outlineRadius > 0) {
    applyGlow(ctx, base32Canvas, offsetX, offsetY, outlineRadius, finalOutlineColor, outlineColor2);
  } else if (outlineType === "pulse" && outlineRadius > 0) {
    applyOutline(ctx, base32Canvas, offsetX, offsetY, outlineRadius, finalOutlineColor);
    applyGlow(ctx, base32Canvas, offsetX, offsetY, outlineRadius, finalOutlineColor, outlineColor2);
  } else if (outlineType === "solid" && outlineRadius > 0) {
    applyOutline(ctx, base32Canvas, offsetX, offsetY, outlineRadius, finalOutlineColor);
  }
  // "none" → no outline

  return canvas;
}

function applyScale(sourceCanvas, scale, createCanvas) {
  if (scale <= 1) return sourceCanvas;
  const sw = sourceCanvas.width, sh = sourceCanvas.height;
  const dw = Math.round(sw * scale), dh = Math.round(sh * scale);
  const scaled = createCanvas(dw, dh);
  const sctx = get2dContext(scaled, { willReadFrequently: true });
  const srcData = get2dContext(sourceCanvas, { willReadFrequently: true }).getImageData(0, 0, sw, sh);
  drawNearestNeighbor(sctx, srcData, sw, sh, 0, 0, dw, dh, 0);
  return scaled;
}

function processTexture(sourceImage, options = {}) {
  let createCanvas = options.createCanvas;
  if (typeof createCanvas !== "function") {
    if (typeof document !== "undefined") createCanvas = createBrowserCanvas;
    else throw new Error("options.createCanvas is required in Node.js");
  }
  if (!sourceImage || typeof sourceImage.width !== "number") {
    throw new Error("sourceImage must be a valid Image/Canvas object");
  }
  if (sourceImage.width <= 31 || sourceImage.height <= 15) {
    throw new Error(`Image too small! Current: ${sourceImage.width}×${sourceImage.height}, need at least 64×64`);
  }

  let headAvgColor = options.averageColor;
  if (!headAvgColor) {
    const colorBase32 = createBaseTexture(sourceImage, createCanvas, false);
    headAvgColor = getAverageColor(colorBase32);
  }

  const base32 = createBaseTexture(sourceImage, createCanvas);
  const finalBase = buildFinalCanvas(base32, options, createCanvas, headAvgColor);
  const scale = options.scale || 1;
  return applyScale(finalBase, scale, createCanvas);
}

if (typeof window !== "undefined") {
  window.TextureProcessor = {
    processTexture, createBaseTexture, buildFinalCanvas, applyScale,
    getAverageColor, outlineGenerators, bgGenerators,
    resolveOutlineColor, resolveBgColor, createBrowserCanvas,
    get2dContext, drawNearestNeighbor, getSourceImageData
  };
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    processTexture, createBaseTexture, buildFinalCanvas, applyScale,
    getAverageColor, outlineGenerators, bgGenerators,
    resolveOutlineColor, resolveBgColor, createBrowserCanvas,
    get2dContext, drawNearestNeighbor, getSourceImageData
  };
}

export {
  applyScale, bgGenerators, buildFinalCanvas, createBaseTexture,
  createBrowserCanvas, drawNearestNeighbor, get2dContext,
  getAverageColor, getSourceImageData, outlineGenerators,
  processTexture, resolveBgColor, resolveOutlineColor
};