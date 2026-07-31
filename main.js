import { app, BrowserWindow, Menu, WebContentsView, ipcMain, session, shell, safeStorage, net } from 'electron';
import { autoUpdater } from 'electron-updater';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import { createHash } from 'crypto';

import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// When files are in asarUnpack they live in app.asar.unpacked/ rather than
// inside the asar archive.  __dirname points inside the asar, so we fix it up.
function unpackedPath(...segments) {
  const base = __dirname.replace(/app\.asar(?![.\\/])/, 'app.asar.unpacked');
  return path.join(base, ...segments);
}

// Fixed userData so persist: cookies survive across runs.
// app.getPath('userData') is platform-correct by default; calling setPath lets us
// keep the 'moodbot' subfolder name consistently across Windows / macOS / Linux.
app.setPath('userData', app.getPath('userData'));

let mainWindow = null;
const views       = new Map(); // viewId → WebContentsView
const pendingUrls = new Map(); // viewId → url queued before view existed

// ── Metrics polling state (module-level so nav hooks can reference them) ──────
let metricsInterval        = null;
let metricsTokenInterval   = null;  // refreshes Bearer token every 300 s
let metricsToken           = null;
let metricsBroadcast       = null;

// ── Super Speed Hearts state ──────────────────────────────────────────────────
// Session credentials are captured from the MeetMe WebContentsView when the
// user navigates to a live stream view URL.
// Captured replay of the exact likeBroadcast request the browser sent.
// Populated by onBeforeRequest + onBeforeSendHeaders in spoofMeetMeSession.
let heartsCaptured = null;  // { url, headers, body, sessionUrl }

let heartsRunning   = false;
let heartsTotalSent = 0;
let heartsTotalFail = 0;

// MeetMe likeBroadcast Parse Cloud Function endpoint
const LIKE_BROADCAST_URL = 'https://api.gateway.meetme-live.com/video-api/meetme/functions/sns-video:likeBroadcast';
// Parallel requests fired per burst — each of the HEARTS_LANES loops fires this many
const HEARTS_CONCURRENCY = 250;
// Number of independent concurrent loops — total in-flight = HEARTS_CONCURRENCY * HEARTS_LANES
const HEARTS_LANES = 5;

// ══════════════════════════════════════════════════════════════════════════════
// ── LICENSE SYSTEM ───────────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

/**
 * CONFIGURATION — point this at your running license server.
 * Change to your server's public URL before distributing.
 */
const LICENSE_SERVER_URL   = 'https://license.blunt.pics';
const LICENSE_CHECK_INTERVAL_MS = 30 * 60 * 1000; // re-validate every 30 min
const OFFLINE_GRACE_MS      = 48 * 60 * 60 * 1000; // allow offline for 48 h

/** safeStorage key file path — stores encrypted license key */
const LICENSE_FILE = () => path.join(app.getPath('userData'), '.moodbot_license');
/** Last successful validation timestamp file */
const LICENSE_TS_FILE = () => path.join(app.getPath('userData'), '.moodbot_license_ts');

let licenseValid    = false;  // in-memory flag — true once validated this session
let licenseTimer    = null;   // periodic re-validation interval handle

/**
 * Generate a stable hardware fingerprint for this machine.
 * Uses CPU model + total memory + OS platform + OS release, hashed to SHA-256.
 * Intentionally does NOT use MAC address (changes with VPN/adapters) or disk ID
 * (requires admin on some platforms).
 */
function getHWID() {
  const raw = [
    os.platform(),
    os.arch(),
    os.release(),
    os.cpus()?.[0]?.model ?? 'cpu',
    String(os.totalmem()),
    os.hostname(),
  ].join('|');
  return createHash('sha256').update(raw).digest('hex');
}

/** Read the stored (encrypted) license key, or null if none saved. */
function readStoredKey() {
  try {
    const file = LICENSE_FILE();
    if (!fs.existsSync(file)) return null;
    const buf = fs.readFileSync(file);
    return safeStorage.decryptString(buf);
  } catch (_) { return null; }
}

/** Persist the license key using OS-level encryption (safeStorage). */
function writeStoredKey(key) {
  try {
    const buf = safeStorage.encryptString(key);
    fs.writeFileSync(LICENSE_FILE(), buf);
  } catch (e) {
    console.error('[license] Failed to save key:', e.message);
  }
}

/** Delete the stored key file. */
function clearStoredKey() {
  try {
    const f = LICENSE_FILE();
    if (fs.existsSync(f)) fs.unlinkSync(f);
    const t = LICENSE_TS_FILE();
    if (fs.existsSync(t)) fs.unlinkSync(t);
  } catch (_) {}
}

/** Save the timestamp of the last successful online validation. */
function saveValidationTimestamp() {
  try { fs.writeFileSync(LICENSE_TS_FILE(), String(Date.now())); } catch (_) {}
}

/** Read the last successful online validation timestamp (ms), or 0. */
function readValidationTimestamp() {
  try { return parseInt(fs.readFileSync(LICENSE_TS_FILE(), 'utf8'), 10) || 0; } catch (_) { return 0; }
}

/**
 * Hit the license server.
 * Returns { ok, status, message, expiresAt } or null if the server is unreachable.
 */
