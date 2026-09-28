import { parseHex, hexToRgb, rgbToHex, describeDeltaE } from './mix.js';
import { DEFAULT_PAINTS } from './paints.js';

const $ = (sel, root = document) => root.querySelector(sel);

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') Object.assign(el.style, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  el.append(...children.flat().filter((c) => c != null && c !== false));
  return el;
}

const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v == null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  },
};

const clone = (v) => JSON.parse(JSON.stringify(v));

const state = {
  target: parseHex(store.get('target', '')) || null,
  maxDrops: store.get('maxDrops', 30),
  paints: store.get('paints', clone(DEFAULT_PAINTS)),
  recipes: store.get('recipes', []),
  results: [],
  scales: [],
};

// ---------- server ----------

async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('Cannot reach the server. If this keeps up, reload to sign in again.');
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Server error ${res.status}`);
  }
  return res.status === 204 ? null : res.json();
}

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 3500);
}

// ---------- tabs ----------

function showTab(name) {
  document.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
  document.querySelectorAll('[data-panel]').forEach((p) => (p.hidden = p.dataset.panel !== name));
  store.set('tab', name);
  window.scrollTo({ top: 0 });
}

document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));

// ---------- target ----------

function textOn(hex) {
  const [r, g, b] = hexToRgb(hex);
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#1b1813' : '#ffffff';
}

function setTarget(hex, { fromHexInput = false } = {}) {
  state.target = hex;
  store.set('target', hex);
  const sw = $('#targetSwatch');
  sw.style.background = hex;
  sw.style.color = textOn(hex);
  $('#targetLabel').textContent = hex;
  if (!fromHexInput) $('#hexInput').value = hex;
  $('#hexInput').classList.remove('invalid');
  $('#colorInput').value = hex;
  scheduleSolve();
}

$('#hexInput').addEventListener('input', (e) => {
  const v = e.target.value.trim();
  if (/^#?[0-9a-f]{6}$/i.test(v)) setTarget(parseHex(v), { fromHexInput: true });
});
$('#hexInput').addEventListener('change', (e) => {
  const hex = parseHex(e.target.value);
  if (hex) setTarget(hex);
  else e.target.classList.add('invalid');
});
$('#colorInput').addEventListener('input', (e) => setTarget(e.target.value));

// ---------- photo picking ----------

const canvas = $('#photoCanvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
let pixels = null;
const MAX_PHOTO_SIDE = 1600;

$('#photoInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(1, MAX_PHOTO_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
    $('#photoCard').hidden = false;
    lastPick = null;
    resetView();
    $('#photoCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch {
    toast('Could not open that image.');
  } finally {
    URL.revokeObjectURL(url);
  }
});

$('#clearPhoto').addEventListener('click', () => {
  $('#photoCard').hidden = true;
  pixels = null;
});

const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const srgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

// Averages a small square in linear light so photo noise and texture do not decide the color.
function sampleAt(x, y, radius) {
  const sum = [0, 0, 0];
  let n = 0;
  for (let yy = Math.max(0, y - radius); yy <= Math.min(pixels.height - 1, y + radius); yy++) {
    for (let xx = Math.max(0, x - radius); xx <= Math.min(pixels.width - 1, x + radius); xx++) {
      const i = (yy * pixels.width + xx) * 4;
      for (let c = 0; c < 3; c++) sum[c] += lin(pixels.data[i + c] / 255);
      n++;
    }
  }
  return rgbToHex(sum.map((s) => srgb(s / n) * 255));
}

// Photo view: one finger picks, two fingers pinch-zoom and pan, the mouse wheel zooms.
const stage = $('.photo-stage');
const view = { s: 1, tx: 0, ty: 0 };
const MAX_ZOOM = 10;
let lastPick = null;

// Untransformed canvas box in client coordinates. The CSS transform is applied on top of it.
function canvasBase() {
  const r = stage.getBoundingClientRect();
  return { left: r.left + canvas.offsetLeft, top: r.top + canvas.offsetTop, w: canvas.offsetWidth, h: canvas.offsetHeight };
}

function applyView() {
  const { w, h } = canvasBase();
  view.s = Math.min(MAX_ZOOM, Math.max(1, view.s));
  // Keep the zoomed photo covering its box so it cannot be dragged away.
  view.tx = Math.min(0, Math.max(w - w * view.s, view.tx));
  view.ty = Math.min(0, Math.max(h - h * view.s, view.ty));
  canvas.style.transform = `translate(${view.tx}px, ${view.ty}px) scale(${view.s})`;
  $('#fitPhoto').hidden = view.s === 1;
  placeMarker();
}

function resetView() {
  Object.assign(view, { s: 1, tx: 0, ty: 0 });
  applyView();
}

// Zooms to scale s while the photo point under the client point (cx, cy) stays put.
function zoomAt(cx, cy, s, anchor = null) {
  const base = canvasBase();
  const a = anchor || { x: (cx - base.left - view.tx) / view.s, y: (cy - base.top - view.ty) / view.s };
  view.s = Math.min(MAX_ZOOM, Math.max(1, s));
  view.tx = cx - base.left - a.x * view.s;
  view.ty = cy - base.top - a.y * view.s;
  applyView();
}

// Stage-relative position of a canvas pixel under the current view.
function toStage(x, y) {
  const k = (canvas.offsetWidth / canvas.width) * view.s;
  return { x: canvas.offsetLeft + view.tx + x * k, y: canvas.offsetTop + view.ty + y * k };
}

function placeMarker() {
  const marker = $('#marker');
  marker.hidden = !lastPick;
  if (!lastPick) return;
  const p = toStage(lastPick.x + 0.5, lastPick.y + 0.5);
  marker.style.left = `${p.x}px`;
  marker.style.top = `${p.y}px`;
}

function pick(e, commit) {
  if (!pixels) return;
  const rect = canvas.getBoundingClientRect();
  const scale = canvas.width / rect.width;
  const x = Math.min(canvas.width - 1, Math.max(0, Math.floor((e.clientX - rect.left) * scale)));
  const y = Math.min(canvas.height - 1, Math.max(0, Math.floor((e.clientY - rect.top) * scale)));
  // About a 9px screen square, so zooming in also makes the sample smaller.
  const hex = sampleAt(x, y, Math.max(0, Math.round(4 * scale)));
  lastPick = { x, y };
  placeMarker();

  const loupe = $('#loupe');
  const p = toStage(x + 0.5, y + 0.5);
  loupe.hidden = commit;
  loupe.classList.toggle('below', p.y < 150);
  loupe.style.left = `${p.x}px`;
  loupe.style.top = `${p.y}px`;
  loupe.style.background = hex;
  loupe.textContent = hex;
  loupe.style.color = textOn(hex);

  if (commit) setTarget(hex);
  else previewTarget(hex);
}

function previewTarget(hex) {
  const sw = $('#targetSwatch');
  sw.style.background = hex;
  sw.style.color = textOn(hex);
  $('#targetLabel').textContent = hex;
}

const pointers = new Map();
let picking = false;
let pinch = null;

function cancelPick() {
  picking = false;
  $('#loupe').hidden = true;
  if (state.target) previewTarget(state.target);
}

function pinchState() {
  const [a, b] = [...pointers.values()];
  return { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) || 1 };
}

stage.addEventListener('pointerdown', (e) => {
  stage.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 1 && !pinch) {
    picking = true;
    pick(e, false);
  } else if (pointers.size === 2) {
    cancelPick();
    const g = pinchState();
    const base = canvasBase();
    pinch = { ...g, s: view.s, anchor: { x: (g.cx - base.left - view.tx) / view.s, y: (g.cy - base.top - view.ty) / view.s } };
  }
});

stage.addEventListener('pointermove', (e) => {
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinch && pointers.size >= 2) {
    const g = pinchState();
    zoomAt(g.cx, g.cy, (pinch.s * g.d) / pinch.d, pinch.anchor);
  } else if (picking) {
    pick(e, false);
  }
});

function pointerEnd(e, commit) {
  if (!pointers.delete(e.pointerId)) return;
  if (picking && commit) {
    picking = false;
    pick(e, true);
  } else if (picking) {
    cancelPick();
  }
  // Lifting one finger of a pinch must not start a pick with the other one.
  if (pointers.size === 0) pinch = null;
}
stage.addEventListener('pointerup', (e) => pointerEnd(e, true));
stage.addEventListener('pointercancel', (e) => pointerEnd(e, false));

stage.addEventListener('wheel', (e) => {
  if (!pixels) return;
  e.preventDefault();
  zoomAt(e.clientX, e.clientY, view.s * Math.exp(-e.deltaY * 0.002));
}, { passive: false });

$('#fitPhoto').addEventListener('click', resetView);
window.addEventListener('resize', () => pixels && applyView());

// ---------- solving ----------

const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
let solveId = 0;
let solveTimer;

function scheduleSolve() {
  clearTimeout(solveTimer);
  solveTimer = setTimeout(runSolve, 120);
}

function runSolve() {
  if (!state.target) return;
  const paints = state.paints.filter((p) => p.enabled);
  if (!paints.length) {
    state.results = [];
    renderResults();
    $('#status').textContent = 'Turn on at least one paint in the Paints tab.';
    return;
  }
  $('#status').textContent = 'Mixing…';
  worker.postMessage({ id: ++solveId, target: state.target, paints, maxDrops: state.maxDrops });
}

worker.onmessage = ({ data }) => {
  if (data.id !== solveId) return;
  state.results = data.results;
  state.scales = data.results.map(() => 1);
  $('#status').textContent = '';
  renderResults();
};

$('#maxDrops').value = state.maxDrops;
$('#maxDropsOut').textContent = state.maxDrops;
$('#maxDrops').addEventListener('input', (e) => {
  state.maxDrops = Number(e.target.value);
  $('#maxDropsOut').textContent = state.maxDrops;
  store.set('maxDrops', state.maxDrops);
  scheduleSolve();
});

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function compare(targetHex, mixHex) {
  return h('div', { class: 'compare' },
    h('div', { style: { background: targetHex, color: textOn(targetHex) } }, h('span', {}, 'Target')),
    h('div', { style: { background: mixHex, color: textOn(mixHex) } }, h('span', {}, 'Mix')),
  );
}

function dropList(drops) {
  return h('ul', { class: 'drops' },
    drops.map((d) => h('li', {},
      h('i', { class: 'dot', style: { background: d.hex } }),
      h('span', { class: 'name' }, d.name),
      h('b', {}, plural(d.count, 'drop')),
    )),
  );
}

function deltaBadge(de) {
  const cls = de < 2 ? 'good' : de < 5 ? 'ok' : 'poor';
  return h('span', { class: `badge ${cls}`, title: 'CIEDE2000 color difference' }, `ΔE ${de.toFixed(1)} · ${describeDeltaE(de)}`);
}

function renderResults() {
  const root = $('#results');
  root.replaceChildren();
  state.results.forEach((r, i) => {
    const scale = state.scales[i];
    const drops = r.drops.map((d) => ({ name: d.paint.name, hex: d.paint.hex, count: d.count * scale }));
    root.append(
      h('article', { class: 'card result' },
        compare(state.target, r.hex),
        h('header', {}, h('h3', {}, r.label), deltaBadge(r.deltaE)),
        dropList(drops),
        h('footer', {},
          h('div', { class: 'scale', role: 'group', 'aria-label': 'Batch size' },
            [1, 2, 3, 5].map((s) =>
              h('button', {
                type: 'button',
                'aria-pressed': String(s === scale),
                onclick: () => {
                  state.scales[i] = s;
                  renderResults();
                },
              }, `×${s}`),
            ),
          ),
          h('span', { class: 'muted total' }, plural(r.total * scale, 'drop')),
          h('button', { class: 'btn primary small', type: 'button', onclick: () => openSave(r, drops) }, 'Save'),
        ),
      ),
    );
  });
}

// ---------- saving ----------

let pendingSave = null;

function openSave(result, drops) {
  pendingSave = { result, drops, target: state.target };
  $('#saveSwatch').replaceChildren(compare(state.target, result.hex));
  $('#saveName').value = '';
  $('#saveDialog').showModal();
  $('#saveName').focus();
}

$('#saveDialog').addEventListener('close', async () => {
  const dialog = $('#saveDialog');
  if (dialog.returnValue !== 'save' || !pendingSave) return;
  const { result, drops, target } = pendingSave;
  pendingSave = null;
  try {
    const recipe = await api('/api/recipes', {
      method: 'POST',
      body: {
        name: $('#saveName').value.trim() || target,
        targetHex: target,
        mixHex: result.hex,
        deltaE: Math.round(result.deltaE * 100) / 100,
        drops,
      },
    });
    state.recipes.unshift(recipe);
    store.set('recipes', state.recipes);
    renderSaved();
    toast(`Saved “${recipe.name}”.`);
  } catch (err) {
    toast(err.message);
  }
});

function renderSaved() {
  const root = $('#savedList');
  root.replaceChildren();
  if (!state.recipes.length) {
    root.append(h('p', { class: 'empty muted' }, 'No saved colors yet. Mix a color, then tap Save.'));
    return;
  }
  for (const r of state.recipes) {
    const total = r.drops.reduce((s, d) => s + d.count, 0);
    root.append(
      h('article', { class: 'card result saved' },
        compare(r.targetHex, r.mixHex),
        h('header', {},
          h('h3', {}, r.name),
          deltaBadge(r.deltaE),
        ),
        dropList(r.drops),
        h('footer', {},
          h('span', { class: 'muted total' }, `${plural(total, 'drop')} · ${new Date(r.createdAt).toLocaleDateString()}`),
          h('button', {
            class: 'btn ghost small',
            type: 'button',
            onclick: () => {
              setTarget(r.targetHex);
              showTab('mix');
            },
          }, 'Re-mix'),
          h('button', {
            class: 'btn danger small',
            type: 'button',
            onclick: async () => {
              if (!confirm(`Delete “${r.name}”?`)) return;
              try {
                await api(`/api/recipes/${r.id}`, { method: 'DELETE' });
                state.recipes = state.recipes.filter((x) => x.id !== r.id);
                store.set('recipes', state.recipes);
                renderSaved();
              } catch (err) {
                toast(err.message);
              }
            },
          }, 'Delete'),
        ),
      ),
    );
  }
}

// ---------- paints ----------

let paintSaveTimer;
function paintsChanged() {
  store.set('paints', state.paints);
  scheduleSolve();
  clearTimeout(paintSaveTimer);
  paintSaveTimer = setTimeout(async () => {
    try {
      await api('/api/paints', { method: 'PUT', body: state.paints });
    } catch (err) {
      toast(`Paints not saved: ${err.message}`);
    }
  }, 600);
}

const eyedropper = () => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.innerHTML = '<path d="M5 19l9-9m-2-2 4 4m-1-5 2-2a2.1 2.1 0 0 1 3 3l-2 2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>';
  return svg;
};

function renderPaints() {
  const root = $('#paintList');
  root.replaceChildren();
  state.paints.forEach((p) => {
    const swatch = h('label', { class: 'paint-swatch', style: { background: p.hex } },
      h('input', {
        type: 'color',
        value: p.hex,
        'aria-label': `${p.name} color`,
        oninput: (e) => {
          p.hex = e.target.value;
          swatch.style.background = p.hex;
          paintsChanged();
        },
      }),
    );
    root.append(
      h('li', { class: 'paint-row' },
        swatch,
        h('input', {
          class: 'paint-name',
          type: 'text',
          value: p.name,
          maxlength: '60',
          'aria-label': 'Paint name',
          oninput: (e) => {
            if (!e.target.value.trim()) return;
            p.name = e.target.value.trim();
            paintsChanged();
          },
        }),
        h('button', {
          class: 'icon-btn',
          type: 'button',
          title: 'Set to the current Mix color',
          'aria-label': `Set ${p.name} to the current Mix color`,
          onclick: () => {
            if (!state.target) return toast('Pick a color on the Mix tab first.');
            p.hex = state.target;
            renderPaints();
            paintsChanged();
            toast(`${p.name} is now ${p.hex}.`);
          },
        }, eyedropper()),
        h('label', { class: 'toggle', title: 'Use this paint in mixes' },
          h('input', {
            type: 'checkbox',
            checked: p.enabled,
            onchange: (e) => {
              p.enabled = e.target.checked;
              paintsChanged();
            },
          }),
          h('span', { 'aria-hidden': 'true' }),
        ),
        h('button', {
          class: 'icon-btn danger',
          type: 'button',
          'aria-label': `Delete ${p.name}`,
          onclick: () => {
            if (!confirm(`Delete ${p.name}?`)) return;
            state.paints = state.paints.filter((x) => x !== p);
            renderPaints();
            paintsChanged();
          },
        }, '×'),
      ),
    );
  });
}

$('#addPaint').addEventListener('click', () => {
  state.paints.push({ id: crypto.randomUUID(), name: 'New paint', hex: state.target || '#808080', enabled: true });
  renderPaints();
  paintsChanged();
  const names = document.querySelectorAll('.paint-name');
  names[names.length - 1].select();
});

$('#resetPaints').addEventListener('click', () => {
  if (!confirm('Replace your paint list with the 16 default DecoArt Americana paints?')) return;
  state.paints = clone(DEFAULT_PAINTS);
  renderPaints();
  paintsChanged();
});

// ---------- startup ----------

async function sync() {
  try {
    const [paints, recipes] = await Promise.all([api('/api/paints'), api('/api/recipes')]);
    state.paints = paints;
    state.recipes = recipes;
    store.set('paints', paints);
    store.set('recipes', recipes);
    renderPaints();
    renderSaved();
    scheduleSolve();
  } catch (err) {
    toast(`Offline: showing saved copy. ${err.message}`);
  }
}

renderPaints();
renderSaved();
showTab(store.get('tab', 'mix'));
if (state.target) setTarget(state.target);
sync();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
