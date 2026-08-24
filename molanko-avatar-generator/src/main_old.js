/**
 * main.js  （已修复 Illegal constructor）
 * 纯逻辑，无 DOM / 无 Node 特有 API
 */

function drawStretch(ctx, srcImg, sx, sy, sw, sh, dx, dy, dw, dh, overlayAlpha, createCanvas) {
  ctx.imageSmoothingEnabled = false;
  if (overlayAlpha <= 0) {
    ctx.drawImage(srcImg, sx, sy, sw, sh, dx, dy, dw, dh);
  } else {
    // 始终使用注入的 createCanvas，避免 Illegal constructor
    const temp = createCanvas(dw, dh);
    const tctx = temp.getContext('2d');
    tctx.imageSmoothingEnabled = false;
    tctx.drawImage(srcImg, sx, sy, sw, sh, 0, 0, dw, dh);
    tctx.globalCompositeOperation = 'source-atop';
    tctx.fillStyle = `rgba(0,0,0,${overlayAlpha})`;
    tctx.fillRect(0, 0, dw, dh);
    tctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(temp, dx, dy);
  }
}

/**
 * 从 64×64（或更大）皮肤生成 32×32 基础纹理
 */
function createBaseTexture(sourceImage, createCanvas) {
  const canvas = createCanvas(32, 32);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const alpha = 76 / 255;

  drawStretch(ctx, sourceImage, 56, 8, 8, 8, 10, 7, 18, 18, 0, createCanvas);
  drawStretch(ctx, sourceImage, 48, 8, 8, 8, 4, 7, 6, 18, alpha, createCanvas);
  drawStretch(ctx, sourceImage, 24, 8, 8, 8, 11, 8, 16, 16, 0, createCanvas);
  drawStretch(ctx, sourceImage, 16, 8, 8, 8, 5, 8, 6, 16, alpha, createCanvas);

  const flipped = createCanvas(32, 32);
  const fctx = flipped.getContext('2d');
  fctx.imageSmoothingEnabled = false;
  fctx.translate(32, 0);
  fctx.scale(-1, 1);
  fctx.drawImage(canvas, 0, 0);
  fctx.setTransform(1, 0, 0, 1, 0, 0);

  drawStretch(fctx, sourceImage, 8, 8, 8, 8, 11, 8, 16, 16, 0, createCanvas);
  drawStretch(fctx, sourceImage, 0, 8, 8, 8, 5, 8, 6, 16, alpha, createCanvas);
  drawStretch(fctx, sourceImage, 40, 8, 8, 8, 10, 7, 18, 18, 0, createCanvas);
  drawStretch(fctx, sourceImage, 32, 8, 8, 8, 4, 7, 6, 18, alpha, createCanvas);

  return flipped;
}

function getAverageColor(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let r = 0, g = 0, b = 0, count = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] > 0) {
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
      count++;
    }
  }
  if (count === 0) return { r: 128, g: 128, b: 128 };
  return {
    r: Math.round(r / count),
    g: Math.round(g / count),
    b: Math.round(b / count)
  };
}

const outlineGenerators = {
  auto_dark: (avg) => ({
    r: Math.min(80, Math.round(avg.r * 0.25)),
    g: Math.min(80, Math.round(avg.g * 0.25)),
    b: Math.min(80, Math.round(avg.b * 0.25))
  }),
  auto_darker: (avg) => ({
    r: Math.min(50, Math.round(avg.r * 0.15)),
    g: Math.min(50, Math.round(avg.g * 0.15)),
    b: Math.min(50, Math.round(avg.b * 0.15))
  }),
  auto_medium_dark: (avg) => ({
    r: Math.min(120, Math.round(avg.r * 0.4)),
    g: Math.min(120, Math.round(avg.g * 0.4)),
    b: Math.min(120, Math.round(avg.b * 0.4))
  })
};

const bgGenerators = {
  auto_light: (avg) => ({
    r: Math.min(230, Math.round(avg.r * 1.2 + 10)),
    g: Math.min(230, Math.round(avg.g * 1.2 + 10)),
    b: Math.min(230, Math.round(avg.b * 1.2 + 10))
  }),
  auto_lighter: (avg) => ({
    r: Math.min(250, Math.round(avg.r * 1.5 + 30)),
    g: Math.min(250, Math.round(avg.g * 1.5 + 30)),
    b: Math.min(250, Math.round(avg.b * 1.5 + 30))
  }),
  auto_medium_light: (avg) => ({
    r: Math.min(200, Math.round(avg.r * 0.9 + 30)),
    g: Math.min(200, Math.round(avg.g * 0.9 + 30)),
    b: Math.min(200, Math.round(avg.b * 0.9 + 30))
  })
};

function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return m
    ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)]
    : [0, 0, 0];
}

function resolveOutlineColor(presetOrHex, avg) {
  if (typeof presetOrHex === 'string' && presetOrHex.startsWith('auto_')) {
    const gen = outlineGenerators[presetOrHex];
    if (gen) {
      const c = gen(avg);
      return rgbToHex(c.r, c.g, c.b);
    }
    return '#000000';
  }
  return presetOrHex || '#000000';
}

