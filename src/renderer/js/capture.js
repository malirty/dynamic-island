// Screenshot overlay: region select + markup editor, eyedropper, QR, OCR.
const api = window.island;
const base = document.getElementById('base');
const draw = document.getElementById('draw');
const selEl = document.getElementById('sel');
const tools = document.getElementById('tools');
const hintbar = document.getElementById('hintbar');
const loupe = document.getElementById('loupe');
const bctx = base.getContext('2d');
const dctx = draw.getContext('2d');

let mode = 'region';
let img = null;      // full-resolution screenshot
let sf = 1;          // physical px per CSS px
let full = null;     // ImageData of the whole screenshot (for eyedropper / QR)
let phase = 'select';
let sel = null, start = null;
let tool = 'rect', color = '#ff3b5c';
const shapes = [];
let cur = null;

const ICON = {
  pen: 'M4 20l4-1L19 8l-3-3L5 16zM14 6l3 3', marker: 'M15 4l5 5-9 9H6v-5zM4 20h16', rect: 'M4 5h16v14H4z', arrow: 'M5 19L19 5M10 5h9v9',
  text: 'M5 6V4h14v2M12 4v16M9 20h6', blur: 'M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11zM9 14h6M10 17h4', undo: 'M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3',
  ocr: 'M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4M8 9h8M12 9v7', tr: 'M4 5h9M8.5 3v2M6 5c.6 3 2.7 5.6 5.5 7M11 5c-.8 3.6-3.4 6.6-7 8M13 20l4-9 4 9M14.5 17h5',
  qr: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 18h2v2', save: 'M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6', close: 'M6 6l12 12M18 6L6 18', redo: 'M3 12a9 9 0 1 0 3-6.7M3 4v5h5',
};
const svg = (n) => `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="${ICON[n]}"/></svg>`;

function sizeCanvases() {
  const dpr = window.devicePixelRatio || 1;
  for (const c of [base, draw]) { c.width = innerWidth * dpr; c.height = innerHeight * dpr; }
  bctx.setTransform(1, 0, 0, 1, 0, 0);
  bctx.drawImage(img, 0, 0, base.width, base.height);
  dctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function hint(t) { hintbar.textContent = t; hintbar.style.opacity = t ? 1 : 0; }

function norm(a, b) { return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) }; }
function showSel(r) {
  selEl.style.display = 'block';
  Object.assign(selEl.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' });
  selEl.querySelector('.size').textContent = `${Math.round(r.w * sf)} × ${Math.round(r.h * sf)}`;
}

// ---------- shapes ----------
function arrowPath(g, x1, y1, x2, y2, w) {
  const a = Math.atan2(y2 - y1, x2 - x1), L = Math.max(12, w * 4.5);
  g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2 - Math.cos(a) * L * 0.6, y2 - Math.sin(a) * L * 0.6); g.stroke();
  g.beginPath(); g.moveTo(x2, y2);
  g.lineTo(x2 - L * Math.cos(a - 0.45), y2 - L * Math.sin(a - 0.45));
  g.lineTo(x2 - L * Math.cos(a + 0.45), y2 - L * Math.sin(a + 0.45));
  g.closePath(); g.fill();
}
// draws shapes in CSS coordinates; `k` scales to output pixels, (ox, oy) is the crop origin
function paint(g, list, k = 1, ox = 0, oy = 0, srcImg = null) {
  for (const s of list) {
    g.save();
    g.scale(k, k);
    g.translate(-ox, -oy);
    g.strokeStyle = g.fillStyle = s.color;
    g.lineCap = g.lineJoin = 'round';
    if (s.tool === 'pen' || s.tool === 'marker') {
      g.lineWidth = s.tool === 'marker' ? 18 : 3.5;
      if (s.tool === 'marker') { g.globalAlpha = 0.38; g.globalCompositeOperation = 'multiply'; }
      g.beginPath();
      s.pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
      g.stroke();
    } else if (s.tool === 'rect') {
      g.lineWidth = 3;
      const r = norm(s.a, s.b);
      g.beginPath(); g.roundRect(r.x, r.y, r.w, r.h, 6); g.stroke();
    } else if (s.tool === 'arrow') {
      g.lineWidth = 3.5;
      arrowPath(g, s.a.x, s.a.y, s.b.x, s.b.y, 3.5);
    } else if (s.tool === 'text') {
      g.font = '600 22px "Segoe UI", sans-serif';
      g.lineWidth = 4; g.strokeStyle = 'rgba(0,0,0,.55)';
      g.strokeText(s.text, s.a.x, s.a.y + 22);
      g.fillText(s.text, s.a.x, s.a.y + 22);
    } else if (s.tool === 'blur' && srcImg) {
      const r = norm(s.a, s.b);
      g.beginPath(); g.rect(r.x, r.y, r.w, r.h); g.clip();
      g.filter = `blur(${10}px)`;
      // draw the screenshot again, blurred, inside the rectangle
      g.drawImage(srcImg, 0, 0, srcImg.width / sf, srcImg.height / sf);
      g.filter = 'none';
    }
    g.restore();
  }
}
function redraw() {
  dctx.clearRect(0, 0, innerWidth, innerHeight);
  if (!sel) return;
  dctx.save();
  dctx.beginPath(); dctx.rect(sel.x, sel.y, sel.w, sel.h); dctx.clip();
  paint(dctx, cur ? [...shapes, cur] : shapes, 1, 0, 0, img);
  dctx.restore();
}

