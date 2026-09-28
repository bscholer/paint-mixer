// Paint mixing model and drop-count solver. Shared by the browser (worker) and the Node tests.
//
// Mixing uses single-constant Kubelka-Munk per linear-RGB channel: each paint's reflectance
// becomes an absorption/scattering ratio (K/S), ratios mix linearly by weight, and the result
// converts back to reflectance. This makes blue + yellow go green, which RGB averaging gets wrong.
//
// A drop's weight is its count times the paint's tinting strength. Paints differ a lot here:
// a drop of lamp black shifts a mix far more than a drop of a white-heavy pastel. Strength is
// relative to the white paint (strength 1) and comes from calibrate().

const HEX_RE = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

// Pure black has infinite K/S. Clamp so the math stays finite.
const R_MIN = 0.002;

export function parseHex(input) {
  const m = HEX_RE.exec(String(input).trim());
  if (!m) return null;
  let h = m[1].toLowerCase();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return '#' + h;
}

export function hexToRgb(hex) {
  const h = parseHex(hex);
  if (!h) throw new Error(`bad hex color: ${hex}`);
  return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
}

export function rgbToHex(rgb) {
  return '#' + rgb.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('');
}

const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function hexToLinear(hex) {
  return hexToRgb(hex).map((v) => toLinear(v / 255));
}

function linearToHex(lin) {
  return rgbToHex(lin.map((c) => toSrgb(c) * 255));
}

function toKS(r) {
  const R = Math.min(1, Math.max(R_MIN, r));
  return ((1 - R) * (1 - R)) / (2 * R);
}

function fromKS(k) {
  return 1 + k - Math.sqrt(k * k + 2 * k);
}

const labF = (t) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);

function linearToLab([r, g, b]) {
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
  const fx = labF(x), fy = labF(y), fz = labF(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export function hexToLab(hex) {
  return linearToLab(hexToLinear(hex));
}

const RAD = Math.PI / 180;
const POW25_7 = 25 ** 7;

export function deltaE2000([L1, a1, b1], [L2, a2, b2]) {
  const Cb = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2;
  const Cb7 = Cb ** 7;
  const G = 0.5 * (1 - Math.sqrt(Cb7 / (Cb7 + POW25_7)));
  const a1p = a1 * (1 + G), a2p = a2 * (1 + G);
  const C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
  const hue = (b, a) => {
    if (a === 0 && b === 0) return 0;
    const d = Math.atan2(b, a) / RAD;
    return d < 0 ? d + 360 : d;
  };
  const h1p = hue(b1, a1p), h2p = hue(b2, a2p);
  const chromaZero = C1p * C2p === 0;

  let dhp = 0;
  if (!chromaZero) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp * RAD) / 2);

  const Lbp = (L1 + L2) / 2;
  const Cbp = (C1p + C2p) / 2;
  let hbp = h1p + h2p;
  if (!chromaZero) {
    if (Math.abs(h1p - h2p) > 180) hbp += hbp < 360 ? 360 : -360;
    hbp /= 2;
  }

  const T =
    1 -
    0.17 * Math.cos((hbp - 30) * RAD) +
    0.24 * Math.cos(2 * hbp * RAD) +
    0.32 * Math.cos((3 * hbp + 6) * RAD) -
    0.2 * Math.cos((4 * hbp - 63) * RAD);
  const dTheta = 30 * Math.exp(-(((hbp - 275) / 25) ** 2));
  const Cbp7 = Cbp ** 7;
  const RC = 2 * Math.sqrt(Cbp7 / (Cbp7 + POW25_7));
  const L50 = (Lbp - 50) ** 2;
  const SL = 1 + (0.015 * L50) / Math.sqrt(20 + L50);
  const SC = 1 + 0.045 * Cbp;
  const SH = 1 + 0.015 * Cbp * T;
  const RT = -Math.sin(2 * dTheta * RAD) * RC;

  const l = dLp / SL, c = dCp / SC, h = dHp / SH;
  return Math.sqrt(l * l + c * c + h * h + RT * c * h);
}

const strengthOf = (p) => p.strength ?? 1;

// drops: [{ hex, count, strength? }]
export function mixDrops(drops) {
  const total = drops.reduce((s, d) => s + d.count * strengthOf(d), 0);
  if (!total) throw new Error('no drops to mix');
  const ks = [0, 0, 0];
  for (const d of drops) {
    hexToLinear(d.hex).forEach((c, i) => (ks[i] += d.count * strengthOf(d) * toKS(c)));
  }
  return linearToHex(ks.map((k) => fromKS(k / total)));
}

const MULTI_PAINT_DROP_CAP = 30;

const gcd = (a, b) => (b ? gcd(b, a % b) : a);