function resolveBgColor(presetOrHex, avg) {
  if (typeof presetOrHex === 'string' && presetOrHex.startsWith('auto_')) {
    const gen = bgGenerators[presetOrHex];
    if (gen) {
      const c = gen(avg);
      return rgbToHex(c.r, c.g, c.b);
    }
    return '#ffffff';
  }
  return presetOrHex || '#ffffff';
}

function applyOutline(destCtx, contentCanvas, offsetX, offsetY, outlineRadius, outlineColorHex) {
  const dw = destCtx.canvas.width;
  const dh = destCtx.canvas.height;
  const imgData = destCtx.getImageData(0, 0, dw, dh);
  const pixels = imgData.data;

  const solidSet = new Set();
  const srcCtx = contentCanvas.getContext('2d', { willReadFrequently: true });
  const srcData = srcCtx.getImageData(0, 0, contentCanvas.width, contentCanvas.height).data;
  const cw = contentCanvas.width;
  const ch = contentCanvas.height;

  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      if (srcData[(y * cw + x) * 4 + 3] > 0) {
        const gx = x + offsetX;
        const gy = y + offsetY;
        if (gx >= 0 && gx < dw && gy >= 0 && gy < dh) {
          solidSet.add(gy * dw + gx);
        }
      }
    }
  }

  const outlineSet = new Set();
  const minX = Math.max(0, offsetX - outlineRadius);
  const maxX = Math.min(dw - 1, offsetX + cw - 1 + outlineRadius);
  const minY = Math.max(0, offsetY - outlineRadius);
  const maxY = Math.min(dh - 1, offsetY + ch - 1 + outlineRadius);

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const idx = y * dw + x;
      if (solidSet.has(idx)) continue;
      let found = false;
      for (let dy = -outlineRadius; dy <= outlineRadius && !found; dy++) {
        for (let dx = -outlineRadius; dx <= outlineRadius; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= dw || ny < 0 || ny >= dh) continue;
          if (solidSet.has(ny * dw + nx)) {
            found = true;
            break;
          }
        }
      }
      if (found) outlineSet.add(idx);
    }
  }

  const [r, g, b] = hexToRgb(outlineColorHex);
  for (const idx of outlineSet) {
    const pi = idx * 4;
    pixels[pi]     = r;
    pixels[pi + 1] = g;
    pixels[pi + 2] = b;
    pixels[pi + 3] = 255;
  }
  destCtx.putImageData(imgData, 0, 0);
}

function buildFinalCanvas(base32Canvas, options, createCanvas) {
  const {
    outlineMode = 0,
    outlineColor = '#000000',
    bgColor = '#ffffff',
    upscale48 = false,
    fillBackground = true
  } = options;

  const avg = getAverageColor(base32Canvas);
  const finalOutlineColor = resolveOutlineColor(outlineColor, avg);
  const finalBgColor = resolveBgColor(bgColor, avg);

  let finalWidth, finalHeight, offsetX, offsetY;
  if (upscale48) {
    finalWidth = 48;
    finalHeight = 48;
    offsetX = 8;
    offsetY = 8;
  } else {
    finalWidth = 32;
    finalHeight = 32;
    offsetX = 0;
    offsetY = 0;
  }

  const canvas = createCanvas(finalWidth, finalHeight);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = false;

  if (fillBackground) {
    ctx.fillStyle = finalBgColor;
    ctx.fillRect(0, 0, finalWidth, finalHeight);
  }

  ctx.drawImage(base32Canvas, offsetX, offsetY);

  if (outlineMode > 0) {
    applyOutline(ctx, base32Canvas, offsetX, offsetY, outlineMode, finalOutlineColor);
  }

  return canvas;
}

function applyScale(sourceCanvas, scale, createCanvas) {
  if (scale <= 1) return sourceCanvas;
  const scaled = createCanvas(
    sourceCanvas.width * scale,
    sourceCanvas.height * scale
  );
  const sctx = scaled.getContext('2d');
  sctx.imageSmoothingEnabled = false;
  sctx.drawImage(sourceCanvas, 0, 0, scaled.width, scaled.height);
  return scaled;
}

/**
 * 主入口
 */
function processTexture(sourceImage, options = {}) {
  const createCanvas = options.createCanvas;
  if (typeof createCanvas !== 'function') {
    throw new Error('options.createCanvas is required');
  }

  if (sourceImage.width <= 63 || sourceImage.height <= 31) {
    throw new Error(
      `图片尺寸不足！当前：${sourceImage.width}×${sourceImage.height}，至少需要 64×64`
    );
  }

  const base32 = createBaseTexture(sourceImage, createCanvas);
  const finalBase = buildFinalCanvas(base32, options, createCanvas);
  const scale = options.scale || 1;
  return applyScale(finalBase, scale, createCanvas);
}

// 导出
export {
    processTexture,
    createBaseTexture,
    buildFinalCanvas,
    applyScale,
    getAverageColor,
    outlineGenerators,
    bgGenerators,
    resolveOutlineColor,
    resolveBgColor
};


// 浏览器兼容旧调用方式
if (typeof window !== 'undefined') {
    window.TextureProcessor = {
        processTexture,
        createBaseTexture,
        buildFinalCanvas,
        applyScale,
        getAverageColor,
        outlineGenerators,
        bgGenerators,
        resolveOutlineColor,
        resolveBgColor
    };
}