/**
 * main.js
 * 纯逻辑纹理处理，尽量在 Node.js (node-canvas / @napi-rs/canvas)
 * 与 Chromium / Firefox 浏览器之间保持一致的行为。
 *
 * 核心策略：
 *   - 所有需要缩放的绘制全部走手动最近邻采样（nearest-neighbor），
 *     彻底绕过各引擎对 imageSmoothingEnabled / patternQuality 的差异。
 *   - 无缩放的 1:1 绘制仍使用原生 drawImage（性能更好且结果一致）。
 *   - getContext 时统一关闭平滑并设置 node-canvas 的 patternQuality。
 *
 * 使用方式：
 *   - 浏览器：可直接使用默认 createCanvas，或自己传入
 *   - Node.js：必须传入 createCanvas（来自 'canvas' 或 '@napi-rs/canvas'）
 */

/**
 * 统一获取 2d context，并强制关闭图像平滑。
 * 兼容浏览器与 node-canvas 的差异。
 */
function get2dContext(canvas, options = {}) {
  // willReadFrequently 在浏览器有优化效果，node-canvas 会忽略
  // colorSpace: 'srgb' 尽量让颜色空间更一致（部分浏览器支持）
  const ctxOptions = {
    willReadFrequently: !!options.willReadFrequently,
    ...options
  };
  // 尝试强制 sRGB，减少跨浏览器颜色差异（不支持时会被忽略）
  if (ctxOptions.colorSpace === undefined) {
    ctxOptions.colorSpace = 'srgb';
  }

  const ctx = canvas.getContext('2d', ctxOptions);

  if (!ctx) {
    throw new Error('Failed to get 2d context');
  }

  // 强制像素艺术风格：关闭平滑
  ctx.imageSmoothingEnabled = false;

  // Firefox 旧前缀（防御性）
  if ('mozImageSmoothingEnabled' in ctx) {
    ctx.mozImageSmoothingEnabled = false;
  }
  if ('webkitImageSmoothingEnabled' in ctx) {
    ctx.webkitImageSmoothingEnabled = false;
  }

  // node-canvas 兼容：使用 nearest 过滤（最接近无平滑）
  if ('patternQuality' in ctx) {
    ctx.patternQuality = 'nearest';
  }
  // 部分实现支持 imageSmoothingQuality（Firefox 目前不支持）
  if ('imageSmoothingQuality' in ctx) {
    ctx.imageSmoothingQuality = 'low';
  }

  return ctx;
}

/**
 * 浏览器默认的 createCanvas 实现。
 * Node.js 环境请始终传入 options.createCanvas。
 */
function createBrowserCanvas(width, height) {
  if (typeof document === 'undefined') {
    throw new Error(
      'createBrowserCanvas 只能在浏览器环境使用。Node.js 请传入 options.createCanvas'
    );
  }
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(width));
  canvas.height = Math.max(1, Math.floor(height));
  return canvas;
}

/**
 * 把任意 Image / Canvas / ImageBitmap 转成可读取像素的 ImageData。
 * 使用临时 canvas + 1:1 drawImage，避免缩放插值差异。
 */
function getSourceImageData(srcImg, sx, sy, sw, sh, createCanvas) {
  // 已经是 Canvas 且正好取整块时，直接读
  if (srcImg.getContext && sx === 0 && sy === 0 &&
      sw === srcImg.width && sh === srcImg.height) {
    const ctx = get2dContext(srcImg, { willReadFrequently: true });
    return ctx.getImageData(0, 0, sw, sh);
  }

  // 否则先画到临时 canvas（1:1，无缩放）再读
  const temp = createCanvas(sw, sh);
  const tctx = get2dContext(temp, { willReadFrequently: true });
  tctx.drawImage(srcImg, sx, sy, sw, sh, 0, 0, sw, sh);
  return tctx.getImageData(0, 0, sw, sh);
}

/**
 * 手动最近邻缩放绘制。
 * 结果在 Chromium / Firefox / node-canvas 上完全一致。
 *
 * @param {CanvasRenderingContext2D} destCtx  目标 context
 * @param {ImageData} srcData                源像素
 * @param {number} srcW                      源宽
 * @param {number} srcH                      源高
 * @param {number} dx                        目标 x
 * @param {number} dy                        目标 y
 * @param {number} dw                        目标宽
 * @param {number} dh                        目标高
 * @param {number} [overlayAlpha=0]          叠加黑色遮罩 alpha（0~1）
 */
