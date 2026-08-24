// MC Avatar Generator - Server
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { readFileSync } = require('fs');
const { createServer } = require('http');

const SRV_DIR = '/tmp/sharkbee-web';

// Load molanko-avatar-generator
let TP;
try {
  const mod = require('./molanko-avatar-generator/src/main.js');
  TP = mod;
} catch (e) {
  console.error('Failed to load avatar generator:', e.message);
  process.exit(1);
}

const PORT = 3847;
const server = createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, 'http://localhost:' + PORT);
  const pathname = url.pathname;

  if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
    try {
      const html = readFileSync(SRV_DIR + '/index.html', 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch (e) {
      res.writeHead(500);
      res.end('Error: ' + e.message);
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/generate') {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks);

      const contentType = req.headers['content-type'] || '';
      const bMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;\s]+))/);
      if (!bMatch) throw new Error('No boundary');
      const b = '--' + bMatch[1];

      const parts = parseMultipart(body, b);
      const filePart = parts.find(function(p) { return p.name === 'image'; });
      if (!filePart) throw new Error('No image');

      function getParam(name, def) {
        const p = parts.find(function(p2) { return p2.name === name; });
        return p ? p.value : def;
      }

      const img = await loadImage(filePart.data);
      const src = createCanvas(img.width, img.height);
      const ctx = src.getContext('2d');
      ctx.drawImage(img, 0, 0);

      const result = TP.processTexture(src, {
        createCanvas: createCanvas,
        scale: parseInt(getParam('scale', '4')),
        outlineType: getParam('outlineType', 'none'),
        outlineColor: getParam('outlineColor', '#000000'),
        outlineColor2: getParam('outlineColor2', '#ffffff'),
        outlineWidth: parseInt(getParam('outlineWidth', '2')),
        bgType: getParam('bgType', 'none'),
        bgColor: getParam('bgColor', '#1a1a2e'),
        bgColor2: getParam('bgColor2', '#16213e'),
      });

      const buf = result.toBuffer('image/png');
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-cache' });
      res.end(buf);
    } catch (e) {
      console.error('Generate error:', e.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, '0.0.0.0', function() {
  console.log('MC Avatar Generator running at http://localhost:' + PORT);
});

// ---- multipart parser ----
function parseMultipart(body, boundary) {
  var parts = [];
  // Use binary split to handle boundary markers correctly
  var marker = Buffer.from(boundary, 'binary');
  var bodyStr = body.toString('binary');
  var sections = bodyStr.split('--' + boundary);
  for (var i = 0; i < sections.length; i++) {
    var section = sections[i];
    if (!section.trim() || section.trim() === '--') continue;
    var idx = section.indexOf('\r\n\r\n');
    if (idx < 0) continue;
    var header = section.slice(0, idx);
    var data = section.slice(idx + 4);
    if (data.endsWith('\r\n')) data = data.slice(0, -2);
    var nameMatch = header.match(/name="([^"]+)"/);
    var filenameMatch = header.match(/filename="([^"]+)"/);
    if (!nameMatch) continue;
    var name = nameMatch[1];
    if (filenameMatch) {
      parts.push({ name: name, filename: filenameMatch[1], data: Buffer.from(data, 'binary') });
    } else {
      parts.push({ name: name, value: data });
    }
  }
  return parts;
}