// Finds drop counts of the given paints whose mix is closest to targetHex.
// Only primitive recipes are searched (2:1, never 4:2), so the counts are the smallest batch
// for that ratio. Three-paint recipes stop at 30 drops to keep the search fast on a phone. Returns up to three labelled options: closest, simplest, and different paints.
export function solve(targetHex, paints, { maxDrops = 30, maxPaints = 3 } = {}) {
  const target = hexToLab(targetHex);
  const ks = paints.map((p) => hexToLinear(p.hex).map(toKS));
  const strength = paints.map(strengthOf);
  const n = paints.length;
  const k = Math.min(maxPaints, n);

  let best = null;
  const bestByTotal = new Array(maxDrops + 1).fill(null);
  const bestBySet = [];

  const idx = new Array(k);
  const cnt = new Array(k);
  const lin = [0, 0, 0];
  let setBest = null;

  function evaluate(size) {
    let total = 0;
    let weight = 0;
    for (let i = 0; i < size; i++) {
      total += cnt[i];
      weight += cnt[i] * strength[idx[i]];
    }
    for (let c = 0; c < 3; c++) {
      let s = 0;
      for (let i = 0; i < size; i++) s += cnt[i] * strength[idx[i]] * ks[idx[i]][c];
      lin[c] = fromKS(s / weight);
    }
    const de = deltaE2000(target, linearToLab(lin));
    const snap = () => ({ idx: idx.slice(0, size), cnt: cnt.slice(0, size), total, de });
    const rec = (!setBest || de < setBest.de) ? (setBest = snap()) : null;
    const byTotal = bestByTotal[total];
    if (!byTotal || de < byTotal.de) bestByTotal[total] = rec || snap();
    if (!best || de < best.de) best = rec || snap();
  }

  function counts(pos, size, remaining, g) {
    if (pos === size) {
      if (g === 1) evaluate(size);
      return;
    }
    const slotsAfter = size - pos - 1;
    for (let c = 1; c <= remaining - slotsAfter; c++) {
      cnt[pos] = c;
      counts(pos + 1, size, remaining - c, gcd(g, c));
    }
  }

  function subsets(pos, start, size) {
    if (pos === size) {
      setBest = null;
      counts(0, size, size >= 3 ? Math.min(maxDrops, MULTI_PAINT_DROP_CAP) : maxDrops, 0);
      if (setBest) bestBySet.push(setBest);
      return;
    }
    for (let i = start; i <= n - (size - pos); i++) {
      idx[pos] = i;
      subsets(pos + 1, i + 1, size);
    }
  }

  for (let size = 1; size <= k; size++) subsets(0, 0, size);
  if (!best) return [];

  const setKey = (r) => r.idx.join(',');
  const sameRecipe = (a, b) => setKey(a) === setKey(b) && a.cnt.join(',') === b.cnt.join(',');

  const picks = [['Closest match', best]];
  const tolerance = Math.max(best.de + 1, best.de * 1.25);
  const simplest = bestByTotal.find((r) => r && r.de <= tolerance);
  if (simplest && !sameRecipe(simplest, best)) picks.push(['Fewest drops', simplest]);

  const usedSets = new Set(picks.map(([, r]) => setKey(r)));
  const alt = bestBySet.filter((r) => !usedSets.has(setKey(r))).sort((a, b) => a.de - b.de)[0];
  if (alt) picks.push(['Different paints', alt]);

  return picks.map(([label, r]) => {
    const drops = r.idx
      .map((i, j) => ({ paint: paints[i], count: r.cnt[j] }))
      .sort((a, b) => b.count - a.count);
    return {
      label,
      drops,
      total: r.total,
      deltaE: r.de,
      hex: mixDrops(drops.map((d) => ({ hex: d.paint.hex, count: d.count, strength: strengthOf(d.paint) }))),
    };
  });
}

// The white paint's dried color. A calibration photo is white-balanced so its white patch
// matches this, which removes the color cast of the light.
export const WHITE_REFERENCE = '#f4f4f1';

// Best strength for a paint, from its pure color and the color of 1 drop mixed with
// `whiteDrops` drops of white. Searches log-spaced strengths, then refines around the best.
export function fitStrength(massHex, tintHex, whiteHex, whiteDrops) {
  const tint = hexToLab(tintHex);
  const err = (s) =>
    deltaE2000(tint, hexToLab(mixDrops([{ hex: massHex, count: 1, strength: s }, { hex: whiteHex, count: whiteDrops }])));
  let lo = Math.log(0.01), hi = Math.log(100);
  for (let round = 0; round < 4; round++) {
    const steps = 40;
    let bestX = lo, bestE = Infinity;
    for (let i = 0; i <= steps; i++) {
      const x = lo + ((hi - lo) * i) / steps;
      const e = err(Math.exp(x));
      if (e < bestE) [bestX, bestE] = [x, e];
    }
    const span = (hi - lo) / steps;
    [lo, hi] = [bestX - span, bestX + span];
  }
  return Math.exp((lo + hi) / 2);
}

// Turns raw photo samples into calibrated paints.
//   white: hex of the white patch in the photo
//   samples: [{ id, mass?, tint?, fallbackHex? }] with photo hexes of each paint's pure patch and
//   its 1:whiteDrops tint. fallbackHex stands in for an unsampled pure patch when fitting strength.
// Returns [{ id, hex?, strength? }], leaving out anything that was not sampled.
export function calibrate({ white, samples, whiteDrops }) {
  const ref = hexToLinear(WHITE_REFERENCE);
  const gain = hexToLinear(white).map((c, i) => ref[i] / Math.max(c, 1e-4));
  const balance = (hex) => linearToHex(hexToLinear(hex).map((c, i) => Math.min(1, c * gain[i])));
  return samples.map(({ id, mass, tint, fallbackHex }) => {
    const out = { id };
    if (mass) out.hex = balance(mass);
    const massHex = out.hex || fallbackHex;
    if (tint && massHex) out.strength = fitStrength(massHex, balance(tint), WHITE_REFERENCE, whiteDrops);
    return out;
  });
}

export function describeDeltaE(de) {
  if (de < 1) return 'Indistinguishable';
  if (de < 2) return 'Very close';
  if (de < 5) return 'Close';
  if (de < 10) return 'Noticeably off';
  return 'Rough';
}
