import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { DEFAULT_PAINTS } from './public/paints.js';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const MAX_BODY = 64 * 1024;
// A calibration carries its photo as a data URL.
const MAX_CALIBRATION_BODY = 12 * 1024 * 1024;
const HEX_RE = /^#[0-9a-f]{6}$/;

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function openDb(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'paint-mixer.db'));
  db.exec('PRAGMA journal_mode = WAL');
  const { user_version: version } = db.prepare('PRAGMA user_version').get();
  if (version < 1) {
    db.exec(`
      BEGIN;
      CREATE TABLE paints (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        hex TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        position INTEGER NOT NULL
      );
      CREATE TABLE recipes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        target_hex TEXT NOT NULL,
        mix_hex TEXT NOT NULL,
        delta_e REAL NOT NULL,
        drops TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );
    `);
    db.exec('PRAGMA user_version = 1; COMMIT;');
  }
  if (version < 2) {
    db.exec(`
      BEGIN;
      ALTER TABLE paints ADD COLUMN strength REAL NOT NULL DEFAULT 1;
    `);
    if (version < 1) writePaints(db, DEFAULT_PAINTS);
    db.exec('PRAGMA user_version = 2; COMMIT;');
  }
  if (version < 3) {
    // Raw calibration input, kept so a new mixing model can refit paints without new photos.
    db.exec(`
      BEGIN;
      CREATE TABLE calibrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        white_id TEXT NOT NULL,
        white_drops INTEGER NOT NULL,
        samples TEXT NOT NULL,
        photo BLOB NOT NULL,
        photo_type TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );
      PRAGMA user_version = 3;
      COMMIT;
    `);
  }
  return db;
}

function writePaints(db, paints) {
  db.exec('DELETE FROM paints');
  const insert = db.prepare('INSERT INTO paints (id, name, hex, enabled, strength, position) VALUES (?, ?, ?, ?, ?, ?)');
  paints.forEach((p, i) => insert.run(p.id, p.name, p.hex, p.enabled ? 1 : 0, p.strength ?? 1, i));
}

function readPaints(db) {
  return db
    .prepare('SELECT id, name, hex, enabled, strength FROM paints ORDER BY position')
    .all()
    .map((p) => ({ ...p, enabled: !!p.enabled }));
}

function readRecipe(row) {
  return {
    id: row.id,
    name: row.name,
    targetHex: row.target_hex,
    mixHex: row.mix_hex,
    deltaE: row.delta_e,
    drops: JSON.parse(row.drops),
    createdAt: row.created_at,
  };
}

const str = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
const hex = (v) => typeof v === 'string' && HEX_RE.test(v);

function validatePaints(body) {
  if (!Array.isArray(body) || body.length > 100) throw new HttpError(400, 'expected an array of at most 100 paints');
  const ids = new Set();
  for (const p of body) {
    if (!p || !str(p.id, 64) || !str(p.name, 60) || !hex(p.hex) || typeof p.enabled !== 'boolean') {
      throw new HttpError(400, 'each paint needs id, name, lowercase #rrggbb hex, and enabled');
    }
    if (p.strength !== undefined && !(Number.isFinite(p.strength) && p.strength >= 0.01 && p.strength <= 100)) {
      throw new HttpError(400, 'strength must be a number from 0.01 to 100');
    }
    if (ids.has(p.id)) throw new HttpError(400, `duplicate paint id ${p.id}`);
    ids.add(p.id);
  }
  return body.map(({ id, name, hex, enabled, strength = 1 }) => ({ id, name: name.trim(), hex, enabled, strength }));
}

function validateRecipe(b) {
  const ok =
    b &&
    str(b.name, 80) &&
    hex(b.targetHex) &&
    hex(b.mixHex) &&
    Number.isFinite(b.deltaE) &&
    Array.isArray(b.drops) &&
    b.drops.length > 0 &&
    b.drops.length <= 12 &&
    b.drops.every((d) => d && str(d.name, 60) && hex(d.hex) && Number.isInteger(d.count) && d.count > 0 && d.count <= 999);
  if (!ok) throw new HttpError(400, 'recipe needs name, targetHex, mixHex, deltaE, and drops [{name, hex, count}]');
  return {
    name: b.name.trim(),
    targetHex: b.targetHex,
    mixHex: b.mixHex,
    deltaE: b.deltaE,
    drops: b.drops.map(({ name, hex, count }) => ({ name, hex, count })),
  };
}

const PHOTO_RE = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+=*)$/;
const SAMPLE_KINDS = new Set(['white', 'mass', 'tint']);

function validateCalibration(b) {
  const photo = b && typeof b.photo === 'string' ? PHOTO_RE.exec(b.photo) : null;
  const ok =
    photo &&
    str(b.whiteId, 64) &&
    Number.isInteger(b.whiteDrops) &&
    b.whiteDrops >= 1 &&
    b.whiteDrops <= 50 &&
    Array.isArray(b.samples) &&
    b.samples.length > 0 &&
    b.samples.length <= 300 &&
    b.samples.every(
      (s) =>
        s &&
        SAMPLE_KINDS.has(s.kind) &&
        str(s.paintId, 64) &&
        hex(s.hex) &&
        Number.isInteger(s.x) &&
        Number.isInteger(s.y) &&
        Number.isInteger(s.radius),
    );
  if (!ok) throw new HttpError(400, 'calibration needs whiteId, whiteDrops, samples [{paintId, kind, hex, x, y, radius}], and a photo data URL');
  return {
    whiteId: b.whiteId,
    whiteDrops: b.whiteDrops,
    samples: b.samples.map(({ paintId, kind, hex, x, y, radius }) => ({ paintId, kind, hex, x, y, radius })),
    photoType: photo[1],
    photo: Buffer.from(photo[2], 'base64'),
  };
}