// ---------- output ----------
function crop(withShapes = true) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(sel.w * sf));
  c.height = Math.max(1, Math.round(sel.h * sf));
  const g = c.getContext('2d');
  g.drawImage(img, sel.x * sf, sel.y * sf, c.width, c.height, 0, 0, c.width, c.height);
  if (withShapes) paint(g, shapes, sf, sel.x, sel.y, img);
  return c;
}
function done(res) { api.invoke('capture:done', res); }
function finish(kind, extra = {}) {
  if (!sel || sel.w < 3 || sel.h < 3) return;
  if (kind === 'qr') {
    const c = crop(false);
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height);
    const code = window.jsQR ? window.jsQR(d.data, c.width, c.height, { inversionAttempts: 'attemptBoth' }) : null;
    return done({ type: 'qr', text: code?.data || '' });
  }
  if (kind === 'ocr' || kind === 'translate') return done({ type: kind, dataUrl: crop(false).toDataURL('image/png') });
  done({ type: 'image', dataUrl: crop(true).toDataURL('image/png'), ...extra });
}

// ---------- toolbar ----------
function buildTools() {
  tools.innerHTML = '';
  const btn = (name, title, fn, cls = '') => { const b = document.createElement('button'); b.innerHTML = svg(name); b.title = title; b.className = cls; b.onclick = (e) => { e.stopPropagation(); fn(b); }; tools.append(b); return b; };
  const sep = () => tools.append(Object.assign(document.createElement('div'), { className: 'sep' }));
  const toolBtns = {};
  for (const [t, title] of [['pen', 'Перо'], ['marker', 'Маркер'], ['rect', 'Рамка'], ['arrow', 'Стрелка'], ['text', 'Текст'], ['blur', 'Размыть']]) {
    toolBtns[t] = btn(t, title, () => { tool = t; for (const [k, b] of Object.entries(toolBtns)) b.classList.toggle('on', k === tool); });
  }
  toolBtns[tool].classList.add('on');
  const col = document.createElement('input');
  col.type = 'color'; col.value = color; col.title = 'Цвет';
  col.oninput = () => (color = col.value);
  col.onmousedown = (e) => e.stopPropagation();
  tools.append(col);
  btn('undo', 'Отменить (Ctrl+Z)', () => { shapes.pop(); redraw(); });
  sep();
  btn('ocr', 'Распознать текст', () => finish('ocr'));
  btn('tr', 'Перевести текст со скрина', () => finish('translate'));
  btn('qr', 'Прочитать QR', () => finish('qr'));
  sep();
  btn('redo', 'Выделить заново', () => { phase = 'select'; sel = null; shapes.length = 0; tools.style.display = 'none'; selEl.style.display = 'none'; redraw(); hint('Выдели область'); document.body.className = 'dim'; });
  btn('save', 'Сохранить файл (Ctrl+S)', () => finish('image', { save: true }));
  btn('close', 'Отмена (Esc)', () => api.invoke('capture:cancel'));
  const copy = document.createElement('button');
  copy.className = 'pri'; copy.textContent = 'Копировать';
  copy.title = 'Enter';
  copy.onclick = (e) => { e.stopPropagation(); finish('image'); };
  tools.append(copy);
  tools.onmousedown = (e) => e.stopPropagation();
  // place toolbar under (or above) the selection
  tools.style.display = 'flex';
  const tw = tools.offsetWidth, th = tools.offsetHeight;
  let x = Math.min(innerWidth - tw - 10, Math.max(10, sel.x + sel.w - tw));
  let y = sel.y + sel.h + 10;
  if (y + th > innerHeight - 10) y = Math.max(10, sel.y - th - 10);
  if (y < 10) y = sel.y + 10;
  tools.style.left = x + 'px'; tools.style.top = y + 'px';
}