async function callLicenseServer(endpoint, key, hwid) {
  try {
    const resp = await fetch(`${LICENSE_SERVER_URL}/api/${endpoint}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ key, hwid }),
      signal:  AbortSignal.timeout(8000),
    });
    return await resp.json();
  } catch (_) { return null; }   // server unreachable — handled by caller
}

/**
 * Full license check:
 *  1. Try online validation.
 *  2. If server unreachable, allow offline up to OFFLINE_GRACE_MS.
 * Returns { ok, message, offline } — ok=true means the app should run.
 */
async function checkLicense(key) {
  const hwid = getHWID();
  const result = await callLicenseServer('validate', key, hwid);

  if (result) {
    if (result.ok) {
      saveValidationTimestamp();
      return { ok: true, message: null, offline: false };
    }
    return { ok: false, message: result.message || 'License invalid.', offline: false };
  }

  // Server unreachable — check offline grace period
  const lastOk = readValidationTimestamp();
  const elapsed = Date.now() - lastOk;
  if (lastOk && elapsed < OFFLINE_GRACE_MS) {
    const hoursLeft = Math.ceil((OFFLINE_GRACE_MS - elapsed) / 3600000);
    return { ok: true, message: null, offline: true, hoursLeft };
  }

  return {
    ok: false,
    message: 'Cannot reach the MoodBot license server and your offline grace period has expired. Please check your internet connection.',
    offline: false,
  };
}

/**
 * Start a background interval that re-validates the license every 30 min.
 * If the check fails (key revoked, paused, expired), close the main window
 * and show the license gate again.
 */
function startLicenseMonitor(key) {
  if (licenseTimer) clearInterval(licenseTimer);
  licenseTimer = setInterval(async () => {
    const result = await checkLicense(key);
    if (!result.ok) {
      licenseValid = false;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('license:revoked', { message: result.message });
      }
    }
  }, LICENSE_CHECK_INTERVAL_MS);
}

// ══════════════════════════════════════════════════════════════════════════════
// ── END LICENSE SYSTEM ────────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Replay the exact likeBroadcast request that was captured from the browser.
 */
async function fireHeartsBurst() {
  if (!heartsRunning) return;
  if (!heartsCaptured?.url) return;   // waiting for user to hold hearts in stream tab

  // Fire HEARTS_CONCURRENCY requests in parallel each tick for maximum throughput.
  const results = await Promise.allSettled(
    Array.from({ length: HEARTS_CONCURRENCY }, () =>
      fetch(heartsCaptured.url, {
        method:  'POST',
        headers: heartsCaptured.headers,
        body:    heartsCaptured.body,
        signal:  AbortSignal.timeout(10000),
      })
    )
  );

  let loggedFailure = false;
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value.ok) {
      heartsTotalSent++;
    } else {
      heartsTotalFail++;
      if (!loggedFailure) {
        loggedFailure = true;
        if (r.status === 'fulfilled') {
          r.value.text().then(t => console.error(`[Hearts] HTTP ${r.value.status}: ${t}`)).catch(() => {});
        } else {
          console.error('[Hearts] fetch error:', r.reason);
        }
      }
    }
  }

  pushHeartsUpdate();
}

function pushHeartsUpdate() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('hearts:update', {
      running:    heartsRunning,
      totalSent:  heartsTotalSent,
      totalFail:  heartsTotalFail,
      sessionUrl: heartsCaptured?.sessionUrl ?? null,
    });
  }
}

function stopHearts() {
  heartsRunning = false;
  pushHeartsUpdate();
}

async function heartsLoop() {
  while (heartsRunning) {
    await fireHeartsBurst();
  }
}

function startHearts() {
  if (heartsRunning) stopHearts();
  heartsTotalSent = 0;
  heartsTotalFail = 0;
  heartsRunning   = true;
  pushHeartsUpdate();
  // Run HEARTS_LANES independent loops so new bursts fire while others await responses.
  for (let i = 0; i < HEARTS_LANES; i++) heartsLoop();
}

// Last volume level set for the YouTube view (0.0–1.0).
// Persisted in memory so every new video/navigation gets the same volume.
let ytLastVolume = 1;

// Set to true when the bot navigates the YouTube tab to a search URL so that
// autoPlaySearchResult knows it should auto-click the first result.
// Remains false for searches the user types manually in the YouTube search bar.
let ytBotSearchPending = false;

// ── Edge TTS ──────────────────────────────────────────────────────────────────
/** Cached voice list — fetched once, reused for all subsequent requests. */
let edgeTtsVoiceCache = null;
/** Single reusable MsEdgeTTS instance — avoids accumulating WebSocket/listener leaks. */
let edgeTtsInstance = null;
function getEdgeTts() {
  if (!edgeTtsInstance) edgeTtsInstance = new MsEdgeTTS();
  return edgeTtsInstance;
}

// ── Window ────────────────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'MoodBot',
    backgroundColor: '#0f172a',
    autoHideMenuBar: true,
    show: false,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      devTools: !app.isPackaged,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.webContents.setMaxListeners(20);

  if (app.isPackaged || !process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadFile(path.join(__dirname, 'dist/index.html'));
  } else {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
      .catch(() => mainWindow.loadFile(path.join(__dirname, 'dist/index.html')));
  }

  // Tell renderer to re-measure view placeholders on window resize
  mainWindow.on('resize', () => {
    if (mainWindow && !mainWindow.isDestroyed())
      mainWindow.webContents.send('view:request-resize');
  });

  mainWindow.on('closed', () => {
    views.forEach(v => { try { v.webContents.close(); } catch (_) {} });
    views.clear();
    mainWindow = null;
  });
}

// ── Strip X-Frame-Options / CSP so sites render inside the view ───────────────
function stripFrameHeaders(ses) {
  ses.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...details.responseHeaders };
    for (const key of Object.keys(headers)) {
      const l = key.toLowerCase();
      if (l === 'x-frame-options' || l === 'content-security-policy' || l === 'content-security-policy-report-only')
        delete headers[key];
    }
    callback({ responseHeaders: headers });
  });
}

// ── Ad-block URL patterns applied to the MeetMe session ──────────────────────
// (Checked inside spoofMeetMeSession's single onBeforeRequest handler — Electron
// only allows one onBeforeRequest per session; a second call overwrites the first.)
const AD_BLOCK_PATTERNS = new Set([
  'doubleclick.net',
  'googlesyndication.com',
  'adnxs.com',
  'ads.yahoo.com',
  'scorecardresearch.com',
  'moatads.com',
  'adsrvr.org',
  'rubiconproject.com',
  'pubmatic.com',
  'openx.net',
  'smartadserver.com',
  'taboola.com',
  'outbrain.com',
  'advertising.com',
  'adroll.com',
  'criteo.com',
  'revcontent.com',
]);

function isAdUrl(url) {
  try {
    const host = new URL(url).hostname;
    for (const pattern of AD_BLOCK_PATTERNS) {
      if (host === pattern || host.endsWith('.' + pattern)) return true;
    }
  } catch (_) {}
  return false;
}

// ── Spoof headers on the MeetMe session so it doesn't detect Electron ─────────
const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function spoofMeetMeSession() {
  const ses = session.fromPartition('persist:meetme');
  ses.setUserAgent(CHROME_UA, '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"');

  // Correlate body (onBeforeRequest) with headers (onBeforeSendHeaders) by requestId.
  // Both hooks fire for every request; we only care about likeBroadcast POSTs.
  const pendingBodies = new Map(); // requestId → raw body string

  // ── Single onBeforeRequest: ad-block + likeBroadcast body capture ─────────────
  // Electron only allows ONE onBeforeRequest listener per session — registering a
  // second one silently replaces the first. Both concerns live here.
  ses.webRequest.onBeforeRequest((details, callback) => {
    // Ad-block: cancel known ad network requests
    if (isAdUrl(details.url)) { callback({ cancel: true }); return; }

    // Body capture: store upload data for likeBroadcast POSTs so we can replay them
    if (details.url.includes('likeBroadcast')) {
      try {
        if (details.uploadData && details.uploadData.length > 0) {
          const chunk = details.uploadData[0];
          const raw   = chunk.bytes
            ? Buffer.from(chunk.bytes).toString('utf8')
            : (chunk.data || '');
          if (raw) pendingBodies.set(details.id, raw);
        }
      } catch (_) {}
    }

    callback({});
  });

  // ── UA spoof + sniff headers for metrics token + assemble heartsCaptured ─────
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    const h = { ...details.requestHeaders };
    for (const k of Object.keys(h)) {
      const l = k.toLowerCase();
      if (l === 'user-agent')                       h[k] = CHROME_UA;
      else if (l === 'sec-ch-ua')                   h[k] = '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"';
      else if (l === 'sec-ch-ua-full-version-list') h[k] = '"Google Chrome";v="131.0.6778.205", "Chromium";v="131.0.6778.205", "Not_A Brand";v="24.0.0.0"';
      else if (l === 'sec-ch-ua-platform')          h[k] = process.platform === 'darwin' ? '"macOS"' : process.platform === 'linux' ? '"Linux"' : '"Windows"';
    }

    if (details.url && details.url.includes('gateway.meetme-live.com')) {
      // Sniff Bearer token for metrics polling
      for (const k of Object.keys(h)) {
        if (k.toLowerCase() === 'authorization') {
          const val = h[k];
          if (typeof val === 'string' && val.startsWith('Bearer ') && val.length > 50)
            metricsToken = val.slice(7);
          break;
        }
      }

      // If this is a likeBroadcast POST, assemble the full captured replay object
      if (details.url.includes('likeBroadcast') && pendingBodies.has(details.id)) {
        let body = pendingBodies.get(details.id);
        pendingBodies.delete(details.id);

        // Strip headers the browser adds that Node fetch cannot/should not send
        const replayHeaders = {};
        for (const k of Object.keys(h)) {
          const l = k.toLowerCase();
          if (l === 'host' || l === 'content-length' ||
              l.startsWith('sec-fetch') || l.startsWith('sec-ch') ||
              l === 'user-agent' || l === 'connection') continue;
          replayHeaders[k] = h[k];
        }

        const ref = details.referrer || '';
        const sessionUrl = ref.includes('meetme-live.com/web-live/view/')
          ? ref.split('?')[0]
          : (heartsCaptured?.sessionUrl ?? null);

        heartsCaptured = { url: details.url, headers: replayHeaders, body, sessionUrl };
        pushHeartsUpdate();
      }
    }

    callback({ requestHeaders: h });
  });
}

// ── Suppress SSL errors for Microsoft's speech platform (Edge TTS WebSocket) ──
// net_error -201 (ERR_CERT_AUTHORITY_INVALID) can occur on restricted networks
// where the certificate chain for *.bing.com / speech.platform.bing.com is not
// trusted by Electron's verifier.  We only bypass validation for that host.
app.on('certificate-error', (_event, _webContents, url, _error, _cert, callback) => {
  if (url.includes('speech.platform.bing.com') || url.includes('.bing.com')) {
    callback(true);  // trust this cert
  } else {
    callback(false); // reject everything else normally
  }
});

app.whenReady().then(() => {
  // Spoof UA and strip frame headers before createWindow so hooks are
  // registered before any WebContentsView makes its first request.
  spoofMeetMeSession();
  stripFrameHeaders(session.defaultSession);
  stripFrameHeaders(session.fromPartition('persist:meetme'));
  stripFrameHeaders(session.fromPartition('persist:youtube'));

  // Allow the renderer to load MeetMe/Tagged CDN avatar images by spoofing
  // the Referer so the CDN doesn't reject the request as cross-origin.
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: ['*://*.tagged.com/*', '*://*.meetme.com/*', '*://*.meetmecdna.com/*'] },
    (details, callback) => {
      const h = { ...details.requestHeaders };
      h['Referer'] = 'https://app.meetme.com/';
      h['Origin']  = 'https://app.meetme.com';
      callback({ requestHeaders: h });
    }
  );

  Menu.setApplicationMenu(null);
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ── MeetMe live chat scraper ──────────────────────────────────────────────────
// Injected into the MeetMe WebContentsView whenever it lands on a /live/view/ page.
// Uses a MutationObserver to catch new chat nodes and buffers parsed messages in
// window.__mmChatBuffer so the drain loop (drainMeetMeChatBuffer) can collect them.

const SCRAPER_JS = `(function() {
  var SCRAPER_VERSION = 18;
  if (window.__mmScraperVersion === SCRAPER_VERSION) return;
  window.__mmScraperVersion = SCRAPER_VERSION;
  window.__mmScraperActive = true;
  window.__mmChatBuffer    = [];
  window.__mmSeenIds       = new Set();

  var PLACEHOLDER_NAMES = ['user avatar', 'user name', 'loading', ''];

  function isPlaceholder(name) {
    return !name || PLACEHOLDER_NAMES.indexOf(name.toLowerCase().trim()) !== -1;
  }

  // A "real" avatar URL points to a known CDN host; anything else (empty,
  // data:, blob:, or a relative icon path) is considered not-yet-loaded.
  function isRealAvatarUrl(url) {
    if (!url) return false;
    return (
      url.indexOf('img.tagged.com') !== -1 ||
      url.indexOf('img.meetme.com') !== -1 ||
      url.indexOf('meetmecdna.com') !== -1 ||
      url.indexOf('tagged.com/users/pictures') !== -1
    );
  }

  function imgSrc(el) {
    if (!el) return '';
    return (
      el.getAttribute('src') ||
      el.getAttribute('data-src') ||
      el.getAttribute('data-lazy-src') ||
      el.getAttribute('data-original') ||
      el.currentSrc ||
      el.src ||
      ''
    );
  }

  function resolveUrl(raw) {
    if (!raw) return '';
    try { return new URL(raw, location.href).href; } catch(_) { return raw; }
  }

  function extractFromNode(node) {
    // ── Avatar ──────────────────────────────────────────────────────────────
    var imgEl   = node.querySelector('.tmg-live-video-react-chat-message-image');
    var avatar  = resolveUrl(imgSrc(imgEl));
    var altText = imgEl ? (imgEl.getAttribute('alt') || '') : '';

    // ── Level ring color ────────────────────────────────────────────────────
    var imgHolder  = node.querySelector('.chat-avatar-img-holder');
    var levelColor = (imgHolder && imgHolder.style.borderColor) ? imgHolder.style.borderColor : '';
    if (!levelColor) {
      var colorEl = node.querySelector('[style*="--levels-group-current-color"]');
      if (colorEl) {
        var styleAttr = colorEl.getAttribute('style') || '';
        var cm = styleAttr.match(/--levels-group-current-color:\s*([^;]+)/);
        levelColor = cm ? cm[1].trim() : '';
      }
    }

    // ── Level number ────────────────────────────────────────────────────────
    var levelEl = node.querySelector('.level-number');
    var level   = levelEl ? (parseInt(levelEl.textContent, 10) || 1) : 1;

    // ── Username ────────────────────────────────────────────────────────────
    // MeetMe sets title="RealName" on the user-name span once React hydrates.
    // We also check .title-cell-name-holder and img alt.
    // If all three are placeholder/empty the cell hasn't hydrated yet.
    var userNameSpan = node.querySelector('[class*="tmg-live-video-user-name"]');
    var titleAttr    = userNameSpan ? (userNameSpan.getAttribute('title') || '').trim() : '';
    var nameEl       = node.querySelector('.title-cell-name-holder');
    var nameElText   = nameEl ? nameEl.textContent.trim() : '';
    var userName     = (!isPlaceholder(titleAttr)  ? titleAttr  :
                        !isPlaceholder(nameElText) ? nameElText :
                        !isPlaceholder(altText)    ? altText    : '');

    // ── Badges ──────────────────────────────────────────────────────────────
    var VIP_TIER_MAP = { '1': 'GREEN VIP', '2': 'PURPLE VIP', '3': 'BLACK VIP', '4': 'BOSS VIP' };
    var badges = [];

    // TOP BADGE
    if (node.querySelector('[class*="top-streamer"]')) badges.push('TOP BADGE');

    // BOUNCER
    var uSpan = node.querySelector('[class*="tmg-live-video-user-name"]');
    var uCls = uSpan ? uSpan.className : '';
    if (uCls.indexOf('user-bouncer') !== -1 || node.querySelector('span[class*="bouncer"], img[src*="bouncer"]')) badges.push('BOUNCER');

    // VIP — read alt attribute directly off the VIP img
    var vipImg = node.querySelector('img[alt^="tier"]');
    if (vipImg) {
      var vipAlt = vipImg.getAttribute('alt') || '';
      var tierNum = vipAlt.replace(/[^0-9]/g, '');
      if (VIP_TIER_MAP[tierNum]) badges.push(VIP_TIER_MAP[tierNum]);
    }

    // GIFTER
    if (node.querySelector('img[src*="gifter"], [class*="gifter"]')) badges.push('GIFTER');

    return { userName: userName, avatar: avatar, altText: altText,
             levelColor: levelColor, level: level,
             badge: badges[0] || '', badges: badges };
  }

  function buildMessage(node, id, timestamp, d) {
    if (!d) d = extractFromNode(node);

    var nodeCls  = node.className || '';
    var isWelcome = nodeCls.includes('chat-welcome-cell') || node.id === 'TMGWelcomeMessageId';
    var isModBot  = nodeCls.includes('chat-modbot-cell')  || node.id === 'TMGModBotMessageId';
    var isJoin    = nodeCls.includes('join-cell') || !!node.querySelector('.tmg-live-video-user-joined');
    var isGift    = !!node.querySelector('.tmg-live-video-gift-text');
    var isFollow  = !!node.querySelector('.tmg-live-video-favorite-message');

    var text = '', msgType = 'chat', giftName;

    if (isWelcome || isModBot) {
      var warnImg = node.querySelector('img.warning');
      var raw = node.textContent.trim();
      text    = warnImg ? raw.replace(warnImg.alt || '', '').trim() : raw;
      msgType = 'system';
    } else if (isJoin) {
      // Try the extracted username first; if missing, parse it from the raw cell text.
      var name = d.userName;
      if (!name) {
        var rawText = node.textContent ? node.textContent.trim() : '';
        var joinMatch = rawText.match(/^(.+?)\s+joined the stream/i);
        name = (joinMatch && joinMatch[1]) ? joinMatch[1].trim() : 'Viewer';
      }
      text    = name + ' joined the stream';
      msgType = 'join';
    } else if (isGift) {
      var giftEl = node.querySelector('.tmg-live-video-gift-text');
      text     = giftEl ? giftEl.textContent.trim() : '';
      msgType  = 'gift';
      giftName = text;
    } else if (isFollow) {
      var favEl = node.querySelector('.tmg-live-video-favorite-message');
      text    = favEl ? favEl.textContent.trim() : '';
      msgType = 'follow';
    } else {
      var msgEl = node.querySelector('.tmg-live-video-react-chat-message:not([class*="user-name"])');
      text    = msgEl ? msgEl.textContent.trim() : '';
      msgType = 'chat';
    }

    if (!text) return null;

    // Detect PK battle: MeetMe adds team-blue / team-red class markers on chat
    // cells during a battle. Check the node's outerHTML for these markers.
    var nodeHtml = (node.outerHTML || '').toLowerCase();
    var inBattle = nodeHtml.includes('team-blue') || nodeHtml.includes('team-red');

    // Track battle state transitions so chat messages carry the correct inBattle flag.
    // System notices are handled exclusively in App.tsx to avoid duplicates.
    if (msgType === 'chat') {
      if (inBattle && !window.__mmInBattle) {
        window.__mmInBattle = true;
      } else if (!inBattle && window.__mmInBattle) {
        window.__mmInBattle = false;
      }
    }


    // ── Badges already parsed by extractFromNode — use them directly ──
    var badges = d.badges || [];

    var resolvedName = (isJoin && name) ? name : (d.userName || 'Viewer');
    return {
      id:        id,
      text:      text,
      timestamp: timestamp,
      type:      msgType,
      giftName:  giftName,
      inBattle:  inBattle,

      user: {
        id:         id + '_u',
        name:       resolvedName,
        avatar:     d.avatar,
        level:      d.level,
        levelColor: d.levelColor,
        badge:      badges[0] || '',
        badges:     badges,
        isVIP:      badges.some(function(b) { return b.includes('VIP'); }),
      },
    };
  }

  // All cells: React sets the avatar src asynchronously after DOM insertion.
  // Retry up to 8 × 150 ms (1.2 s total) until we see a real CDN URL for
  // the avatar AND a non-placeholder name, then push the final message.
  function scheduleWithRetry(node, id, timestamp, attemptsLeft) {
    setTimeout(function() {
      var d = extractFromNode(node);
      var hasBadgesContainer = !!node.querySelector('[class*="badges-container"]');
      var needsRetry = (isPlaceholder(d.userName) || !isRealAvatarUrl(d.avatar) || (hasBadgesContainer && !d.badgesHtml))
                       && attemptsLeft > 1;
      if (needsRetry) {
        scheduleWithRetry(node, id, timestamp, attemptsLeft - 1);
        return;
      }
      var msg = buildMessage(node, id, timestamp, d);
      if (msg) window.__mmChatBuffer.push(msg);
    }, 150);
  }

  function parseNode(node) {
    if (!node || node.nodeType !== 1) return null;
    if (!node.classList || !node.classList.contains('chat-cell')) return null;

    var id = (node.id || '').replace('ChatMessage_', '') ||
             ('gen_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7));
    if (window.__mmSeenIds.has(id)) return null;
    window.__mmSeenIds.add(id);

    var timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    // Always defer — every cell type needs React to finish hydrating the avatar src
    scheduleWithRetry(node, id, timestamp, 8);
    return null;
  }

  // Build a system message synchronously from a welcome/modbot node —
  // these are fully rendered at mount time and must appear first.
  function parseSystemNode(node) {
    var id = node.id || ('sys_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7));
    if (window.__mmSeenIds.has(id)) return null;
    window.__mmSeenIds.add(id);
    var warnImg = node.querySelector('img.warning');
    var raw     = node.textContent.trim();
    var text    = warnImg ? raw.replace(warnImg.alt || '', '').trim() : raw;
    if (!text) return null;
    return {
      id:        id,
      text:      text,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      type:      'system',
      user:      { id: id + '_u', name: 'System', avatar: '', level: 1, levelColor: '', badge: '' },
    };
  }

  function snapshotExisting() {
    var container = document.querySelector('[id^="ChatHistoryContainer_"]');
    if (!container) return;

    // Build the two pinned system notices synchronously so they are always
    // first in the buffer regardless of when the retry-deferred chat messages land.
    var pinned = [];
    ['TMGWelcomeMessageId', 'TMGModBotMessageId'].forEach(function(pid) {
      var el = container.querySelector('#' + pid);
      if (!el) return;
      var msg = parseSystemNode(el);
      if (msg) pinned.push(msg);
    });

    // Prepend pinned messages in order (Welcome, then ModBot)
    for (var i = pinned.length - 1; i >= 0; i--) {
      window.__mmChatBuffer.unshift(pinned[i]);
    }

    // Schedule the rest with normal retry logic (skips the pinned IDs — already in __mmSeenIds)
    container.querySelectorAll('.chat-cell').forEach(function(node) {
      parseNode(node); // pushes asynchronously via scheduleWithRetry
    });
  }

  var __mmChatObserver = null;
  var __mmContainerAttached = false; // tracks whether the observer is live

  function attachToContainer(container, isReattach) {
    if (__mmChatObserver) { try { __mmChatObserver.disconnect(); } catch(_) {} }

    // Notify the renderer whenever the chat DOM detaches and reattaches.
    if (isReattach) {
      window.__mmChatBuffer.push({
        id: 'sys_reattach_' + Date.now(),
        text: '🔄 Chat observer reattached to the stream DOM.',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        type: 'system',
        user: { id: 'sys_reattach', name: 'System', avatar: '', level: 1, levelColor: '', badge: '' },
      });
    }

    __mmContainerAttached = true;
    snapshotExisting();
    __mmChatObserver = new MutationObserver(function(mutations) {
      mutations.forEach(function(m) {
        m.addedNodes.forEach(function(n) {
          var msg = parseNode(n);
          if (msg) window.__mmChatBuffer.push(msg);
        });
      });
    });
    __mmChatObserver.observe(container, { childList: true });
  }

  // Watch a stable ancestor for the ChatHistoryContainer to appear/reappear
  // (e.g. when entering or leaving a PK battle MeetMe swaps the entire chat DOM).
  // Watch document.body (always stable) for ChatHistoryContainer to appear,
  // disappear, or be replaced — this covers PK battle DOM swaps at any depth.
  function watchForContainer() {
    var bodyObserver = new MutationObserver(function() {
      var container = document.querySelector('[id^="ChatHistoryContainer_"]');
      if (container) {
        if (container !== window.__mmLastChatContainer) {
          var wasAttached = __mmContainerAttached;
          window.__mmLastChatContainer = container;
          attachToContainer(container, wasAttached);
        }
      } else {
        // Container is gone (battle transition or DOM swap).
        if (__mmContainerAttached) {
          __mmContainerAttached = false;
          window.__mmLastChatContainer = null; // reset so re-insertion triggers reattach
          window.__mmChatBuffer.push({
            id: 'sys_detach_' + Date.now(),
            text: '⚠️ Chat observer lost DOM connection — waiting to reattach...',
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            type: 'system',
            user: { id: 'sys_detach', name: 'System', avatar: '', level: 1, levelColor: '', badge: '' },
          });
        }
      }
    });
    bodyObserver.observe(document.body, { childList: true, subtree: true });
  }

  function attachObserver() {
    var container = document.querySelector('[id^="ChatHistoryContainer_"]');
    if (!container) { setTimeout(attachObserver, 1000); return; }
    window.__mmLastChatContainer = container;
    attachToContainer(container);
    watchForContainer(); // anchored to document.body — survives any DOM swap
  }

  attachObserver();
})();`;

// Walk the WebFrameMain tree and return all frames whose URL contains the needle.
function findFrames(rootFrame, urlNeedle) {
  const results = [];
  function walk(frame) {
    try {
      if (frame.url && frame.url.includes(urlNeedle)) results.push(frame);
      for (const child of frame.frames) walk(child);
    } catch (_) {}
  }
  walk(rootFrame);
  return results;
}

function getLiveGatewayFrames(view) {
  if (!view || !view.webContents || view.webContents.isDestroyed()) return [];
  try {
    const root = view.webContents.mainFrame;
    if (!root) return [];
    // Primary host: api.gateway.meetme-live.com  (may also appear as tagged.com gateway)
    const frames = findFrames(root, 'meetme-live.com');
    if (frames.length) return frames;
    // Fallback: any frame that isn't the top-level app.meetme.com shell
    return findFrames(root, 'gateway');
  } catch (_) {
    return [];
  }
}

function stopMeetMeChatScraper() {
  if (mainWindow && !mainWindow.isDestroyed())
    mainWindow.webContents.send('meetme:scraper-status', { active: false });
}

// Re-entrancy guard: if a previous drain tick's executeJavaScript promise resolves
// after the next tick has already started, we don't double-drain the same frame.
let _drainBusy = false;

function drainMeetMeChatBuffer(view) {
  if (_drainBusy) return;
  if (!view || view.webContents.isDestroyed() || !mainWindow || mainWindow.isDestroyed()) return;

  const frames = getLiveGatewayFrames(view);
  if (frames.length === 0) return;

  _drainBusy = true;
  const EXPECTED_VERSION = 18;
  const versionCheck = `window.__mmScraperVersion || 0`;
  const drain = '(function(){ var b = window.__mmChatBuffer || []; window.__mmChatBuffer = []; return b; })()';
  const promises = frames.map(frame => {
    try {
      return frame.executeJavaScript(versionCheck).then(ver => {
        if (ver !== EXPECTED_VERSION) {
          return frame.executeJavaScript('window.__mmScraperVersion = null;')
            .then(() => frame.executeJavaScript(SCRAPER_JS))
            .catch(() => {});
        }
        return frame.executeJavaScript(drain).then(msgs => {
          if (!Array.isArray(msgs) || msgs.length === 0) return;
          msgs.forEach(msg => {
            if (!mainWindow || mainWindow.isDestroyed()) return;
            mainWindow.webContents.send('meetme:chat-message', msg);
          });
        }).catch(() => {});
      }).catch(() => {});
    } catch (_) { return Promise.resolve(); }
  });
  Promise.allSettled(promises).then(() => { _drainBusy = false; });
}

// ── IPC: create or reposition a WebContentsView ───────────────────────────────
ipcMain.handle('view:create-or-update', async (_e, { viewId, partition, bounds }) => {
  if (!mainWindow) return;

  let view = views.get(viewId);

  if (view && view.webContents.isDestroyed()) {
    try { mainWindow.contentView.removeChildView(view); } catch (_) {}
    views.delete(viewId);
    view = null;
  }

  if (!view) {
    view = new WebContentsView({
      webPreferences: {
        partition: partition || 'persist:default',
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        // Bake the Chrome UA in at the webContents level so it is used from
        // the very first request, before any session onBeforeSendHeaders fires
        ...(viewId === 'meetme' ? { userAgent: CHROME_UA } : {}),
        // Prevent Chromium from throttling timers/WebSockets when the view is
        // hidden (zero bounds) so the stream viewer session stays alive while
        // the user is on another tab and hearts are running.
        backgroundThrottling: false,
      },
    });
    views.set(viewId, view);

    // Keep all navigations inside the view
    view.webContents.setWindowOpenHandler(({ url: u }) => {
      view.webContents.loadURL(u).catch(() => {});
      return { action: 'deny' };
    });

    // ── MeetMe-specific hooks ─────────────────────────────────────────────────
    if (viewId === 'meetme') {
      const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

      let drainInterval  = null;
      let injectTimer    = null; // covers both the initial delay AND the retry loop
      let scraperActive  = false;

      function isLiveViewUrl(url) {
        return typeof url === 'string' && url.includes('/live/view/');
      }

      function startDrain() {
        if (drainInterval) return;
        drainInterval = setInterval(() => drainMeetMeChatBuffer(view), 50);
      }
      function stopDrain() {
        if (drainInterval) { clearInterval(drainInterval); drainInterval = null; }
      }

      // Try to inject into the iframe frame; retries every 1 s until found or cancelled.
      function tryInject() {
        injectTimer = null;
        if (!scraperActive) return; // was cancelled
        if (view.webContents.isDestroyed()) return;

        const frames = getLiveGatewayFrames(view);
        if (frames.length === 0) {
          // Iframe not ready yet — retry
          injectTimer = setTimeout(tryInject, 1000);
          return;
        }

        frames.forEach(frame => {
          try {
            frame.executeJavaScript('window.__mmScraperVersion = null;')
              .then(function() { return frame.executeJavaScript(SCRAPER_JS); })
              .catch(() => {});
          } catch (_) {}
        });

        if (mainWindow && !mainWindow.isDestroyed())
          mainWindow.webContents.send('meetme:scraper-status', { active: true });

        startDrain();
      }

      function activateScraper() {
        if (injectTimer) { clearTimeout(injectTimer); injectTimer = null; }
        scraperActive = true;
        // 2 s initial delay so the SPA + iframe have time to mount
        injectTimer = setTimeout(tryInject, 2000);
      }

      function deactivateScraper() {
        scraperActive = false;
        if (injectTimer) { clearTimeout(injectTimer); injectTimer = null; }
        stopDrain();
        stopMeetMeChatScraper();
      }

      const HIDE_UI_CSS = `
        #main > div.flex.h-full.w-full.flex-col > header {
          display: none !important;
        }
      `;

      const HIDE_BANNER_CSS = `
        #main > div.self-center.h-\\[90px\\].max-w-full.w-full.sm\\:max-w-\\[728px\\] {
          display: none !important;
        }
      `;

      function injectHideBanner() {
        view.webContents.executeJavaScript(`
          (function() {
            var id = '__mb_hide_banner';
            if (document.getElementById(id)) return;
            var s = document.createElement('style');
            s.id = id;
            s.textContent = ${JSON.stringify(HIDE_BANNER_CSS)};
            document.head.appendChild(s);
          })();
        `).catch(() => {});
      }

      function injectHideUI() {
        view.webContents.executeJavaScript(`
          (function() {
            var id = '__mb_hide_ui';
            if (document.getElementById(id)) return;
            var s = document.createElement('style');
            s.id = id;
            s.textContent = ${JSON.stringify(HIDE_UI_CSS)};
            document.head.appendChild(s);
          })();
        `).catch(() => {});
      }

      // Track the current stream URL so the UI shows which stream is active.
      // Real credentials are captured lazily from the first likeBroadcast intercept.
      function captureHeartsSessionUrl(url) {
        if (typeof url !== 'string' || !url.includes('meetme-live.com/web-live/view/')) return;
        const clean = url.split('?')[0];
        if (!extractBroadcastId(clean)) return;
        // Keep heartsCaptured in sync with the current stream URL
        if (heartsCaptured) {
          heartsCaptured = { ...heartsCaptured, sessionUrl: clean };
        } else {
          // No capture yet — store a placeholder so the UI shows the stream is ready
          heartsCaptured = { url: null, headers: null, body: null, sessionUrl: clean };
        }
        pushHeartsUpdate();
      }

      // Single did-finish-load handler: UA spoof + mute + hide UI + scraper check
      view.webContents.on('did-finish-load', () => {
        view.webContents.setAudioMuted(true);
        view.webContents.executeJavaScript(
          `Object.defineProperty(navigator,'userAgent',{get:()=>${JSON.stringify(UA)}});`
        ).catch(() => {});

        injectHideBanner();
        injectHideUI();
        const url = view.webContents.getURL();
        captureHeartsSessionUrl(url);
        if (isLiveViewUrl(url)) {
          activateScraper();
          // Auto-start metrics polling whenever we land on a new stream
          const bid = extractBroadcastId(url);
          if (bid && bid !== metricsBroadcast) startMetricsPolling(bid);
        } else {
          deactivateScraper();
          stopMetricsPolling();
          resetMetricsInRenderer();
        }
      });

      // MeetMe is a React SPA — stream navigations arrive as pushState changes
      view.webContents.on('did-navigate-in-page', (_event, url) => {
        injectHideBanner();
        injectHideUI();
        captureHeartsSessionUrl(url);
        if (isLiveViewUrl(url)) {
          activateScraper();
          const bid = extractBroadcastId(url);
          if (bid && bid !== metricsBroadcast) startMetricsPolling(bid);
        } else {
          deactivateScraper();
          stopMetricsPolling();
          resetMetricsInRenderer();
        }
      });

      // Full cross-origin navigation (e.g. leaving MeetMe entirely)
      view.webContents.on('did-navigate', (_event, url) => {
        view.webContents.setAudioMuted(true);
        if (!isLiveViewUrl(url)) {
          deactivateScraper();
          stopMetricsPolling();
          resetMetricsInRenderer();
        }
      });

      view.webContents.on('destroyed', () => { deactivateScraper(); stopMetricsPolling(); });
    }

    if (viewId === 'youtube') {
      // Poll the YouTube tab's document.title every 2 s and forward it to the renderer.
      // YouTube sets the title to the currently playing video/song name while it plays.
      let ytTitleInterval = null;
      let ytEndedInterval = null; // fast poll dedicated to the ended flag
      let lastYtTitle = '';
      let ytVideoEndedFired = false;

      // Send the video-ended IPC event exactly once per video, then reset the flag.
      const fireVideoEnded = () => {
        if (ytVideoEndedFired) return;
        ytVideoEndedFired = true;
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('youtube:video-ended');
        }
      };

      // Inject an 'ended' event listener into the current watch page so we catch
      // the end of a video immediately — before YouTube's autoplay can replace the
      // video element and clear video.ended, which the 2-second poll would miss.
      const injectEndedListener = () => {
        if (view.webContents.isDestroyed()) return;
        const url = view.webContents.getURL();
        if (!url.includes('youtube.com/watch')) return;
        view.webContents.executeJavaScript(`
          (function() {
            // Always re-wire on each new watch page. In-page SPA navigations reuse
            // the same window object, so reset the guard flag each time so the
            // listener attaches to the new video element.
            window.__moodbot_ended_wired__ = true;
            var v = document.querySelector('video');
            if (!v) return;
            v.addEventListener('ended', function() {
              // Use a dedicated window flag instead of document.title so YouTube's
              // autoplay title update cannot overwrite it before the poll reads it.
              window.__moodbot_video_ended__ = true;
            }, { once: true });
          })();
        `).catch(() => {});
      };

      let lastYtVideoId = '';

      const startPolling = () => {
        if (ytTitleInterval) clearInterval(ytTitleInterval);
        if (ytEndedInterval) clearInterval(ytEndedInterval);
        ytVideoEndedFired = false;

        // Fast poll (200 ms) — only checks the ended flag so the queue advances
        // immediately when a video finishes rather than waiting up to 2 seconds.
        ytEndedInterval = setInterval(() => {
          if (view.webContents.isDestroyed()) { clearInterval(ytEndedInterval); return; }
          view.webContents.executeJavaScript(
            '(function(){ var f = !!window.__moodbot_video_ended__; if (f) window.__moodbot_video_ended__ = false; return f; })()'
          ).then(flag => {
            if (flag) fireVideoEnded();
          }).catch(() => {});
        }, 200);

        // Slow poll (2 s) — updates the now-playing title and resets the ended flag
        // when a new video starts (covers video.ended for pages without the listener).
        // Also extracts the current video ID from the URL so the Now Playing thumbnail
        // always reflects whatever is playing in the YouTube tab, even manual plays.
        let lastYtPaused = null; // null = unknown initial state

        ytTitleInterval = setInterval(() => {
          if (view.webContents.isDestroyed()) { clearInterval(ytTitleInterval); return; }
          view.webContents.executeJavaScript(
            '(function(){ var v = document.querySelector("video"); return { title: document.title, ended: v ? v.ended : null, paused: v ? v.paused : null, url: location.href }; })()'
          ).then(({ title, ended, paused, url }) => {
            // video.ended fallback for pages where the injected listener didn't fire
            if (ended === true) {
              fireVideoEnded();
            }

            // New video started — reset the ended-fired flag so we can detect its end
            if (typeof title === 'string' && title !== lastYtTitle) {
              lastYtTitle = title;
              ytVideoEndedFired = false;
              if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('youtube:now-playing', title);
              }
            }

            // Track the real play/pause state of the YouTube video element and
            // forward changes to the renderer so isPlayingMusicRef stays in sync
            // even when the user pauses/resumes directly inside the YouTube player.
            if (typeof paused === 'boolean' && paused !== lastYtPaused) {
              lastYtPaused = paused;
              if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('youtube:play-state', { paused });
              }
            }

            // Extract videoId from URL and send thumbnail update whenever it changes
            if (typeof url === 'string') {
              const vidMatch = url.match(/[?&]v=([A-Za-z0-9_-]{11})/);
              const videoId = vidMatch ? vidMatch[1] : '';
              if (videoId && videoId !== lastYtVideoId) {
                lastYtVideoId = videoId;
                if (mainWindow && !mainWindow.isDestroyed()) {
                  mainWindow.webContents.send('youtube:thumbnail-update', videoId);
                }
              }
            }
          }).catch(() => {});
        }, 2000);
      };

      // Auto-click the first video result when a bot-initiated song-request search lands.
      // Retries up to 6 times (at 1 s intervals) to handle slow page renders.
      // Does NOT fire for searches the user types manually in the YouTube search bar.
      const autoPlaySearchResult = (attempt = 0) => {
        if (view.webContents.isDestroyed()) return;
        const url = view.webContents.getURL();
        if (!url.includes('/results?search_query=')) return;
        // Only auto-click when the bot triggered this search.
        if (!ytBotSearchPending) return;
        view.webContents.executeJavaScript(`
          (function() {
            // Try multiple selectors to handle different YouTube layout variants.
            var selectors = [
              'ytd-video-renderer a#thumbnail',
              'ytd-rich-item-renderer ytd-video-renderer a#thumbnail',
              'ytd-rich-item-renderer a#thumbnail',
              'ytd-video-renderer a#video-title',
              'ytd-rich-item-renderer a#video-title',
              '#contents ytd-video-renderer:first-of-type a',
              'a#video-title[href*="watch"]'
            ];
            for (var i = 0; i < selectors.length; i++) {
              var link = document.querySelector(selectors[i]);
              if (link && link.href && link.href.includes('watch')) { link.click(); return true; }
            }
            return false;
          })();
        `).then(clicked => {
          if (clicked) {
            // Bot search was handled — clear the flag so subsequent manual
            // searches are not auto-clicked.
            ytBotSearchPending = false;
          } else if (attempt < 6) {
            // Renderer hasn't painted results yet — retry after 1 s (up to 6 times)
            setTimeout(() => autoPlaySearchResult(attempt + 1), 1000);
          } else {
            // Exhausted retries — clear the flag regardless.
            ytBotSearchPending = false;
          }
        }).catch(() => { ytBotSearchPending = false; });
      };

      // Extract videoId + duration once a watch page loads and send to renderer.
      // Retries up to maxRetries times if the video element isn't ready yet.
      const sendVideoMetadata = (retries = 0) => {
        if (view.webContents.isDestroyed()) return;
        const url = view.webContents.getURL();
        const match = url.match(/[?&]v=([A-Za-z0-9_-]{11})/);
        if (!match) return;
        const videoId = match[1];
        view.webContents.executeJavaScript(`
          (function() {
            var v = document.querySelector('video');
            return v && isFinite(v.duration) && v.duration > 0 ? v.duration : null;
          })();
        `).then(rawDuration => {
          if (rawDuration === null && retries < 5) {
            // Video element not ready yet — retry after 1 s
            setTimeout(() => sendVideoMetadata(retries + 1), 1000);
            return;
          }
          let durationStr = '';
          if (typeof rawDuration === 'number' && rawDuration > 0) {
            const total = Math.round(rawDuration);
            const h = Math.floor(total / 3600);
            const m = Math.floor((total % 3600) / 60);
            const s = total % 60;
            durationStr = h > 0
              ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
              : `${m}:${String(s).padStart(2,'0')}`;
          }
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('youtube:video-metadata', { videoId, duration: durationStr });
          }
        }).catch(() => {});
      };

      // Inject a volume guard that intercepts HTMLMediaElement.prototype.volume
      // at the prototype level so YouTube's player JS can never bypass it.
      // Using a prototype defineProperty means:
      //   - No volumechange event listener feedback loop (main stutter cause)
      //   - No polling interval fighting YouTube's internal resets
      //   - Volume persists across song changes and player re-inits automatically
      //   - Mid-session slider changes just update window.__mbVolTarget; the setter
      //     intercept picks it up on the next YouTube-side write with zero lag
      const injectVolumeGuard = () => {
        if (view.webContents.isDestroyed()) return;
        const vol = ytLastVolume;
        view.webContents.executeJavaScript(`
          (function() {
            // Idempotent: only install the prototype intercept once per page.
            // Re-running just updates the target volume and re-applies it to any
            // existing video element.
            window.__mbVolTarget = ${vol};

            if (!window.__mbVolGuardInstalled) {
              window.__mbVolGuardInstalled = true;

              // Grab the native descriptor from the prototype chain ONCE.
              var proto = HTMLMediaElement.prototype;
              var nativeDesc = Object.getOwnPropertyDescriptor(proto, 'volume');

              Object.defineProperty(proto, 'volume', {
                configurable: true,
                enumerable:   nativeDesc ? nativeDesc.enumerable : true,
                get: function() {
                  return nativeDesc ? nativeDesc.get.call(this) : this._mbVol;
                },
                set: function(v) {
                  // Clamp to our target if this element is a VIDEO and we have
                  // an active target.  Allow muted=true writes through unchanged
                  // so YouTube's internal mute logic still works.
                  var target = window.__mbVolTarget;
                  if (this.tagName === 'VIDEO' && typeof target === 'number' && !this.muted) {
                    v = target;
                  }
                  if (nativeDesc) {
                    nativeDesc.set.call(this, v);
                  } else {
                    this._mbVol = v;
                  }
                }
              });
            }

            // Forcibly apply the target to any video already in the DOM.
            // We call the native descriptor's set directly to bypass our own
            // intercept (which would just clamp to the same value anyway).
            var v = document.querySelector('video');
            if (v && !v.muted) {
              try {
                var d = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'volume');
                if (d && d.set) d.set.call(v, window.__mbVolTarget);
              } catch(_) {}
            }
          })();
        `).catch(() => {});
      };

      view.webContents.on('did-finish-load', () => { startPolling(); autoPlaySearchResult(); sendVideoMetadata(); setTimeout(injectEndedListener, 500); injectVolumeGuard(); });
      view.webContents.on('did-navigate', () => { startPolling(); injectVolumeGuard(); });
      view.webContents.on('did-navigate-in-page', (_ev, url) => { autoPlaySearchResult(); setTimeout(() => sendVideoMetadata(), 1500); setTimeout(injectEndedListener, 500); injectVolumeGuard(); });
      view.webContents.on('destroyed', () => {
        if (ytTitleInterval) clearInterval(ytTitleInterval);
        if (ytEndedInterval) clearInterval(ytEndedInterval);
      });
    }

    try { mainWindow.contentView.addChildView(view); } catch (_) {}

    // If a view:navigate arrived before this view existed, load it now
    if (pendingUrls.has(viewId)) {
      const queued = pendingUrls.get(viewId);
      pendingUrls.delete(viewId);
      view.webContents.loadURL(queued).catch(() => {});
    }
  }

  // Reposition
  if (bounds) {
    const b = {
      x:      Math.round(bounds.x),
      y:      Math.round(bounds.y),
      width:  Math.max(0, Math.round(bounds.width)),
      height: Math.max(0, Math.round(bounds.height)),
    };
    view.setBounds(b);
    if (b.width > 0 && b.height > 0) {
      try { mainWindow.contentView.addChildView(view); } catch (_) {}
    } else if (viewId === 'youtube') {
      // Keep the YouTube view attached even when hidden (0×0 bounds) so its
      // renderer stays alive and YouTube's own JS keeps updating document.title.
      // Removing it from the hierarchy suspends the renderer, which stops title
      // updates and breaks the now-playing / song-name polling.
      try { mainWindow.contentView.addChildView(view); } catch (_) {}
    } else {
      try { mainWindow.contentView.removeChildView(view); } catch (_) {}
    }
  }
});

// ── IPC: bring a view to the front of the child stack ────────────────────────
ipcMain.handle('view:bring-to-front', async (_e, { viewId }) => {
  if (!mainWindow) return;
  const view = views.get(viewId);
  if (view && !view.webContents.isDestroyed()) {
    try { mainWindow.contentView.removeChildView(view); } catch (_) {}
    try { mainWindow.contentView.addChildView(view); } catch (_) {}
  }
});

// ── IPC: navigate an existing view to a new URL ───────────────────────────────
ipcMain.handle('view:navigate', async (_e, { viewId, url }) => {
  if (!url) return;
  // Mark that the bot is initiating this YouTube search so autoPlaySearchResult
  // knows to auto-click the first result (manual user searches must not be auto-clicked).
  if (viewId === 'youtube' && url.includes('/results?search_query=')) {
    ytBotSearchPending = true;
  }
  const view = views.get(viewId);
  if (view && !view.webContents.isDestroyed()) {
    view.webContents.loadURL(url).catch(() => {});
  } else {
    pendingUrls.set(viewId, url);
  }
});

// ── IPC: destroy a view ───────────────────────────────────────────────────────
ipcMain.handle('view:destroy', async (_e, { viewId }) => {
  const view = views.get(viewId);
  if (view) {
    try { mainWindow?.contentView.removeChildView(view); } catch (_) {}
    try { view.webContents.close(); } catch (_) {}
    views.delete(viewId);
  }
});

// ── IPC: smooth volume ramp inside the YouTube page ──────────────────────────
// A single IPC call that runs the entire fade inside the page using
// requestAnimationFrame — no repeated IPC round-trips, no stutter.
ipcMain.handle('youtube:ramp-volume', async (_e, { from, to, durationMs }) => {
  const view = views.get('youtube');
  const clampedTo = Math.max(0, Math.min(1, to));
  ytLastVolume = clampedTo; // persist the destination across navigations
  if (!view || view.webContents.isDestroyed()) return;
  view.webContents.executeJavaScript(`
    (function() {
      var from = ${Math.max(0, Math.min(1, from))};
      var to   = ${clampedTo};
      var dur  = ${Math.max(0, durationMs)};

      // Cancel any previous in-page ramp before starting a new one.
      if (window.__mbRampCancel) { window.__mbRampCancel(); window.__mbRampCancel = null; }

      window.__mbVolTarget = to;

      if (dur <= 0) {
        // Instant apply — use the native setter directly.
        var d = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'volume');
        var v = document.querySelector('video');
        if (v) {
          v.muted = false;
          if (d && d.set) d.set.call(v, to); else v.volume = to;
        }
        return;
      }

      var start = null;
      var cancelled = false;
      window.__mbRampCancel = function() { cancelled = true; };

      function step(ts) {
        if (cancelled) return;
        if (start === null) start = ts;
        var progress = Math.min((ts - start) / dur, 1);
        var current = from + (to - from) * progress;
        window.__mbVolTarget = current;

        var vid = document.querySelector('video');
        if (vid) {
          vid.muted = false;
          var desc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'volume');
          if (desc && desc.set) desc.set.call(vid, current); else vid.volume = current;
        }

        if (progress < 1) {
          requestAnimationFrame(step);
        } else {
          window.__mbVolTarget = to;
          window.__mbRampCancel = null;
        }
      }
      requestAnimationFrame(step);
    })();
  `).catch(() => {});
});

// ── IPC: set YouTube video element volume (0.0–1.0) ──────────────────────────
// Injects JS into the YouTube WebContentsView to adjust the <video> volume.
ipcMain.handle('youtube:set-volume', async (_e, { volume }) => {
  const view = views.get('youtube');
  const clamped = Math.max(0, Math.min(1, volume));
  ytLastVolume = clamped; // persist across navigations
  if (!view || view.webContents.isDestroyed()) return;
  // Update the in-page target. The prototype-level intercept will enforce
  // this value on the next YouTube-side volume write. We also directly
  // apply it to the current video element so the change takes effect
  // immediately without waiting for YouTube to touch volume again.
  view.webContents.executeJavaScript(`
    (function() {
      window.__mbVolTarget = ${clamped};
      var v = document.querySelector('video');
      if (v) {
        v.muted = false;
        // Use the native setter directly to avoid re-triggering our intercept.
        var d = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'volume');
        if (d && d.set) { d.set.call(v, ${clamped}); }
        else { v.volume = ${clamped}; }
      }
    })();
  `).catch(() => {});
});

// ── IPC: pause YouTube video ──────────────────────────────────────────────────
ipcMain.handle('youtube:pause', async () => {
  const view = views.get('youtube');
  if (!view || view.webContents.isDestroyed()) return;
  view.webContents.executeJavaScript(
    '(function(){ var v = document.querySelector("video"); if (v) v.pause(); })();'
  ).catch(() => {});
});

// ── IPC: play/resume YouTube video ───────────────────────────────────────────
ipcMain.handle('youtube:play', async () => {
  const view = views.get('youtube');
  if (!view || view.webContents.isDestroyed()) return;
  // v.play() alone is blocked by YouTube's internal "user-paused" state flag.
  // Clicking the player's own play button (or dispatching a 'k' keydown) goes
  // through YouTube's player state machine and reliably resumes playback.
  view.webContents.executeJavaScript(`
    (function() {
      var v = document.querySelector('video');
      if (!v) return;
      if (!v.paused) return; // already playing — nothing to do
      // First try clicking YouTube's play button so its internal state updates.
      var btn = document.querySelector('.ytp-play-button');
      if (btn && btn.getAttribute('data-title-no-tooltip') !== 'Pause') {
        btn.click();
        return;
      }
      // Fallback: dispatch a synthetic 'k' keydown on the player element.
      // YouTube maps 'k' to toggle play/pause via its own event listener.
      var player = document.querySelector('#movie_player') || document.body;
      var evt = new KeyboardEvent('keydown', { key: 'k', keyCode: 75, bubbles: true });
      player.dispatchEvent(evt);
    })();
  `).catch(() => {});
});

// ── IPC: send a chat message into the live MeetMe stream ─────────────────────
// Walks every frame in the meetme WebContentsView, finds the one that contains
// the MeetMe chat action bar, sets the input value (React-compatible), and
// clicks the send button.
ipcMain.handle('bot:send-chat', async (_e, text) => {
  const view = views.get('meetme');
  if (!view || view.webContents.isDestroyed()) return { ok: false, error: 'no meetme view' };

  // Build a flat list of every WebFrameMain in the tree
  function allFrames(root) {
    const out = [];
    function walk(f) {
      try {
        out.push(f);
        for (const c of f.frames) walk(c);
      } catch (_) {}
    }
    walk(root);
    return out;
  }

  const js = `(function(msg) {
    var INPUT_SEL  = '#TMGChatMessagesActionBar_TextInput';
    var BUTTON_SEL = '#TMGChatMessagesActionBar_Form > div.action-bar-icons-group___rHqnq > button.action-button-send-chat-msg___sUkaw.action-button-send-chat-msg___Vj_Aw';

    var input = document.querySelector(INPUT_SEL);
    if (!input) return 'input not found';

    var tag = input.tagName.toLowerCase();

    if (tag === 'input' || tag === 'textarea') {
      // Use native React setter so synthetic onChange fires
      var proto = tag === 'textarea'
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
      var setter = Object.getOwnPropertyDescriptor(proto, 'value');
      if (setter && setter.set) {
        setter.set.call(input, msg);
      } else {
        input.value = msg;
      }
      input.dispatchEvent(new Event('input',  { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (input.isContentEditable) {
      input.focus();
      document.execCommand('selectAll', false, null);
      document.execCommand('insertText', false, msg);
    } else {
      input.value = msg;
      input.dispatchEvent(new Event('input',  { bubbles: true }));
    }

    // Let React flush state, then click the send button
    setTimeout(function() {
      var btn = document.querySelector(BUTTON_SEL);
      if (btn) {
        btn.removeAttribute('disabled');
        btn.click();
        return;
      }
      // Fallback: submit the parent form
      var form = document.querySelector('#TMGChatMessagesActionBar_Form');
      if (form) {
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        return;
      }
      // Last resort: press Enter on the input
      input.dispatchEvent(new KeyboardEvent('keydown',  { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keyup',    { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
    }, 100);

    return 'ok';
  })(${JSON.stringify(text)})`;

  // Walk every frame in the tree — the chat input may live in the live gateway
  // iframe (meetme-live.com) or directly in the top-level app.meetme.com shell.
  const frames = allFrames(view.webContents.mainFrame);
  for (const frame of frames) {
    try {
      const result = await frame.executeJavaScript(js);
      if (result === 'ok') return { ok: true };
    } catch (_) {}
  }

  return { ok: false, error: 'input not found in any frame' };
});

// ── IPC: Edge TTS — get voice list ───────────────────────────────────────────
// Returns the full list of Microsoft Edge neural TTS voices (300+).
// Result is cached in memory after the first network fetch.
ipcMain.handle('tts:get-voices', async () => {
  if (edgeTtsVoiceCache) return edgeTtsVoiceCache;
  try {
    const voices = await getEdgeTts().getVoices();
    edgeTtsVoiceCache = voices;
    return voices;
  } catch (err) {
    console.error('[EdgeTTS] Failed to fetch voices:', err);
    return [];
  }
});

// ── IPC: Edge TTS — synthesise text to MP3 buffer ────────────────────────────
// Accepts { text, voiceShortName, rate, pitch } and returns an MP3 Buffer.
// rate and pitch are floats (0.5–1.5); converted to SSML "+X%" prosody strings.
ipcMain.handle('tts:speak', async (_e, { text, voiceShortName, rate = 1.0, pitch = 1.0 }) => {
  try {
    const tts = getEdgeTts();
    const voice = voiceShortName || 'en-US-AriaNeural';

    // Convert 0.5–1.5 scale to SSML "+X%" format (1.0 → "+0%", 1.5 → "+50%", 0.5 → "-50%")
    const toPercent = (v) => {
      const pct = Math.round((v - 1.0) * 100);
      return pct >= 0 ? `+${pct}%` : `${pct}%`;
    };

    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3, {});
    const { audioStream } = tts.toStream(text, {
      rate: toPercent(rate),
      pitch: toPercent(pitch),
    });

    // Collect all MP3 chunks into a single Buffer
    const chunks = [];
    await new Promise((resolve, reject) => {
      audioStream.on('data', (chunk) => chunks.push(chunk));
      audioStream.on('end', resolve);
      audioStream.on('error', reject);
    });

    return Buffer.concat(chunks);
  } catch (err) {
    console.error('[EdgeTTS] Synthesis failed:', err);
    return null;
  }
});

// ── MeetMe broadcast metrics polling ─────────────────────────────────────────
// Polls https://api.gateway.meetme-live.com/video-metadata/broadcast/{id}
// every 5 seconds and forwards currentViewers / totalLikes to the renderer.

/**
 * Extract the broadcast objectId from a MeetMe live-view URL.
 * e.g. https://app.meetme.com/live/view/f6vzbtTxUo   → "f6vzbtTxUo"
 *      https://api.gateway.meetme-live.com/web-live/view/f6vzbtTxUo/following → "f6vzbtTxUo"
 */
function extractBroadcastId(url) {
  if (!url) return null;
  const m = url.match(/\/view\/([A-Za-z0-9]{8,12})/);
  return m ? m[1] : null;
}

/**
 * Exchange a Firebase session token for a MeetMe API Bearer token.
 * The Firebase ID token is grabbed from the `persist:meetme` cookie store.
 */
async function fetchMeetMeToken() {
  // Pull the Firebase ID token out of the meetme session cookies.
  // MeetMe stores it as a cookie named "id_token" or we read it from localStorage
  // via the meetme WebContentsView.
  const view = views.get('meetme');
  if (!view || view.webContents.isDestroyed()) return null;

  let firebaseToken = null;
  try {
    // Try reading from the in-page localStorage key MeetMe uses ("firebase_id_token")
    firebaseToken = await view.webContents.executeJavaScript(
      `(function(){
        try { return window.localStorage.getItem('firebase_id_token') || window.localStorage.getItem('id_token') || null; }
        catch(_){ return null; }
       })()`
    ).catch(() => null);
  } catch (_) {}

  if (!firebaseToken) {
    // Fallback: read from session cookies
    try {
      const cookies = await session.fromPartition('persist:meetme').cookies.get({ url: 'https://app.meetme.com' });
      const idCookie = cookies.find(c => c.name === 'id_token' || c.name === 'firebase_id_token');
      if (idCookie) firebaseToken = idCookie.value;
    } catch (_) {}
  }

  if (!firebaseToken) return null;

  try {
    const body = new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      subject_token: firebaseToken,
      subject_token_type: 'urn:ietf:params:oauth:token-type:session',
    });

    const resp = await fetch('https://auth.gateway.meetme-live.com/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/x-www-form-urlencoded',
        // MeetMe public OAuth2 client_id:client_secret ("meetme:secret") — this is the
        // well-known public client credential baked into the MeetMe web app itself and is
        // safe to ship.  It is NOT a private/secret MoodBot credential.
        'Authorization': 'Basic bWVldG1lOnNlY3JldA==',
        'x-brand':       'meetme',
        'x-device':      'web',
        'x-user-agent':  'meetme/1.0.0 web/4.3.3',
        'User-Agent':    CHROME_UA,
        'Origin':        'https://app.meetme.com',
        'Referer':       'https://app.meetme.com/',
      },
      body: body.toString(),
    });

    if (!resp.ok) return null;
    const json = await resp.json();
    return json.access_token || null;
  } catch (err) {
    console.warn('[MeetMe] OAuth token exchange failed:', err.message);
    return null;
  }
}

/** Poll the video-metadata endpoint and send results to the renderer. */
async function pollBroadcastMetrics() {
  if (!metricsBroadcast || !mainWindow || mainWindow.isDestroyed()) return;

  // If the sniffed token is missing, try fetching it via the OAuth exchange.
  if (!metricsToken) {
    metricsToken = await fetchMeetMeToken();
    if (!metricsToken) return; // still unavailable — skip this tick
  }

  try {
    const resp = await fetch(
      `https://api.gateway.meetme-live.com/video-metadata/broadcast/${metricsBroadcast}`,
      {
        headers: {
          'Accept':        'application/json',
          'Authorization': `Bearer ${metricsToken}`,
          'x-brand':       'meetme',
          'x-device':      'web',
          'x-user-agent':  'meetme/1.0.0 web/4.3.3',
          'User-Agent':    CHROME_UA,
          'Origin':        'https://api.gateway.meetme-live.com',
          'Referer':       `https://api.gateway.meetme-live.com/web-live/view/${metricsBroadcast}/following?hostAppName=meetme&hostAppVersion=1.0.0`,
        },
      }
    );

    if (resp.status === 401) {
      // Token expired — refresh immediately and retry once
      metricsToken = await fetchMeetMeToken();
      if (!metricsToken) return;
      const retry = await fetch(
        `https://api.gateway.meetme-live.com/video-metadata/broadcast/${metricsBroadcast}`,
        {
          headers: {
            'Accept':        'application/json',
            'Authorization': `Bearer ${metricsToken}`,
            'x-brand':       'meetme',
            'x-device':      'web',
            'x-user-agent':  'meetme/1.0.0 web/4.3.3',
            'User-Agent':    CHROME_UA,
            'Origin':        'https://api.gateway.meetme-live.com',
            'Referer':       `https://api.gateway.meetme-live.com/web-live/view/${metricsBroadcast}/following?hostAppName=meetme&hostAppVersion=1.0.0`,
          },
        }
      );
      if (!retry.ok) return;
      const retryData = await retry.json();
      const retryResult = retryData?.broadcast?.result;
      if (!retryResult) return;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('bot:metrics', {
          currentViewers:              retryResult.currentViewers              ?? null,
          totalViewers:                retryResult.totalViewers                ?? null,
          totalLikes:                  retryResult.totalLikes                  ?? null,
          totalDiamonds:               retryResult.totalDiamonds               ?? null,
          broadcasterLifetimeDiamonds: retryResult.broadcasterLifetimeDiamonds ?? null,
          lifetimeFollowers:           retryResult.lifetimeFollowers           ?? null,
          streamTitle:                 retryResult.streamDescription           ?? null,
        });
      }
      return;
    }

    if (!resp.ok) return;

    const data = await resp.json();
    const result = data?.broadcast?.result;
    if (!result) return;

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('bot:metrics', {
        currentViewers:              result.currentViewers              ?? null,
        totalViewers:                result.totalViewers                ?? null,
        totalLikes:                  result.totalLikes                  ?? null,
        totalDiamonds:               result.totalDiamonds               ?? null,
        broadcasterLifetimeDiamonds: result.broadcasterLifetimeDiamonds ?? null,
        lifetimeFollowers:           result.lifetimeFollowers           ?? null,
        streamTitle:                 result.streamDescription           ?? null,
      });
    }
  } catch (err) {
    console.warn('[MeetMe] Metrics poll failed:', err.message);
    if (err.message && err.message.includes('401')) metricsToken = null;
  }
}

function stopMetricsPolling() {
  if (metricsInterval) {
    clearInterval(metricsInterval);
    metricsInterval = null;
  }
  if (metricsTokenInterval) {
    clearInterval(metricsTokenInterval);
    metricsTokenInterval = null;
  }
  metricsBroadcast = null;
  // Keep metricsToken — the sniffed Bearer token is still valid for other streams
}

function startMetricsPolling(broadcastId) {
  stopMetricsPolling();
  metricsBroadcast = broadcastId;

  // Kick off an immediate token fetch so the very first poll tick has a token,
  // even if the MeetMe page hasn't fired any gateway requests yet.
  fetchMeetMeToken().then(tok => { if (tok) metricsToken = tok; });

  // Poll immediately, then every 5 s for viewers / hearts.
  // Also schedule retries at 1 s and 3 s so the first real result arrives quickly
  // after the MeetMe iframe fires its first gateway request and the token is captured.
  pollBroadcastMetrics();
  setTimeout(pollBroadcastMetrics, 1000);
  setTimeout(pollBroadcastMetrics, 3000);
  metricsInterval = setInterval(pollBroadcastMetrics, 5000);

  // Proactively refresh the Bearer token every 300 s so it never goes stale.
  metricsTokenInterval = setInterval(async () => {
    const tok = await fetchMeetMeToken();
    if (tok) metricsToken = tok;
  }, 300_000);
}

// ── IPC: bot:connect ──────────────────────────────────────────────────────────
// Navigates the MeetMe view to the stream URL and starts the metrics polling
// loop. Returns { success, broadcastId } to the renderer.
ipcMain.handle('bot:connect', async (_e, { email, password, streamUrl }) => {
  const targetUrl = streamUrl || 'https://app.meetme.com/live/search/trending/all';

  // Navigate the meetme view to the stream
  const view = views.get('meetme');
  if (view && !view.webContents.isDestroyed()) {
    view.webContents.loadURL(targetUrl).catch(() => {});
  } else {
    pendingUrls.set('meetme', targetUrl);
  }

  // Extract broadcast ID and start polling (token is sniffed from live requests)
  const broadcastId = extractBroadcastId(targetUrl);
  if (broadcastId) startMetricsPolling(broadcastId);

  return { success: true, broadcastId: broadcastId || null };
});

// ── Helper: push zeroed-out metrics to the renderer (stream left / disconnected) ─
function resetMetricsInRenderer() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('bot:metrics', {
      currentViewers: 0,
      totalViewers:   0,
      totalLikes:     0,
      totalDiamonds:  0,
      streamTitle:    '',
    });
  }
}

