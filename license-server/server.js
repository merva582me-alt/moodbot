/**
 * MoodBot License Server
 * ─────────────────────
 * Self-hosted Node.js/Express API that validates, manages, and HWID-locks
 * license keys.  Uses lowdb for pure-JSON persistence — no native compilation
 * required, runs on any Node.js installation.
 *
 * CLIENT ENDPOINTS (used by the MoodBot app):
 *   POST /api/activate   { key, hwid }  → activate + bind HWID
 *   POST /api/validate   { key, hwid }  → validate on every startup
 *
 * ADMIN ENDPOINTS (protected by X-Admin-Secret header):
 *   GET    /admin/keys              → list all keys
 *   POST   /admin/keys              { note, days } → create key
 *   POST   /admin/keys/:id/pause   → toggle paused ↔ active
 *   POST   /admin/keys/:id/extend  { days } → add days
 *   POST   /admin/keys/:id/unbind  → clear HWID binding
 *   DELETE /admin/keys/:id         → permanently revoke + delete
 *   GET    /admin/keys/:id/log     → audit trail
 *
 * SETUP:
 *   1. Copy .env.example to .env and set ADMIN_SECRET
 *   2. npm install
 *   3. node server.js
 *
 * SERVE ADMIN UI:
 *   Visit http://localhost:3000/admin-ui  (enter your ADMIN_SECRET to unlock)
 */

import express  from 'express';
import { Low }  from 'lowdb';
import { JSONFile } from 'lowdb/node';
import { randomBytes } from 'crypto';
import { fileURLToPath } from 'url';
import path from 'path';
import fs   from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Load .env ──────────────────────────────────────────────────────────────────
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const m = line.match(/^([A-Z_]+)=(.+)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  });
}

const PORT         = parseInt(process.env.PORT         || '3000', 10);
const ADMIN_SECRET = process.env.ADMIN_SECRET          || 'CHANGE-ME-NOW';
const DB_PATH      = process.env.DB_PATH               || path.join(__dirname, 'licenses.json');

if (ADMIN_SECRET === 'CHANGE-ME-NOW') {
  console.warn('\n⚠️  WARNING: Using default ADMIN_SECRET. Set ADMIN_SECRET in .env before going live!\n');
}

// ── Database (lowdb JSON) ──────────────────────────────────────────────────────
/** @type {{ keys: LicenseKey[], log: AuditEntry[] }} */
const defaultData = { keys: [], log: [] };

/**
 * @typedef {{ id: number, key: string, note: string, status: 'active'|'paused'|'revoked',
 *             hwid: string|null, createdAt: number, expiresAt: number|null,
 *             activatedAt: number|null, lastSeen: number|null }} LicenseKey
 * @typedef {{ id: number, keyId: number, action: string, detail: string, ts: number }} AuditEntry
 */

const adapter = new JSONFile(DB_PATH);
const db      = new Low(adapter, defaultData);
await db.read();

/** Persist changes to disk. */
async function save() { await db.write(); }

function now() { return Math.floor(Date.now() / 1000); }

let nextKeyId = db.data.keys.length > 0
  ? Math.max(...db.data.keys.map(k => k.id)) + 1
  : 1;
let nextLogId = db.data.log.length > 0
  ? Math.max(...db.data.log.map(e => e.id)) + 1
  : 1;

function log(keyId, action, detail = '') {
  db.data.log.push({ id: nextLogId++, keyId, action, detail, ts: now() });
  // Keep log capped at 10 000 entries
  if (db.data.log.length > 10000) db.data.log.shift();
  save();
}

function generateKey() {
  const parts = Array.from({ length: 4 }, () =>
    randomBytes(2).toString('hex').toUpperCase()
  );
  return 'MBOT-' + parts.join('-');
}

// ── Express ────────────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());
app.use('/admin-ui', express.static(path.join(__dirname, 'public')));

function requireAdmin(req, res, next) {
  const secret = req.headers['x-admin-secret'] || req.query.secret;
  if (secret !== ADMIN_SECRET) return res.status(401).json({ ok: false, message: 'Unauthorized' });
  next();
}

// ══════════════════════════════════════════════════════════════════════════════
//  CLIENT API
// ══════════════════════════════════════════════════════════════════════════════

app.post('/api/activate', async (req, res) => {
  const { key, hwid } = req.body || {};
  if (!key || !hwid) return res.status(400).json({ ok: false, message: 'key and hwid required' });

  const row = db.data.keys.find(k => k.key === key.toUpperCase());
  if (!row)                     return res.json({ ok: false, message: 'License key not found.' });
  if (row.status === 'revoked') return res.json({ ok: false, message: 'This license key has been revoked.' });
  if (row.status === 'paused')  return res.json({ ok: false, message: 'This license key is currently paused.' });
  if (row.expiresAt && row.expiresAt < now()) return res.json({ ok: false, message: 'This license key has expired.' });

  if (row.hwid && row.hwid !== hwid) {
    return res.json({ ok: false, message: 'This key is already activated on another machine. Contact support to transfer it.' });
  }

  if (!row.hwid) {
    row.hwid        = hwid;
    row.activatedAt = now();
  }
  row.lastSeen = now();
  await save();
  log(row.id, 'activate', `hwid=${hwid}`);

  return res.json({ ok: true, message: 'Activated.', expiresAt: row.expiresAt || null });
});