function readCalibration(row) {
  return {
    id: row.id,
    whiteId: row.white_id,
    whiteDrops: row.white_drops,
    samples: JSON.parse(row.samples),
    createdAt: row.created_at,
  };
}

async function readJson(req, maxBody = MAX_BODY) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBody) throw new HttpError(413, 'body too large');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'invalid JSON');
  }
}

function send(res, status, body, type = 'application/json') {
  const payload = type === 'application/json' && body !== undefined ? JSON.stringify(body) : body;
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(payload);
}

function serveStatic(req, res, pathname) {
  let rel;
  try {
    rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  } catch {
    throw new HttpError(404, 'not found');
  }
  const file = path.resolve(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR + path.sep)) throw new HttpError(404, 'not found');
  let data;
  try {
    data = fs.readFileSync(file);
  } catch {
    throw new HttpError(404, 'not found');
  }
  res.writeHead(200, {
    'Content-Type': CONTENT_TYPES[path.extname(file)] || 'application/octet-stream',
    // The service worker owns offline caching. Always revalidate so deploys show up at once.
    'Cache-Control': 'no-cache',
  });
  res.end(req.method === 'HEAD' ? undefined : data);
}

export function createServer({ dataDir }) {
  const db = openDb(dataDir);

  async function route(req, res) {
    const { pathname } = new URL(req.url, 'http://localhost');
    const method = req.method;

    if (pathname === '/healthz') return send(res, 200, 'ok', 'text/plain');

    if (pathname === '/api/paints') {
      if (method === 'GET') return send(res, 200, readPaints(db));
      if (method === 'PUT') {
        const paints = validatePaints(await readJson(req));
        db.exec('BEGIN');
        try {
          writePaints(db, paints);
          db.exec('COMMIT');
        } catch (e) {
          db.exec('ROLLBACK');
          throw e;
        }
        return send(res, 200, readPaints(db));
      }
      throw new HttpError(405, 'method not allowed');
    }

    if (pathname === '/api/recipes') {
      if (method === 'GET') {
        return send(res, 200, db.prepare('SELECT * FROM recipes ORDER BY id DESC').all().map(readRecipe));
      }
      if (method === 'POST') {
        const r = validateRecipe(await readJson(req));
        const row = db
          .prepare('INSERT INTO recipes (name, target_hex, mix_hex, delta_e, drops) VALUES (?, ?, ?, ?, ?) RETURNING *')
          .get(r.name, r.targetHex, r.mixHex, r.deltaE, JSON.stringify(r.drops));
        return send(res, 201, readRecipe(row));
      }
      throw new HttpError(405, 'method not allowed');
    }

    if (pathname === '/api/calibrations') {
      if (method === 'GET') {
        const rows = db.prepare('SELECT id, white_id, white_drops, samples, created_at FROM calibrations ORDER BY id DESC').all();
        return send(res, 200, rows.map(readCalibration));
      }
      if (method === 'POST') {
        const c = validateCalibration(await readJson(req, MAX_CALIBRATION_BODY));
        const row = db
          .prepare(
            'INSERT INTO calibrations (white_id, white_drops, samples, photo, photo_type) VALUES (?, ?, ?, ?, ?) RETURNING id, white_id, white_drops, samples, created_at',
          )
          .get(c.whiteId, c.whiteDrops, JSON.stringify(c.samples), c.photo, c.photoType);
        return send(res, 201, readCalibration(row));
      }
      throw new HttpError(405, 'method not allowed');
    }

    const photoMatch = /^\/api\/calibrations\/(\d+)\/photo$/.exec(pathname);
    if (photoMatch) {
      if (method !== 'GET') throw new HttpError(405, 'method not allowed');
      const row = db.prepare('SELECT photo, photo_type FROM calibrations WHERE id = ?').get(Number(photoMatch[1]));
      if (!row) throw new HttpError(404, 'calibration not found');
      res.writeHead(200, { 'Content-Type': row.photo_type, 'Cache-Control': 'private, max-age=31536000, immutable' });
      return res.end(Buffer.from(row.photo));
    }

    const recipeMatch = /^\/api\/recipes\/(\d+)$/.exec(pathname);
    if (recipeMatch) {
      if (method !== 'DELETE') throw new HttpError(405, 'method not allowed');
      const { changes } = db.prepare('DELETE FROM recipes WHERE id = ?').run(Number(recipeMatch[1]));
      if (!changes) throw new HttpError(404, 'recipe not found');
      return send(res, 204);
    }

    if (pathname.startsWith('/api/')) throw new HttpError(404, 'not found');
    if (method !== 'GET' && method !== 'HEAD') throw new HttpError(405, 'method not allowed');
    return serveStatic(req, res, pathname);
  }

  const server = http.createServer((req, res) => {
    route(req, res).catch((err) => {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) console.error(err);
      if (!res.headersSent) send(res, status, { error: status === 500 ? 'internal error' : err.message });
    });
  });
  server.on('close', () => db.close());
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 8080);
  const server = createServer({ dataDir: process.env.DATA_DIR || './data' });
  server.listen(port, () => console.log(`paint-mixer listening on :${port}`));
  const stop = () => {
    server.close(() => process.exit(0));
    server.closeIdleConnections();
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