// ── IPC: bot:disconnect ───────────────────────────────────────────────────────
ipcMain.handle('bot:disconnect', async () => {
  stopMetricsPolling();
  stopHearts();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setTitle('MoodBot');
  }
  resetMetricsInRenderer();
  return { success: true };
});

// ── IPC: gifts:get-catalog ────────────────────────────────────────────────────
// Fetches the MeetMe live gift catalogue using the sniffed Bearer token.
// Paginates automatically until all gifts are collected (up to 5 pages / 500 items).
/** Normalise a gift data.json entry into a MeetMeGift shape the UI expects. */
function normaliseLocalGift(g) {
  const CDN_BASE      = 'https://assets.video.kik-live.com/images/gifts';
  const LOTTIE_BASE   = 'https://assets.video.kik-live.com';
  const RIVE_BASE     = 'https://assets.video.meetme-live.com/images/gifts/rive';
  const rawUrl        = g.imageUrl || '';
  // Prepend CDN base only when the URL is already relative (starts with /)
  const imageUrl = rawUrl.startsWith('http') ? rawUrl : `${CDN_BASE}${rawUrl}`;
  // Flatten categories array → single string for the filter UI
  const category = Array.isArray(g.categories) && g.categories.length > 0
    ? g.categories[0]
    : (g.category || '');
  // Resolve lottie URLs (paths start with /lottie/...)
  const lottieList = Array.isArray(g.lottieList)
    ? g.lottieList.map(p => p.startsWith('http') ? p : `${LOTTIE_BASE}${p}`)
    : [];
  // Resolve rive URL (just a bare filename like "hot_dog_cowboy.riv")
  let riveAnimation = null;
  if (g.riveAnimation && g.riveAnimation.src) {
    const src = g.riveAnimation.src;
    riveAnimation = { ...g.riveAnimation, src: src.startsWith('http') ? src : `${RIVE_BASE}/${src}` };
  }
  // Resolve CDN paths inside wheel options animations.
  // Each option may have multiple animation entries: animations[0] is typically a
  // wheel-specific transition overlay (often not cached), while animations[1+] are
  // the standalone prize animations (usually cached in lottie_cache).
  // We sort each option's animations so cached files come first, ensuring the
  // renderer's first-match lookup always finds a playable animation without a CDN fetch.
  const lottieUnpackedDir = unpackedPath('lottie_cache');
  const options = Array.isArray(g.options)
    ? g.options.map(opt => {
        const resolved = Array.isArray(opt.animations)
          ? opt.animations.map(anim => ({
              ...anim,
              lottie: anim.lottie
                ? (anim.lottie.startsWith('http') ? anim.lottie : `${LOTTIE_BASE}${anim.lottie}`)
                : null,
              rive: anim.rive
                ? (anim.rive.startsWith('http') ? anim.rive : `${RIVE_BASE}/${anim.rive}`)
                : null,
            }))
          : [];
        // Sort: cached lotties first so the renderer's .find(a => a.lottie) picks one
        // that loads instantly without a CDN round-trip.
        resolved.sort((a, b) => {
          const isCached = (url) => {
            if (!url || !url.includes('/lottie/')) return false;
            const basename = url.split('/lottie/').pop().split('?')[0];
            try { return fs.existsSync(path.join(lottieUnpackedDir, `lottie_${basename}`)); } catch { return false; }
          };
          return isCached(b.lottie) - isCached(a.lottie);
        });
        return { ...opt, animations: resolved };
      })
    : [];
  return { ...g, imageUrl, category, lottieList, riveAnimation, options };
}