app.post('/api/validate', async (req, res) => {
  const { key, hwid } = req.body || {};
  if (!key || !hwid) return res.status(400).json({ ok: false, message: 'key and hwid required' });

  const row = db.data.keys.find(k => k.key === key.toUpperCase());
  if (!row)                     return res.json({ ok: false, status: 'not_found',    message: 'License key not found.' });
  if (row.status === 'revoked') return res.json({ ok: false, status: 'revoked',      message: 'This license key has been revoked.' });
  if (row.status === 'paused')  return res.json({ ok: false, status: 'paused',       message: 'Your license is currently paused by the administrator.' });
  if (row.expiresAt && row.expiresAt < now()) return res.json({ ok: false, status: 'expired', message: 'Your license has expired.' });

  if (row.hwid && row.hwid !== hwid) {
    return res.json({ ok: false, status: 'hwid_mismatch', message: 'Hardware ID mismatch. This key is locked to a different machine.' });
  }

  if (!row.hwid) {
    row.hwid = hwid;
    row.activatedAt = now();
    log(row.id, 'auto-bind', `hwid=${hwid}`);
  }
  row.lastSeen = now();
  await save();
  log(row.id, 'validate', `hwid=${hwid}`);

  return res.json({ ok: true, status: 'active', expiresAt: row.expiresAt || null });
});

// ══════════════════════════════════════════════════════════════════════════════
//  ADMIN API
// ══════════════════════════════════════════════════════════════════════════════

app.get('/admin/keys', requireAdmin, (_req, res) => {
  res.json({ ok: true, keys: db.data.keys });
});

app.post('/admin/keys', requireAdmin, async (req, res) => {
  const { note = '', days } = req.body || {};
  const key      = generateKey();
  const expiresAt = days ? now() + parseInt(days, 10) * 86400 : null;
  const row = {
    id: nextKeyId++, key, note, status: 'active',
    hwid: null, createdAt: now(), expiresAt,
    activatedAt: null, lastSeen: null,
  };
  db.data.keys.unshift(row);
  await save();
  log(row.id, 'created', `note="${note}" days=${days ?? 'unlimited'}`);
  res.json({ ok: true, key: row });
});

app.post('/admin/keys/:id/pause', requireAdmin, async (req, res) => {
  const row = db.data.keys.find(k => k.id === parseInt(req.params.id, 10));
  if (!row) return res.status(404).json({ ok: false, message: 'Key not found' });
  row.status = row.status === 'paused' ? 'active' : 'paused';
  await save();
  log(row.id, row.status === 'paused' ? 'paused' : 'unpaused');
  res.json({ ok: true, status: row.status });
});

app.post('/admin/keys/:id/extend', requireAdmin, async (req, res) => {
  const { days } = req.body || {};
  if (!days) return res.status(400).json({ ok: false, message: 'days required' });
  const row = db.data.keys.find(k => k.id === parseInt(req.params.id, 10));
  if (!row) return res.status(404).json({ ok: false, message: 'Key not found' });
  const base     = row.expiresAt ? Math.max(row.expiresAt, now()) : now();
  row.expiresAt  = base + parseInt(days, 10) * 86400;
  await save();
  log(row.id, 'extended', `+${days} days`);
  res.json({ ok: true, expiresAt: row.expiresAt });
});

app.post('/admin/keys/:id/unbind', requireAdmin, async (req, res) => {
  const row = db.data.keys.find(k => k.id === parseInt(req.params.id, 10));
  if (!row) return res.status(404).json({ ok: false, message: 'Key not found' });
  row.hwid = null; row.activatedAt = null;
  await save();
  log(row.id, 'hwid-unbound');
  res.json({ ok: true });
});

app.delete('/admin/keys/:id', requireAdmin, async (req, res) => {
  const idx = db.data.keys.findIndex(k => k.id === parseInt(req.params.id, 10));
  if (idx === -1) return res.status(404).json({ ok: false, message: 'Key not found' });
  const row = db.data.keys[idx];
  // Log revocation before removing
  log(row.id, 'revoked+deleted');
  db.data.keys.splice(idx, 1);
  await save();
  res.json({ ok: true });
});

app.get('/admin/keys/:id/log', requireAdmin, (req, res) => {
  const id   = parseInt(req.params.id, 10);
  const rows = db.data.log.filter(e => e.keyId === id).slice(-100).reverse();
  res.json({ ok: true, log: rows });
});

app.get('/health', requireAdmin, (_req, res) => res.json({ ok: true, ts: now() }));

// ── Start ──────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🔑 MoodBot License Server running on http://localhost:${PORT}`);
  console.log(`   Admin dashboard: http://localhost:${PORT}/admin-ui`);
  console.log(`   DB file:         ${DB_PATH}`);
  console.log(`   Admin secret:    ${ADMIN_SECRET === 'CHANGE-ME-NOW' ? '⚠️  INSECURE DEFAULT' : '✅ configured'}\n`);
});