function drawNearestNeighbor(destCtx, srcData, srcW, srcH, dx, dy, dw, dh, overlayAlpha = 0) {
  const destW = destCtx.canvas.width;
  const destH = destCtx.canvas.height;

  // 目标区域裁剪到画布范围
  const x0 = Math.max(0, Math.floor(dx));
  const y0 = Math.max(0, Math.floor(dy));
  const x1 = Math.min(destW, Math.ceil(dx + dw));
  const y1 = Math.min(destH, Math.ceil(dy + dh));

  if (x0 >= x1 || y0 >= y1) return;

  const destImgData = destCtx.getImageData(x0, y0, x1 - x0, y1 - y0);
  const destPixels = destImgData.data;
  const srcPixels = srcData.data;

  const scaleX = srcW / dw;
  const scaleY = srcH / dh;

  const hasOverlay = overlayAlpha > 0;
  const invAlpha = hasOverlay ? (1 - overlayAlpha) : 1;

  for (let py = y0; py < y1; py++) {
    const srcY = Math.floor((py - dy + 0.5) * scaleY);
    const srcRow = srcY * srcW;

    for (let px = x0; px < x1; px++) {
      const srcX = Math.floor((px - dx + 0.5) * scaleX);
      const si = (srcRow + srcX) * 4;
      const di = ((py - y0) * (x1 - x0) + (px - x0)) * 4;

      let r = srcPixels[si];
      let g = srcPixels[si + 1];
      let b = srcPixels[si + 2];
      const a = srcPixels[si + 3];

      if (a === 0) {
        // 完全透明，跳过（保留目标原有像素）
        continue;
      }

      if (hasOverlay) {
        // 叠加半透明黑色：result = src * (1 - alpha)
        r = Math.round(r * invAlpha);
        g = Math.round(g * invAlpha);
        b = Math.round(b * invAlpha);
      }

      // 简单 source-over（假设目标背景已处理，或后续会被覆盖）
      // 这里直接写入，因为我们是在构建新内容
      destPixels[di]     = r;
      destPixels[di + 1] = g;
      destPixels[di + 2] = b;
      destPixels[di + 3] = a;
    }
  }

  destCtx.putImageData(destImgData, x0, y0);
}

/**
 * 拉伸绘制，可选叠加半透明黑色遮罩（用于皮肤侧面暗部）。
 * 始终使用手动最近邻，保证跨环境一致。
 */
function drawStretch(ctx, srcImg, sx, sy, sw, sh, dx, dy, dw, dh, overlayAlpha, createCanvas) {
  // 确保目标 context 也关闭平滑（防御）
  ctx.imageSmoothingEnabled = false;
  if ('patternQuality' in ctx) ctx.patternQuality = 'nearest';

  // 1:1 且无遮罩时走原生 drawImage，性能更好且结果一致
  if (sw === dw && sh === dh && overlayAlpha <= 0) {
    ctx.drawImage(srcImg, sx, sy, sw, sh, dx, dy, dw, dh);
    return;
  }

  // 取出源区域像素
  const srcData = getSourceImageData(srcImg, sx, sy, sw, sh, createCanvas);

  // 手动最近邻绘制
  drawNearestNeighbor(ctx, srcData, sw, sh, dx, dy, dw, dh, overlayAlpha);
}

/**
 * 从 64×64（或更大）皮肤生成 32×32 基础纹理
 * @param {boolean} [applySideShade=true] 是否对侧面部分叠加半透明黑色遮罩
 */