ipcMain.handle('gifts:get-catalog', async () => {
  // Always try to load from the local gift data.json first so previews always show.
  const localDataPath = unpackedPath('gift data.json');
  let localGifts = [];
  try {
    const raw = fs.readFileSync(localDataPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      localGifts = parsed.map(normaliseLocalGift);
    }
  } catch (err) {
    console.warn('[MeetMe] Could not read local gift data.json:', err.message);
  }

  // If we have a token, also try the live API and merge/replace.
  if (!metricsToken) {
    metricsToken = await fetchMeetMeToken();
  }

  if (!metricsToken) {
    // No auth — return local data (always works offline / before login)
    if (localGifts.length > 0) return { success: true, gifts: localGifts };
    return { success: false, error: 'No auth token available', gifts: [] };
  }

  const allGifts = [];
  let cursor     = null;
  let pages      = 0;
  const MAX_PAGES = 5;

  try {
    do {
      const url = cursor
        ? `https://api.gateway.meetme-live.com/live/gifts/catalog?cursor=${encodeURIComponent(cursor)}`
        : 'https://api.gateway.meetme-live.com/live/gifts/catalog';

      const resp = await fetch(url, {
        headers: {
          'Accept':        'application/json',
          'Authorization': `Bearer ${metricsToken}`,
          'x-brand':       'meetme',
          'x-device':      'web',
          'x-user-agent':  'meetme/1.0.0 web/4.3.3',
          'User-Agent':    CHROME_UA,
          'Origin':        'https://api.gateway.meetme-live.com',
          'Referer':       'https://api.gateway.meetme-live.com/',
        },
      });

      if (resp.status === 401) {
        metricsToken = await fetchMeetMeToken();
        break;
      }
      if (!resp.ok) break;

      const data = await resp.json();
      // Response shape: { result: { gifts: [...], nextCursor?: string } }
      const gifts  = data?.result?.gifts || data?.gifts || [];
      cursor       = data?.result?.nextCursor || data?.nextCursor || null;
      allGifts.push(...gifts);
      pages++;
    } while (cursor && pages < MAX_PAGES);

    // If live API returned gifts, normalise and use them; otherwise fall back to local.
    if (allGifts.length > 0) return { success: true, gifts: allGifts.map(normaliseLocalGift) };
    return { success: true, gifts: localGifts };
  } catch (err) {
    console.warn('[MeetMe] Gift catalog fetch failed:', err.message);
    // Fall back to local data on network error
    if (localGifts.length > 0) return { success: true, gifts: localGifts };
    return { success: false, error: err.message, gifts: [] };
  }
});

