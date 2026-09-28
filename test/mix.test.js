import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deltaE2000, hexToLab, mixDrops, parseHex, solve } from '../public/mix.js';
import { DEFAULT_PAINTS } from '../public/paints.js';

const paint = (name) => DEFAULT_PAINTS.find((p) => p.name === name);

test('deltaE2000 matches Sharma et al. reference pairs', () => {
  // Pairs 1, 7, 17, 25 from Sharma, Wu & Dalal (2005): chroma, grey, large and hue-wrap cases.
  const cases = [
    [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
    [[50, 0, 0], [50, -1, 2], 2.3669],
    [[50, 2.5, 0], [73, 25, -18], 27.1492],
    [[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644],
  ];
  for (const [a, b, expected] of cases) {
    assert.ok(Math.abs(deltaE2000(a, b) - expected) < 1e-4, `${a} vs ${b}: ${deltaE2000(a, b)} != ${expected}`);
  }
});

test('blue and yellow mix to green, not the grey that RGB averaging gives', () => {
  const [L, a, b] = hexToLab(mixDrops([
    { hex: paint('Bright Yellow').hex, count: 1 },
    { hex: paint('Bright Blue').hex, count: 1 },
  ]));
  assert.ok(a < -20, `expected a green a* axis, got ${a}`);
  assert.ok(Math.hypot(a, b) > 30, `expected a saturated mix, got chroma ${Math.hypot(a, b)}`);
  assert.ok(L > 20 && L < 70, `unexpected lightness ${L}`);
});

test('a little black darkens white far more than its share of drops', () => {
  const L = hexToLab(mixDrops([
    { hex: paint('White').hex, count: 9 },
    { hex: paint('Black').hex, count: 1 },
  ]))[0];
  const averaged = (hexToLab(paint('White').hex)[0] * 9 + hexToLab(paint('Black').hex)[0]) / 10;
  assert.ok(L < averaged - 10, `9:1 white:black gave L*=${L}, a plain average gives ${averaged}`);
});

test('solver recovers a known recipe', () => {
  const target = mixDrops([
    { hex: paint('White').hex, count: 3 },
    { hex: paint('Flag Red').hex, count: 1 },
  ]);
  const [best] = solve(target, DEFAULT_PAINTS, { maxDrops: 12 });
  assert.equal(best.label, 'Closest match');
  assert.ok(best.deltaE < 0.5, `deltaE ${best.deltaE}`);
  const counts = Object.fromEntries(best.drops.map((d) => [d.paint.name, d.count]));
  assert.deepEqual(counts, { White: 3, 'Flag Red': 1 });
});

test('solver finds three-paint recipes', () => {
  const recipe = [
    { hex: paint('Bright Yellow').hex, count: 5 },
    { hex: paint('Bright Blue').hex, count: 2 },
    { hex: paint('White').hex, count: 4 },
  ];
  const [best] = solve(mixDrops(recipe), DEFAULT_PAINTS, { maxDrops: 15 });
  assert.ok(best.deltaE < 0.5, `deltaE ${best.deltaE}`);
});

test('a paint color on its own needs one drop, never a scaled-up batch', () => {
  const results = solve(paint('Kelly Green').hex, DEFAULT_PAINTS, { maxDrops: 20 });
  assert.deepEqual(
    results[0].drops.map((d) => [d.paint.name, d.count]),
    [['Kelly Green', 1]],
  );
  for (const r of results) {
    const counts = r.drops.map((d) => d.count);
    assert.equal(counts.reduce(gcdOf), 1, `${r.label} is not in lowest terms: ${counts}`);
  }
});

const gcdOf = (a, b) => (b ? gcdOf(b, a % b) : a);

test('solver keeps total drops under the cap and labels distinct options', () => {
  const results = solve('#8b4513', DEFAULT_PAINTS, { maxDrops: 10 });
  for (const r of results) assert.ok(r.total <= 10, `${r.label} uses ${r.total} drops`);
  assert.equal(new Set(results.map((r) => r.label)).size, results.length);
  const alt = results.find((r) => r.label === 'Different paints');
  if (alt) {
    const bestSet = results[0].drops.map((d) => d.paint.id).sort().join();
    assert.notEqual(alt.drops.map((d) => d.paint.id).sort().join(), bestSet);
  }
});

test('parseHex normalizes shorthand and rejects junk', () => {
  assert.equal(parseHex('ABC'), '#aabbcc');
  assert.equal(parseHex(' #6B8E23 '), '#6b8e23');
  assert.equal(parseHex('#12345'), null);
  assert.equal(parseHex('#ggg'), null);
});