function createBaseTexture(sourceImage, createCanvas, applySideShade = true) {
  const canvas = createCanvas(32, 32);
  const ctx = get2dContext(canvas, { willReadFrequently: true });

  // 如果不需要侧面遮罩，则 alpha 设为 0；否则使用原来的 76/255
  const alpha = applySideShade ? 76 / 255 : 0;

  // 正面 / 侧面等部位
  drawStretch(ctx, sourceImage, 56, 8, 8, 8, 10, 7, 18, 18, 0, createCanvas);
  drawStretch(ctx, sourceImage, 48, 8, 8, 8, 4, 7, 6, 18, alpha, createCanvas);
  drawStretch(ctx, sourceImage, 24, 8, 8, 8, 11, 8, 16, 16, 0, createCanvas);
  drawStretch(ctx, sourceImage, 16, 8, 8, 8, 5, 8, 6, 16, alpha, createCanvas);

  // 水平翻转后再画另一侧
  // 使用像素级翻转，避免 transform + drawImage 在不同引擎上的细微差异
  const flipped = createCanvas(32, 32);
  const fctx = get2dContext(flipped, { willReadFrequently: true });

  const srcData = ctx.getImageData(0, 0, 32, 32);
  const dstData = fctx.createImageData(32, 32);
  const src = srcData.data;
  const dst = dstData.data;

  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const si = (y * 32 + x) * 4;
      const di = (y * 32 + (31 - x)) * 4;
      dst[di]     = src[si];
      dst[di + 1] = src[si + 1];
      dst[di + 2] = src[si + 2];
      dst[di + 3] = src[si + 3];
    }
  }
  fctx.putImageData(dstData, 0, 0);

  // 注意：翻转后的绘制也使用相同的 alpha（侧面遮罩）
  drawStretch(fctx, sourceImage, 8, 8, 8, 8, 11, 8, 16, 16, 0, createCanvas);
  drawStretch(fctx, sourceImage, 0, 8, 8, 8, 5, 8, 6, 16, alpha, createCanvas);
  drawStretch(fctx, sourceImage, 40, 8, 8, 8, 10, 7, 18, 18, 0, createCanvas);
  drawStretch(fctx, sourceImage, 32, 8, 8, 8, 4, 7, 6, 18, alpha, createCanvas);

  return flipped;
}

/**
 * 计算画布平均颜色（忽略透明像素）
 */
function getAverageColor(canvas) {
  const ctx = get2dContext(canvas, { willReadFrequently: true });
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

  if (count === 0) {
    return { r: 128, g: 128, b: 128 };
  }

  return {
    r: Math.round(r / count),
    g: Math.round(g / count),
    b: Math.round(b / count)
  };
}

