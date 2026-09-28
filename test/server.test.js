import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../server.js';
import { DEFAULT_PAINTS } from '../public/paints.js';

let dataDir;
let server;
let base;

async function start() {
  server = createServer({ dataDir });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
}

async function stop() {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}

const req = (p, method = 'GET', body) =>
  fetch(base + p, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });

beforeEach(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'paint-mixer-'));
  await start();
});

afterEach(async () => {
  await stop();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const recipe = {
  name: 'Moss',
  targetHex: '#6b8e23',
  mixHex: '#688d0b',
  deltaE: 1.89,
  drops: [
    { name: 'Bright Yellow', hex: '#ffd100', count: 8 },
    { name: 'Kelly Green', hex: '#1e8c3a', count: 1 },
  ],
};

test('a new database starts with the default paints', async () => {
  const paints = await (await req('/api/paints')).json();
  assert.deepEqual(paints, DEFAULT_PAINTS);
});

test('an emptied paint list stays empty after a restart', async () => {
  assert.equal((await req('/api/paints', 'PUT', [])).status, 200);
  await stop();
  await start();
  assert.deepEqual(await (await req('/api/paints')).json(), []);
});

test('paint edits persist in the order sent', async () => {
  const paints = [
    { id: 'b', name: 'Second', hex: '#000000', enabled: false, strength: 3 },
    { id: 'a', name: 'First', hex: '#ffffff', enabled: true, strength: 1 },
  ];
  await req('/api/paints', 'PUT', paints);
  await stop();
  await start();
  assert.deepEqual(await (await req('/api/paints')).json(), paints);
});

test('a rejected paint list leaves the stored list alone', async () => {
  const bad = [
    { id: 'x', name: 'Ok', hex: '#000000', enabled: true },
    { id: 'x', name: 'Dup', hex: '#ffffff', enabled: true },
  ];
  assert.equal((await req('/api/paints', 'PUT', bad)).status, 400);
  assert.equal((await req('/api/paints', 'PUT', [{ id: 'y', name: 'Y', hex: 'red', enabled: true }])).status, 400);
  assert.equal((await (await req('/api/paints')).json()).length, DEFAULT_PAINTS.length);
});

test('recipes save, list newest first, and delete', async () => {
  const first = await (await req('/api/recipes', 'POST', recipe)).json();
  const second = await (await req('/api/recipes', 'POST', { ...recipe, name: 'Moss 2' })).json();
  assert.equal(first.name, 'Moss');
  assert.deepEqual(first.drops, recipe.drops);
  assert.match(first.createdAt, /^\d{4}-\d{2}-\d{2}T/);

  const listed = await (await req('/api/recipes')).json();
  assert.deepEqual(listed.map((r) => r.id), [second.id, first.id]);

  assert.equal((await req(`/api/recipes/${first.id}`, 'DELETE')).status, 204);
  assert.equal((await req(`/api/recipes/${first.id}`, 'DELETE')).status, 404);
  assert.deepEqual((await (await req('/api/recipes')).json()).map((r) => r.id), [second.id]);
});

test('invalid recipes are rejected', async () => {
  for (const bad of [
    { ...recipe, drops: [] },
    { ...recipe, targetHex: '#6B8E23' },
    { ...recipe, drops: [{ name: 'X', hex: '#000000', count: 1.5 }] },
    { ...recipe, name: '   ' },
  ]) {
    assert.equal((await req('/api/recipes', 'POST', bad)).status, 400, JSON.stringify(bad));
  }
  assert.equal((await req('/api/recipes', 'POST', '{not json')).status, 400);
  assert.equal((await req('/api/recipes', 'POST', { ...recipe, name: 'x'.repeat(70 * 1024) })).status, 413);
});

test('static files are served and nothing outside public/ leaks', async () => {
  const index = await req('/');
  assert.equal(index.status, 200);
  assert.match(index.headers.get('content-type'), /text\/html/);
  assert.match(await index.text(), /Paint Mixer/);

  assert.match((await req('/manifest.webmanifest')).headers.get('content-type'), /manifest\+json/);
  for (const p of ['/%2e%2e/server.js', '/..%2fserver.js', '/%E0%A4%A']) {
    assert.equal((await req(p)).status, 404, p);
  }
});

test('a version 1 database keeps its paints and gets strength 1', async () => {
  await stop();
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.mkdirSync(dataDir);
  const { DatabaseSync } = await import('node:sqlite');
  const old = new DatabaseSync(path.join(dataDir, 'paint-mixer.db'));
  old.exec(`
    CREATE TABLE paints (id TEXT PRIMARY KEY, name TEXT NOT NULL, hex TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1, position INTEGER NOT NULL);
    CREATE TABLE recipes (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, target_hex TEXT NOT NULL,
      mix_hex TEXT NOT NULL, delta_e REAL NOT NULL, drops TEXT NOT NULL, created_at TEXT NOT NULL);
    INSERT INTO paints VALUES ('mine', 'My Paint', '#123456', 0, 0);
    PRAGMA user_version = 1;
  `);
  old.close();
  await start();
  assert.deepEqual(await (await req('/api/paints')).json(), [
    { id: 'mine', name: 'My Paint', hex: '#123456', enabled: false, strength: 1 },
  ]);
});

test('paint strength persists and out-of-range strength is rejected', async () => {
  const paints = [{ id: 'k', name: 'Black', hex: '#000000', enabled: true, strength: 6.5 }];
  assert.equal((await req('/api/paints', 'PUT', paints)).status, 200);
  assert.deepEqual(await (await req('/api/paints')).json(), paints);
  for (const strength of [0, -1, 1000, '2']) {
    assert.equal((await req('/api/paints', 'PUT', [{ ...paints[0], strength }])).status, 400, String(strength));
  }
});