// ---------- text tool ----------
function textAt(p) {
  const i = document.createElement('input');
  i.className = 'txtin';
  i.style.left = p.x + 'px'; i.style.top = p.y + 'px'; i.style.color = color;
  document.body.append(i);
  setTimeout(() => i.focus(), 10);
  const commit = () => { if (i.value.trim()) shapes.push({ tool: 'text', color, a: p, text: i.value }); i.remove(); redraw(); };
  i.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') commit(); if (e.key === 'Escape') i.remove(); };
  i.onblur = commit;
  i.onmousedown = (e) => e.stopPropagation();
}

// ---------- eyedropper ----------
function pixel(x, y) {
  const px = Math.round(x * sf), py = Math.round(y * sf);
  const i = (py * full.width + px) * 4;
  return [full.data[i], full.data[i + 1], full.data[i + 2]];
}
const hex = (r, g, b) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
function moveLoupe(x, y) {
  loupe.style.display = 'block';
  const lc = loupe.querySelector('canvas').getContext('2d');
  lc.imageSmoothingEnabled = false;
  const N = 11;
  lc.drawImage(img, Math.round(x * sf) - (N >> 1), Math.round(y * sf) - (N >> 1), N, N, 0, 0, 132, 132);
  lc.strokeStyle = '#fff'; lc.lineWidth = 2;
  lc.strokeRect(132 / 2 - 6, 132 / 2 - 6, 12, 12);
  const c = hex(...pixel(x, y));
  loupe.querySelector('.hex').innerHTML = `<i style="background:${c}"></i>${c}`;
  let lx = x + 24, ly = y + 24;
  if (lx + 140 > innerWidth) lx = x - 156;
  if (ly + 170 > innerHeight) ly = y - 186;
  loupe.style.left = lx + 'px'; loupe.style.top = ly + 'px';
}

// ---------- mouse ----------
window.addEventListener('mousedown', (e) => {
  if (e.button === 2) return api.invoke('capture:cancel');
  const p = { x: e.clientX, y: e.clientY };
  if (mode === 'color') return done({ type: 'color', color: hex(...pixel(p.x, p.y)) });
  if (phase === 'select') { start = p; sel = { x: p.x, y: p.y, w: 0, h: 0 }; document.body.className = 'selecting'; return; }
  if (phase === 'edit') {
    if (p.x < sel.x || p.y < sel.y || p.x > sel.x + sel.w || p.y > sel.y + sel.h) return;
    if (tool === 'text') return textAt(p);
    cur = tool === 'pen' || tool === 'marker' ? { tool, color, pts: [p] } : { tool, color, a: p, b: p };
  }
});
window.addEventListener('mousemove', (e) => {
  const p = { x: e.clientX, y: e.clientY };
  if (mode === 'color') return moveLoupe(p.x, p.y);
  if (phase === 'select' && start) { sel = norm(start, p); showSel(sel); return; }
  if (phase === 'edit' && cur) {
    if (cur.pts) cur.pts.push(p); else cur.b = p;
    redraw();
  }
});
window.addEventListener('mouseup', () => {
  if (phase === 'select' && start) {
    start = null;
    if (!sel || sel.w < 4 || sel.h < 4) {
      // a click without dragging grabs the whole screen
      sel = { x: 0, y: 0, w: innerWidth, h: innerHeight };
    }
    showSel(sel);
    if (mode === 'region') { phase = 'edit'; document.body.className = 'editing'; hint(''); buildTools(); }
    else finish(mode);
    return;
  }
  if (cur) { shapes.push(cur); cur = null; redraw(); }
});
window.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') return api.invoke('capture:cancel');
  if (phase !== 'edit') return;
  if (e.key === 'Enter' || (e.ctrlKey && e.key.toLowerCase() === 'c')) { e.preventDefault(); finish('image'); }
  if (e.ctrlKey && e.key.toLowerCase() === 's') { e.preventDefault(); finish('image', { save: true }); }
  if (e.ctrlKey && e.key.toLowerCase() === 'z') { shapes.pop(); redraw(); }
});

// ---------- boot ----------
(async () => {
  const d = await api.invoke('capture:data');
  if (!d) return api.invoke('capture:cancel');
  mode = d.mode;
  sf = d.sf;
  img = new Image();
  img.onload = () => {
    sizeCanvases();
    if (mode === 'color' || mode === 'qr') {
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0);
      full = g.getImageData(0, 0, c.width, c.height);
    }
    document.body.className = 'dim';
    hint({ region: 'Выдели область · клик — весь экран · Esc — отмена', color: 'Наведи на цвет и кликни — HEX скопируется', qr: 'Выдели QR-код', ocr: 'Выдели текст, который нужно распознать', translate: 'Выдели текст для перевода' }[mode] || '');
    if (mode === 'color') { document.body.style.cursor = 'none'; document.body.className = ''; }
  };
  img.src = d.dataUrl;
})();