const outlineGenerators = {
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

const bgGenerators = {
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
  if (typeof presetOrHex === 'string' && presetOrHex.startsWith('auto')) {
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
  if (typeof presetOrHex === 'string' && presetOrHex.startsWith('auto')) {
    const gen = bgGenerators[presetOrHex];
    if (gen) {
      const c = gen(avg);
      return rgbToHex(c.r, c.g, c.b);
    }
    return '#ffffff';
  }
  return presetOrHex || '#ffffff';
}

/**
 * 在目标画布上绘制轮廓（像素扩张法）
 */
function applyOutline(destCtx, contentCanvas, offsetX, offsetY, outlineRadius, outlineColorHex) {
  const dw = destCtx.canvas.width;
  const dh = destCtx.canvas.height;
  const imgData = destCtx.getImageData(0, 0, dw, dh);
  const pixels = imgData.data;

  const solidSet = new Set();
  const srcCtx = get2dContext(contentCanvas, { willReadFrequently: true });
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

/**
 * 构建最终画布（背景 + 内容 + 可选轮廓）
 */
function buildFinalCanvas(base32Canvas, options, createCanvas, customAvg = null) {
  const {
    outlineMode = 0,
    outlineColor = '#000000',
    bgColor = '#ffffff',
    upscale48 = false,
    fillBackground = true
  } = options;

  // 优先使用传入的 customAvg，如果没有才回退到 32x32
  const avg = customAvg || getAverageColor(base32Canvas);

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
  const ctx = get2dContext(canvas, { willReadFrequently: true });

  if (fillBackground) {
    ctx.fillStyle = finalBgColor;
    ctx.fillRect(0, 0, finalWidth, finalHeight);
  }

  // 1:1 绘制，原生 drawImage 在所有环境一致
  ctx.drawImage(base32Canvas, offsetX, offsetY);

  if (outlineMode > 0) {
    applyOutline(ctx, base32Canvas, offsetX, offsetY, outlineMode, finalOutlineColor);
  }

  return canvas;
}

/**
 * 最近邻放大（保持像素风格）
 * 使用手动实现，保证跨环境一致
 */
function applyScale(sourceCanvas, scale, createCanvas) {
  if (scale <= 1) return sourceCanvas;

  const sw = sourceCanvas.width;
  const sh = sourceCanvas.height;
  const dw = Math.round(sw * scale);
  const dh = Math.round(sh * scale);

  const scaled = createCanvas(dw, dh);
  const sctx = get2dContext(scaled, { willReadFrequently: true });

  // 手动最近邻
  const srcData = get2dContext(sourceCanvas, { willReadFrequently: true })
    .getImageData(0, 0, sw, sh);

  drawNearestNeighbor(sctx, srcData, sw, sh, 0, 0, dw, dh, 0);

  return scaled;
}

/**
 * 主入口
 * @param {HTMLImageElement|Image|Canvas} sourceImage  至少 64×64 的皮肤图
 * @param {Object} options
 * @param {Function} options.createCanvas  必须提供（浏览器可用 createBrowserCanvas）
 * @param {number} [options.outlineMode=0]
 * @param {string} [options.outlineColor='#000000']  支持 auto_dark / auto_darker 等
 * @param {string} [options.bgColor='#ffffff']       支持 auto_light 等
 * @param {boolean} [options.upscale48=false]
 * @param {boolean} [options.fillBackground=true]
 * @param {number} [options.scale=1]
 * @param {Object} [options.averageColor]           自定义平均色，格式 { r, g, b }，优先级高于自动计算
 */
function processTexture(sourceImage, options = {}) {
  let createCanvas = options.createCanvas;

  // 浏览器环境自动回退到默认实现
  if (typeof createCanvas !== 'function') {
    if (typeof document !== 'undefined') {
      createCanvas = createBrowserCanvas;
    } else {
      throw new Error(
        'options.createCanvas is required in Node.js. ' +
        'Example: const { createCanvas } = require("canvas");'
      );
    }
  }

  if (!sourceImage || typeof sourceImage.width !== 'number') {
    throw new Error('sourceImage 必须是有效的 Image / Canvas 对象');
  }

  if (sourceImage.width <= 31 || sourceImage.height <= 15) {
    throw new Error(
      `图片尺寸不足！当前：${sourceImage.width}×${sourceImage.height}，至少需要 64×64`
    );
  }

  // ---- 修改开始：优先使用用户传入的平均色 ----
  let headAvgColor = options.averageColor;

  // 如果用户没有提供，则从没有半透明黑色遮罩、没有背景、没有描边的 32×32 基础纹理中获取
  if (!headAvgColor) {
    const colorBase32 = createBaseTexture(sourceImage, createCanvas, false);
    headAvgColor = getAverageColor(colorBase32);
  }

  // 生成最终输出的基础纹理（保留侧面暗部遮罩）
  const base32 = createBaseTexture(sourceImage, createCanvas);

  // 将 headAvgColor 传入 buildFinalCanvas
  const finalBase = buildFinalCanvas(base32, options, createCanvas, headAvgColor);

  const scale = options.scale || 1;
  return applyScale(finalBase, scale, createCanvas);
}

// ========== 导出 ==========

export {
  processTexture,
  createBaseTexture,
  buildFinalCanvas,
  applyScale,
  getAverageColor,
  outlineGenerators,
  bgGenerators,
  resolveOutlineColor,
  resolveBgColor,
  createBrowserCanvas,
  get2dContext,
  drawNearestNeighbor,
  getSourceImageData
};

// 浏览器全局兼容（旧调用方式）
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
    resolveBgColor,
    createBrowserCanvas,
    get2dContext,
    drawNearestNeighbor,
    getSourceImageData
  };
}

// CommonJS 兼容（部分打包工具）
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    processTexture,
    createBaseTexture,
    buildFinalCanvas,
    applyScale,
    getAverageColor,
    outlineGenerators,
    bgGenerators,
    resolveOutlineColor,
    resolveBgColor,
    createBrowserCanvas,
    get2dContext,
    drawNearestNeighbor,
    getSourceImageData
  };
}