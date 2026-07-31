/**
 * MoodBot License Server — Cloudflare Worker
 * ───────────────────────────────────────────
 * Runs on Cloudflare Workers + D1 (SQLite).
 * No external server required.
 *
 * CLIENT ENDPOINTS (used by the MoodBot app):
 *   POST /api/activate   { key, hwid }
 *   POST /api/validate   { key, hwid }
 *
 * ADMIN ENDPOINTS (X-Admin-Secret header required):
 *   GET    /admin/keys
 *   POST   /admin/keys              { note, days }
 *   POST   /admin/keys/:id/pause
 *   POST   /admin/keys/:id/extend   { days }
 *   POST   /admin/keys/:id/unbind
 *   DELETE /admin/keys/:id
 *   GET    /admin/keys/:id/log
 *   GET    /health
 *
 * Admin UI:
 *   GET /admin-ui  (serves the existing HTML dashboard)
 */

export default {
  async fetch(request, env) {
    const url    = new URL(request.url);
    const method = request.method;
    const path   = url.pathname;

    // ── CORS for admin UI ────────────────────────────────────────────────────
    const corsHeaders = {
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Secret',
    };
    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    function json(data, status = 200) {
      return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    function now() { return Math.floor(Date.now() / 1000); }

    // ── Admin auth ───────────────────────────────────────────────────────────
    function isAdmin() {
      const secret = request.headers.get('x-admin-secret') || url.searchParams.get('secret');
      return secret === env.ADMIN_SECRET;
    }
    function requireAdmin() {
      if (!isAdmin()) return json({ ok: false, message: 'Unauthorized' }, 401);
      return null;
    }

    // ── Key generator ────────────────────────────────────────────────────────
    function generateKey() {
      const arr = new Uint8Array(8);
      crypto.getRandomValues(arr);
      const hex = Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
      return `MBOT-${hex.slice(0,4)}-${hex.slice(4,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}`;
    }

    // ── Audit log helper ─────────────────────────────────────────────────────
    async function auditLog(keyId, action, detail = '') {
      await env.DB.prepare(
        'INSERT INTO log (key_id, action, detail, ts) VALUES (?, ?, ?, ?)'
      ).bind(keyId, action, detail, now()).run();
    }

    // ── Body parser ──────────────────────────────────────────────────────────
    async function body() {
      try { return await request.json(); } catch { return {}; }
    }

    // ════════════════════════════════════════════════════════════════════════
    //  ADMIN UI — served automatically from /public via [assets] in wrangler.toml
    //  Worker only needs to handle /admin-ui → redirect to /index.html
    // ════════════════════════════════════════════════════════════════════════
    if (path === '/admin-ui' || path === '/admin-ui/') {
      return Response.redirect(new URL('/index.html', request.url).toString(), 302);
    }

    // ════════════════════════════════════════════════════════════════════════
    //  CLIENT API
    // ════════════════════════════════════════════════════════════════════════

    // POST /api/activate
    if (path === '/api/activate' && method === 'POST') {
      const { key, hwid } = await body();
      if (!key || !hwid) return json({ ok: false, message: 'key and hwid required' }, 400);

      const row = await env.DB.prepare('SELECT * FROM keys WHERE key = ?')
        .bind(key.toUpperCase()).first();

      if (!row)                        return json({ ok: false, message: 'License key not found.' });
      if (row.status === 'revoked')    return json({ ok: false, message: 'This license key has been revoked.' });
      if (row.status === 'paused')     return json({ ok: false, message: 'This license key is currently paused.' });
      if (row.expires_at && row.expires_at < now()) return json({ ok: false, message: 'This license key has expired.' });

      if (row.hwid && row.hwid !== hwid) {
        return json({ ok: false, message: 'This key is already activated on another machine. Contact support to transfer it.' });
      }

      if (!row.hwid) {
        await env.DB.prepare('UPDATE keys SET hwid=?, activated_at=?, last_seen=? WHERE id=?')
          .bind(hwid, now(), now(), row.id).run();
      } else {
        await env.DB.prepare('UPDATE keys SET last_seen=? WHERE id=?')
          .bind(now(), row.id).run();
      }

      await auditLog(row.id, 'activate', `hwid=${hwid}`);
      return json({ ok: true, message: 'Activated.', expiresAt: row.expires_at || null });
    }

    // POST /api/validate
    if (path === '/api/validate' && method === 'POST') {
      const { key, hwid } = await body();
      if (!key || !hwid) return json({ ok: false, message: 'key and hwid required' }, 400);

      const row = await env.DB.prepare('SELECT * FROM keys WHERE key = ?')
        .bind(key.toUpperCase()).first();

      if (!row)                        return json({ ok: false, status: 'not_found',    message: 'License key not found.' });
      if (row.status === 'revoked')    return json({ ok: false, status: 'revoked',      message: 'This license key has been revoked.' });
      if (row.status === 'paused')     return json({ ok: false, status: 'paused',       message: 'Your license is currently paused by the administrator.' });
      if (row.expires_at && row.expires_at < now()) return json({ ok: false, status: 'expired', message: 'Your license has expired.' });

      if (row.hwid && row.hwid !== hwid) {
        return json({ ok: false, status: 'hwid_mismatch', message: 'Hardware ID mismatch. This key is locked to a different machine.' });
      }

      if (!row.hwid) {
        await env.DB.prepare('UPDATE keys SET hwid=?, activated_at=?, last_seen=? WHERE id=?')
          .bind(hwid, now(), now(), row.id).run();
        await auditLog(row.id, 'auto-bind', `hwid=${hwid}`);
      } else {
        await env.DB.prepare('UPDATE keys SET last_seen=? WHERE id=?')
          .bind(now(), row.id).run();
      }

      await auditLog(row.id, 'validate', `hwid=${hwid}`);
      return json({ ok: true, status: 'active', expiresAt: row.expires_at || null });
    }

    // ════════════════════════════════════════════════════════════════════════
    //  ADMIN API
    // ════════════════════════════════════════════════════════════════════════

    // GET /admin/keys
    if (path === '/admin/keys' && method === 'GET') {
      const denied = requireAdmin(); if (denied) return denied;
      const { results } = await env.DB.prepare('SELECT * FROM keys ORDER BY id DESC').all();
      return json({ ok: true, keys: results });
    }

    // POST /admin/keys
    if (path === '/admin/keys' && method === 'POST') {
      const denied = requireAdmin(); if (denied) return denied;
      const { note = '', days } = await body();
      const key       = generateKey();
      const expiresAt = days ? now() + parseInt(days, 10) * 86400 : null;
      const result    = await env.DB.prepare(
        'INSERT INTO keys (key, note, status, hwid, created_at, expires_at, activated_at, last_seen) VALUES (?,?,?,?,?,?,?,?)'
      ).bind(key, note, 'active', null, now(), expiresAt, null, null).run();
      const id = result.meta.last_row_id;
      await auditLog(id, 'created', `note="${note}" days=${days ?? 'unlimited'}`);
      const row = await env.DB.prepare('SELECT * FROM keys WHERE id=?').bind(id).first();
      return json({ ok: true, key: row });
    }

    // POST /admin/keys/:id/pause
    const pauseMatch = path.match(/^\/admin\/keys\/(\d+)\/pause$/);
    if (pauseMatch && method === 'POST') {
      const denied = requireAdmin(); if (denied) return denied;
      const id  = parseInt(pauseMatch[1], 10);
      const row = await env.DB.prepare('SELECT * FROM keys WHERE id=?').bind(id).first();
      if (!row) return json({ ok: false, message: 'Key not found' }, 404);
      const newStatus = row.status === 'paused' ? 'active' : 'paused';
      await env.DB.prepare('UPDATE keys SET status=? WHERE id=?').bind(newStatus, id).run();
      await auditLog(id, newStatus === 'paused' ? 'paused' : 'unpaused');
      return json({ ok: true, status: newStatus });
    }

    // POST /admin/keys/:id/extend
    const extendMatch = path.match(/^\/admin\/keys\/(\d+)\/extend$/);
    if (extendMatch && method === 'POST') {
      const denied = requireAdmin(); if (denied) return denied;
      const id  = parseInt(extendMatch[1], 10);
      const { days } = await body();
      if (!days) return json({ ok: false, message: 'days required' }, 400);
      const row = await env.DB.prepare('SELECT * FROM keys WHERE id=?').bind(id).first();
      if (!row) return json({ ok: false, message: 'Key not found' }, 404);
      const base      = row.expires_at ? Math.max(row.expires_at, now()) : now();
      const expiresAt = base + parseInt(days, 10) * 86400;
      await env.DB.prepare('UPDATE keys SET expires_at=? WHERE id=?').bind(expiresAt, id).run();
      await auditLog(id, 'extended', `+${days} days`);
      return json({ ok: true, expiresAt });
    }

    // POST /admin/keys/:id/unbind
    const unbindMatch = path.match(/^\/admin\/keys\/(\d+)\/unbind$/);
    if (unbindMatch && method === 'POST') {
      const denied = requireAdmin(); if (denied) return denied;
      const id = parseInt(unbindMatch[1], 10);
      const row = await env.DB.prepare('SELECT * FROM keys WHERE id=?').bind(id).first();
      if (!row) return json({ ok: false, message: 'Key not found' }, 404);
      await env.DB.prepare('UPDATE keys SET hwid=NULL, activated_at=NULL WHERE id=?').bind(id).run();
      await auditLog(id, 'hwid-unbound');
      return json({ ok: true });
    }

    // DELETE /admin/keys/:id
    const deleteMatch = path.match(/^\/admin\/keys\/(\d+)$/);
    if (deleteMatch && method === 'DELETE') {
      const denied = requireAdmin(); if (denied) return denied;
      const id = parseInt(deleteMatch[1], 10);
      const row = await env.DB.prepare('SELECT * FROM keys WHERE id=?').bind(id).first();
      if (!row) return json({ ok: false, message: 'Key not found' }, 404);
      await auditLog(id, 'revoked+deleted');
      await env.DB.prepare('DELETE FROM keys WHERE id=?').bind(id).run();
      return json({ ok: true });
    }

    // GET /admin/keys/:id/log
    const logMatch = path.match(/^\/admin\/keys\/(\d+)\/log$/);
    if (logMatch && method === 'GET') {
      const denied = requireAdmin(); if (denied) return denied;
      const id = parseInt(logMatch[1], 10);
      const { results } = await env.DB.prepare(
        'SELECT * FROM log WHERE key_id=? ORDER BY ts DESC LIMIT 100'
      ).bind(id).all();
      return json({ ok: true, log: results });
    }

    // GET /health
    if (path === '/health' && method === 'GET') {
      const denied = requireAdmin(); if (denied) return denied;
      return json({ ok: true, ts: now() });
    }

    return json({ ok: false, message: 'Not found' }, 404);
  },
};