// ── IPC: hearts:start ─────────────────────────────────────────────────────────
ipcMain.handle('hearts:start', async () => {
  startHearts();
  return { success: true, sessionUrl: heartsCaptured?.sessionUrl ?? null };
});

// ── IPC: hearts:stop ──────────────────────────────────────────────────────────
ipcMain.handle('hearts:stop', async () => {
  stopHearts();
  return { success: true, totalSent: heartsTotalSent, totalFail: heartsTotalFail };
});

// ── IPC: hearts:status ────────────────────────────────────────────────────────
ipcMain.handle('hearts:status', async () => {
  return {
    running:    heartsRunning,
    totalSent:  heartsTotalSent,
    totalFail:  heartsTotalFail,
    sessionUrl: heartsCaptured?.sessionUrl ?? null,
  };
});

// ── IPC: assets:fetch ─────────────────────────────────────────────────────────
// Proxies lottie JSON and rive .riv asset fetches through the main process so
// the renderer (running on file://) is not blocked by cross-origin restrictions.
// Returns { ok: true, data: <base64 string>, mimeType: string }
//      or { ok: false, error: string }
ipcMain.handle('assets:fetch', async (_e, url) => {
  // Check the local lottie_cache folder first.
  // URLs like https://assets.video.kik-live.com/lottie/foo.json
  // are cached as lottie_cache/lottie_foo.json
  if (typeof url === 'string' && url.includes('/lottie/')) {
    try {
      const basename   = url.split('/lottie/').pop().split('?')[0]; // e.g. "foo.json"
      const cachedPath = unpackedPath('lottie_cache', `lottie_${basename}`);
      if (fs.existsSync(cachedPath)) {
        const data = fs.readFileSync(cachedPath);
        return { ok: true, data: data.toString('base64'), mimeType: 'application/json' };
      }
    } catch (_) {}
  }

  try {
    // Derive the origin from the URL so the Referer/Origin match the host being fetched.
    let fetchOrigin = 'https://assets.video.kik-live.com';
    try {
      const parsed = new URL(url);
      fetchOrigin = parsed.origin;
    } catch (_) {}

    // Use Electron net.fetch with the MeetMe session so CDN requests carry
    // the session cookies (the CDN blocks plain Node fetch with 403).
    const ses = session.fromPartition('persist:meetme');
    const resp = await net.fetch(url, {
      session: ses,
      headers: {
        'Accept':     '*/*',
        'User-Agent': CHROME_UA,
        'Referer':    'https://app.meetme.com/',
        'Origin':     'https://app.meetme.com',
      },
    });
    if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}` };
    const buffer   = await resp.arrayBuffer();
    const base64   = Buffer.from(buffer).toString('base64');
    const mimeType = resp.headers.get('content-type') || 'application/octet-stream';

    // Persist lottie JSON files into lottie_cache so future loads are instant.
    if (typeof url === 'string' && url.includes('/lottie/') &&
        (mimeType.includes('json') || mimeType.includes('octet'))) {
      try {
        const basename   = url.split('/lottie/').pop().split('?')[0];
        const cachedPath = unpackedPath('lottie_cache', `lottie_${basename}`);
        if (!fs.existsSync(cachedPath)) {
          fs.writeFileSync(cachedPath, Buffer.from(buffer));
        }
      } catch (_) {}
    }

    return { ok: true, data: base64, mimeType };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// ── IPC: resolve the initial URL for the MeetMe tab ──────────────────────────
// Returns the trending/live page if the session has a valid auth cookie,
// otherwise falls back to the standard homepage.
ipcMain.handle('meetme:initial-url', async () => {
  const TRENDING = 'https://app.meetme.com/live/search/trending/all';
  const HOMEPAGE = 'https://app.meetme.com';
  try {
    const cookies = await session.fromPartition('persist:meetme').cookies.get({ url: 'https://app.meetme.com' });
    const loggedIn = cookies.some(c => c.name === 'id_token' || c.name === 'firebase_id_token');
    return loggedIn ? TRENDING : HOMEPAGE;
  } catch (_) {
    return HOMEPAGE;
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// ── LICENSE IPC HANDLERS ─────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

/**
 * license:check
 * Called by the renderer on startup to check if a valid key is already stored.
 * Returns { ok, storedKey } — if ok=true the app should open normally, if false
 * the license gate should be shown.
 */
ipcMain.handle('license:check', async () => {
  const key = readStoredKey();
  if (!key) return { ok: false, storedKey: null };

  const result = await checkLicense(key);
  if (result.ok) {
    licenseValid = true;
    startLicenseMonitor(key);
    return { ok: true, storedKey: key, offline: result.offline, hoursLeft: result.hoursLeft };
  }
  // Key exists but is now invalid (revoked/paused/expired) — clear it
  if (!result.offline) clearStoredKey();
  return { ok: false, storedKey: key, message: result.message };
});

/**
 * license:activate
 * Called when the user submits a new key on the activation screen.
 * Hits /api/activate to bind HWID, then saves key to safeStorage.
 */
ipcMain.handle('license:activate', async (_e, { key }) => {
  if (!key || typeof key !== 'string') return { ok: false, message: 'Invalid key.' };
  const hwid = getHWID();
  const result = await callLicenseServer('activate', key.trim().toUpperCase(), hwid);

  if (!result) return { ok: false, message: 'Cannot reach the license server. Check your internet connection.' };
  if (!result.ok) return { ok: false, message: result.message };

  // Save key encrypted in userData
  writeStoredKey(key.trim().toUpperCase());
  saveValidationTimestamp();
  licenseValid = true;
  startLicenseMonitor(key.trim().toUpperCase());

  return { ok: true, expiresAt: result.expiresAt };
});

/**
 * license:clear
 * Removes the stored key and flags so the license gate shows on next launch.
 */
ipcMain.handle('license:clear', async () => {
  if (licenseTimer) { clearInterval(licenseTimer); licenseTimer = null; }
  licenseValid = false;
  clearStoredKey();
  return { ok: true };
});

/**
 * license:hwid
 * Returns the machine's HWID so admin can look it up if needed.
 */
ipcMain.handle('license:hwid', async () => ({ hwid: getHWID() }));


// ══════════════════════════════════════════════════════════════════════════════
// ── AUTO-UPDATER ──────────────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

/**
 * electron-updater checks https://update.blunt.pics/latest.yml on startup.
 * If a newer version is available it downloads in the background and notifies
 * the renderer, which shows an "Update available — restart to install" banner.
 *
 * IPC events sent to renderer:
 *   updater:checking          — check started
 *   updater:available  { version, releaseNotes }
 *   updater:not-available     — already on latest
 *   updater:progress   { percent, bytesPerSecond, total, transferred }
 *   updater:downloaded { version } — ready to install
 *   updater:error      { message }
 *
 * IPC handlers callable from renderer:
 *   updater:check    — manually trigger a check
 *   updater:install  — quit and install downloaded update
 */

function setupAutoUpdater() {
  // Only run in packaged builds — skip in dev
  if (!app.isPackaged) return;

  autoUpdater.autoDownload    = true;   // download silently in background
  autoUpdater.autoInstallOnAppQuit = true; // install on next normal quit

  function send(channel, data) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, data ?? null);
    }
  }

  autoUpdater.on('checking-for-update',       ()    => send('updater:checking'));
  autoUpdater.on('update-available',          (info) => send('updater:available',     { version: info.version, releaseNotes: info.releaseNotes ?? null }));
  autoUpdater.on('update-not-available',      ()    => send('updater:not-available'));
  autoUpdater.on('download-progress',         (p)   => send('updater:progress',       { percent: Math.round(p.percent), bytesPerSecond: p.bytesPerSecond, total: p.total, transferred: p.transferred }));
  autoUpdater.on('update-downloaded',         (info) => send('updater:downloaded',    { version: info.version }));
  autoUpdater.on('error',                     (err) => send('updater:error',          { message: err?.message ?? String(err) }));

  // Check on startup (slight delay so the window is ready)
  setTimeout(() => autoUpdater.checkForUpdates(), 5000);
}

// Wire up after app is ready (called from app.whenReady handler above)
app.whenReady().then(() => setupAutoUpdater());

// ── Updater IPC ───────────────────────────────────────────────────────────────

ipcMain.handle('updater:check', async () => {
  if (!app.isPackaged) return { ok: false, message: 'Dev mode — updater disabled.' };
  try { await autoUpdater.checkForUpdates(); return { ok: true }; }
  catch (e) { return { ok: false, message: e.message }; }
});

ipcMain.handle('updater:install', () => {
  autoUpdater.quitAndInstall(false, true);
});
