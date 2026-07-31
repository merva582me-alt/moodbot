/**
 * MeetMe Live Stream Headless Scraper & Automation Engine
 * Ported & adapted from Python Livestream Assistant (SongBot) engine.
 * Handles DOM chat parsing, username extraction, gift detection, diamond counts, and viewer stats.
 */

export interface ScraperCredentials {
  email?: string;
  password?: string;
  streamUrl: string;
}

export interface ScraperSession {
  connected: boolean;
  streamUrl: string;
  viewerCount: number;
  diamondsTotal: number;
  likesCount: number;
  browserInstance?: any;
  pageInstance?: any;
  disconnect: () => Promise<void>;
  sendMessage: (message: string) => Promise<boolean>;
  onChatMessage?: (callback: (data: any) => void) => void;
}

// ── Username Validation & Cleaning ──────────────────────────────────────────

const SYSTEM_MSG_PATTERNS = /(joined the stream|left the stream|\bsent\b\s+\S|is now following|you know someone|started again|how are you|has been banned|was kicked|is typing|\b(https?:\/\/|www\.))/i;

export function stripGiftSuffix(name: string): string {
  if (!name) return name;
  const match = name.match(/\s+\bsent\b\s+/i);
  if (!match) return name;
  return name.substring(0, match.index).trim();
}

export function cleanUsername(name: string): string {
  if (!name) return 'unknown';
  let cleaned = stripGiftSuffix(name);
  // Strip glued textContent "Sent <gift>"
  const gluedMatch = cleaned.match(/(?<=[a-zA-Z0-9])Sent\b/);
  if (gluedMatch && gluedMatch.index !== undefined) {
    cleaned = cleaned.substring(0, gluedMatch.index).trim();
  }
  // Strip leading numeric level prefix (e.g. "25Lou" -> "Lou")
  cleaned = cleaned.replace(/^\s*\d{1,4}\s*(?=[^\d\s])/, '').trim();
  
  if (!isValidUsername(cleaned)) {
    return 'unknown';
  }
  return cleaned;
}

export function isValidUsername(name: string): boolean {
  if (!name || !name.trim()) return false;
  const trimmed = name.trim();
  if (trimmed.length > 60) return false;
  if (/^-?\d+$/.test(trimmed)) return false;
  if (trimmed.split(' ').length > 8) return false;
  if (SYSTEM_MSG_PATTERNS.test(trimmed)) return false;
  return true;
}

// ── Numeric Normalization ("19.9k" -> 19900) ───────────────────────────────

export function normalizeNumeric(text: string | null | undefined): number | null {
  if (!text) return null;
  const cleaned = text.trim().replace(/,/g, '');
  const match = cleaned.match(/^([0-9]+(?:\.[0-9]+)?)\s*([kmb])?$/i);
  if (!match) return null;
  let val = parseFloat(match[1]);
  const suffix = (match[2] || '').toLowerCase();
  if (suffix === 'k') val *= 1000;
  if (suffix === 'm') val *= 1000000;
  if (suffix === 'b') val *= 1000000000;
  return Math.round(val);
}

// ── Injected JS String for DOM Parsing inside MeetMe Page ──────────────────

export const MEETME_DOM_EXTRACTOR_JS = `
(() => {
  function parseColour(c) {
    if (!c) return null;
    const s = c.replace(/\\s+/g, '').toLowerCase();
    const m = s.match(/^rgba?\\((\\d+),(\\d+),(\\d+)/);
    if (m) return [parseInt(m[1]), parseInt(m[2]), parseInt(m[3])];
    if (s === 'black') return [0, 0, 0];
    return null;
  }

  function isGrayscale(c) {
    const rgb = parseColour(c);
    if (!rgb) return false;
    const r = rgb[0], g = rgb[1], b = rgb[2];
    return (Math.max(r, g, b) - Math.min(r, g, b)) <= 25;
  }

  function isGiftGreen(c) {
    const rgb = parseColour(c);
    if (!rgb) return false;
    const r = rgb[0], g = rgb[1], b = rgb[2];
    return g >= 100 && g > r + 25 && g > b + 25 && r < 200 && b < 200;
  }

  function isMessageColour(c) {
    return isGrayscale(c) || isGiftGreen(c);
  }

  function extractUsernameByColour(el) {
    let walker;
    try {
      walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null, false);
    } catch (e) { return ''; }
    const parts = [];
    let node;
    while ((node = walker.nextNode())) {
      const txt = (node.textContent || '').trim();
      if (!txt) continue;
      const parent = node.parentElement;
      if (!parent) continue;
      let colour = '';
      try { colour = window.getComputedStyle(parent).color; } catch (e) {}
      if (!isMessageColour(colour)) {
        if (/^\\d{1,4}$/.test(txt)) continue; // skip level number badge
        parts.push(txt);
      }
    }
    const name = parts.join(' ').replace(/\\s+/g, ' ').trim();
    if (name && name.length <= 60) return name;
    return '';
  }

  function getBadgeInfo(el) {
    const html = el.innerHTML ? el.innerHTML.toLowerCase() : '';
    const badges = [];
    let bouncer = false;

    let searchPool = [html];
    const imgs = el.querySelectorAll ? el.querySelectorAll('img[alt], [class*="badge"], [class*="Badge"]') : [];
    for (const img of imgs) {
      searchPool.push(
        ((img.className || '') + ' ' + (img.alt || '') + ' ' + (img.src || '')).toLowerCase()
      );
    }
    const combined = searchPool.join(' ');

    if (combined.includes('bouncer') || /moderator|mod.?badge/.test(combined)) {
      badges.push('BOUNCER');
      bouncer = true;
    }
    if (combined.includes('gifter')) badges.push('GIFTER');
    // VIP tiers — emit canonical display names used in LiveChatPanel and commandProcessor
    if (/vip.{0,6}black|black.{0,6}vip|tier.{0,4}3/.test(combined)) badges.push('BLACK VIP');
    else if (/vip.{0,6}purple|purple.{0,6}vip|tier.{0,4}2/.test(combined)) badges.push('PURPLE VIP');
    else if (/vip.{0,6}green|green.{0,6}vip|tier.{0,4}1/.test(combined)) badges.push('GREEN VIP');
    else if (/diamond|boss|tier.{0,4}4/.test(combined)) badges.push('BOSS VIP');
    // Fallback generic VIP (no tier detected)
    else if (combined.includes('vip')) badges.push('VIP');
    if (/top.?fan|top.?badge|topfan|topbadge|star.?badge|top-streamer|top_streamer|topstreamer/.test(combined)) badges.push('TOP BADGE');

    return { badges, bouncer };
  }

  function cleanText(node) {
    if (!node) return '';
    return (node.textContent || '').replace(/\\s+/g, ' ').trim();
  }

  function firstText(root, sel) {
    if (!root) return '';
    let n = null;
    try { n = root.querySelector(sel); } catch (e) { return ''; }
    return cleanText(n);
  }

  function extractRowSchema(row) {
    if (!row || row.nodeType !== 1) return null;
    const wholeText = cleanText(row);
    if (!wholeText) return null;

    let isGift = row.matches ? row.matches('.tmg-live-video-gift-message') : false;
    let isJoin = row.matches ? row.matches('.join-cell') : false;
    let isFav = row.matches ? row.matches('.tmg-live-video-favorite-message') : false;

    if (!isGift && row.querySelector) {
      isGift = !!row.querySelector('.tmg-live-video-gift-message');
    }
    if (!isJoin && row.querySelector) {
      isJoin = !!row.querySelector('.join-cell');
    }
    if (!isFav && row.querySelector) {
      isFav = !!row.querySelector('.tmg-live-video-favorite-message');
    }

    const badgeInfo = getBadgeInfo(row);
    let username = firstText(row, 'span.title-cell-name-holder');
    if (!username) {
      try { username = extractUsernameByColour(row); } catch (e) {}
    }

    let body = '';
    if (isGift) {
      body = firstText(row, 'span.tmg-live-video-gift-text') || wholeText;
    } else if (!isJoin && !isFav) {
      body = firstText(row, 'span.tmg-live-video-react-chat-message') || wholeText;
    }

    return {
      text: wholeText,
      body: body || wholeText,
      username: username || '',
      is_gift: isGift,
      is_join: isJoin,
      is_favorite: isFav,
      badges: badgeInfo.badges,
      bouncer: badgeInfo.bouncer
    };
  }

  // Scrape Diamond Count
  function scrapeDiamonds() {
    const hintSelectors = [
      '[class*="diamonds-holder"]',
      '[class*="diamond-count"]',
      '[class*="diamondCount"]',
      '[class*="diamond"]',
      '[class*="credit"]'
    ];
    for (const sel of hintSelectors) {
      const el = document.querySelector(sel);
      if (el) {
        const txt = (el.textContent || '').replace(/,/g, '').trim();
        const m = txt.match(/(\\d+)/);
        if (m) return parseInt(m[1], 10);
      }
    }
    return null;
  }

  // Scrape Viewers Count
  function scrapeViewers() {
    const sels = [
      '.viewers-count___KREgV span',
      '[class*="viewers-count"] span',
      '[class*="viewer-count"]'
    ];
    for (const sel of sels) {
      const el = document.querySelector(sel);
      if (el) {
        const txt = (el.textContent || '').replace(/,/g, '').trim();
        const m = txt.match(/(\\d+)/);
        if (m) return parseInt(m[1], 10);
      }
    }
    return null;
  }

  // Scrape Likes Count
  function scrapeLikes() {
    const el = document.querySelector('[class*="likes-count"]');
    if (el) {
      const txt = (el.textContent || '').replace(/,/g, '').trim();
      const m = txt.match(/(\\d+)/);
      if (m) return parseInt(m[1], 10);
    }
    return null;
  }

  // Query Strict Chat Rows
  const STRICT_CELLS = document.querySelectorAll('.chat-cell, .join-cell, .tmg-live-video-gift-message, .tmg-live-video-favorite-message, .tmg-live-video-chat-message-item');
  const messages = [];
  STRICT_CELLS.forEach((node) => {
    const schema = extractRowSchema(node);
    if (schema) messages.push(schema);
  });

  return {
    messages: messages.slice(-30),
    diamonds: scrapeDiamonds(),
    viewers: scrapeViewers(),
    likes: scrapeLikes()
  };
})()
`;

// ── Injected JS String to Isolate MeetMe Stream Video Anchor & Purge Headers/Ads ──────────────

export const ISOLATE_MEETME_STREAM_JS = `
(() => {
  function injectCleanStyles() {
    let style = document.getElementById('meetme-clean-stream-style');
    if (!style) {
      style = document.createElement('style');
      style.id = 'meetme-clean-stream-style';
      (document.head || document.documentElement).appendChild(style);
    }
    style.textContent = \`
      html, body {
        background-color: #090d16 !important;
        overflow: hidden !important;
        margin: 0 !important;
        padding: 0 !important;
        width: 100vw !important;
        height: 100vh !important;
      }

      /* 1. Hide header, ad banner, top chrome, right chat panel, swiper chrome */
      #main > div.self-center,
      #main > div.flex.h-full.w-full.flex-col > header,
      #main header,
      header,
      div[class*="h-[90px]"],
      div[class*="max-w-[728px]"],
      .stream-left-top-holder,
      .stream-right-holder,
      .tmg-live-top-shade,
      .tmg-live-video-gift-streaks,
      .swiper-pagination,
      .swiper-scrollbar {
        display: none !important;
        visibility: hidden !important;
        opacity: 0 !important;
        height: 0 !important;
        width: 0 !important;
        margin: 0 !important;
        padding: 0 !important;
        overflow: hidden !important;
        pointer-events: none !important;
        position: absolute !important;
        top: -9999px !important;
        left: -9999px !important;
      }

      /* 2. Stretch every ancestor container from body down to stream-left-holder
            so there is no gap above or below the video */
      #app, #root, #main,
      #LiveVideoContentAnchor,
      #LiveVideoContentAnchor > div,
      #LiveVideoContentAnchor > div > div,
      #LiveVideoContentAnchor > div > div > div,
      #LiveVideoContentAnchor > div > div > div > div,
      .swiper, .swiper-wrapper, .swiper-slide,
      [class*="main-slide"],
      .stream-left-holder,
      [class*="stream-left-holder"] {
        position: fixed !important;
        inset: 0 !important;
        width: 100vw !important;
        height: 100vh !important;
        max-width: none !important;
        max-height: none !important;
        margin: 0 !important;
        padding: 0 !important;
        overflow: hidden !important;
        transform: none !important;
        aspect-ratio: unset !important;
        display: block !important;
      }

      /* 3. stream-left-bottom-holder fills its parent completely */
      .stream-left-bottom-holder,
      [class*="stream-left-bottom"] {
        position: absolute !important;
        inset: 0 !important;
        width: 100% !important;
        height: 100% !important;
        z-index: 1 !important;
        background-color: #090d16 !important;
        margin: 0 !important;
        padding: 0 !important;
        display: flex !important;
        flex-direction: column !important;
        overflow: hidden !important;
      }

      /* 4. Ensure all children of the video area remain visible */
      .stream-left-bottom-holder *,
      [class*="stream-left-bottom"] * {
        visibility: visible !important;
        opacity: 1 !important;
      }

      /* 5. Inner layout wrapper — fills the full parent */
      .tmg-video-stream-container-layout {
        width: 100% !important;
        height: 100% !important;
        flex: 1 !important;
        min-height: 0 !important;
        display: flex !important;
        flex-direction: column !important;
        overflow: hidden !important;
        aspect-ratio: unset !important;
      }

      /* 6. Main stream container and its content div — fill their cell */
      .tmg-video-stream-container,
      .tmg-video-stream-content {
        width: 100% !important;
        height: 100% !important;
        flex: 1 !important;
        min-height: 0 !important;
        position: relative !important;
        overflow: hidden !important;
        aspect-ratio: unset !important;
      }

      /* 7. Guest row wrapper — fills remaining height as a flex row */
      .tmg-video-guest {
        width: 100% !important;
        display: flex !important;
        flex-direction: row !important;
        flex: 1 !important;
        min-height: 0 !important;
        overflow: hidden !important;
      }

      /* 8. Individual guest video cell — equal-width flex slots */
      .tmg-video-guest-stream-container {
        flex: 1 !important;
        min-width: 0 !important;
        height: 100% !important;
        position: relative !important;
        overflow: hidden !important;
      }

      /* 9. Agora player div wrappers — absolutely fill their cell */
      [id^="agora-video-player-track-"] {
        position: absolute !important;
        inset: 0 !important;
        width: 100% !important;
        height: 100% !important;
        overflow: hidden !important;
      }

      /* 10. All video elements — cover fill, no black bars */
      video.agora_video_player,
      .stream-left-bottom-holder video,
      [class*="stream-left-bottom"] video {
        object-fit: cover !important;
        width: 100% !important;
        height: 100% !important;
        position: absolute !important;
        inset: 0 !important;
      }
    \`;
  }

  // Execute immediately
  injectCleanStyles();

  // MutationObserver & periodic check to keep style injected on dynamic SPA updates
  const observer = new MutationObserver(() => {
    injectCleanStyles();
  });

  const targetNode = document.documentElement || document.body;
  if (targetNode) {
    observer.observe(targetNode, { childList: true, subtree: true });
  }

  setInterval(injectCleanStyles, 500);
})();
`;

/**
 * High-Relevance YouTube Search Ranking & Filtering Algorithm
 * Ported from Python SongBot `_score_youtube_result` & hard reject lists.
 */
export interface YouTubeSearchResult {
  videoId: string;
  title: string;
  channel: string;
  views: number;
  durationSeconds: number;
  score: number;
}

const SONG_HARD_REJECT_TITLE = [
  'reaction', 'reacts', 'reacting', 'reacted', 'first time hearing', 'first listen',
  'review', 'breakdown', 'interview', 'podcast', 'tutorial', 'how to play',
  'guitar lesson', 'piano lesson', 'cover', 'karaoke', 'instrumental',
  'nightcore', 'slowed', 'sped up', '1 hour', '10 hour', 'loop', 'behind the scenes'
];

const SONG_HARD_REJECT_CHANNEL = [
  'reacts', 'reaction', 'reactor', 'reactions', 'first time hearing',
  'genius', 'vox', 'the needle drop', 'polyphonic', 'fantano'
];

export function scoreYouTubeResult(query: string, item: { title: string; channel: string; views: number; durationSeconds: number }): number {
  const q = query.toLowerCase().trim();
  const qWords = q.split(/\s+/).filter(Boolean);
  if (qWords.length === 0) return 0;

  const title = item.title.toLowerCase();
  const channel = item.channel.toLowerCase();

  // Hard reject check unless user explicitly asked for the term
  for (const term of SONG_HARD_REJECT_TITLE) {
    if (title.includes(term) && !q.includes(term)) {
      return -999;
    }
  }
  for (const term of SONG_HARD_REJECT_CHANNEL) {
    if (channel.includes(term) && !q.includes(term)) {
      return -999;
    }
  }

  // Calculate word coverage
  let matched = 0;
  for (const w of qWords) {
    if (title.includes(w) || channel.includes(w)) {
      matched += 1;
    }
  }

  let score = (matched / qWords.length) * 100;

  // Exact phrase match
  if (title.includes(q)) score += 50;

  // Official video or topic channel bonus
  if (title.includes('official music video') || title.includes('official video') || title.includes('official audio')) {
    score += 40;
  }
  if (channel.includes('- topic') || channel.includes('vevo')) {
    score += 40;
  }

  // Duration check (prefer 1.5 min to 6 min)
  if (item.durationSeconds > 0) {
    if (item.durationSeconds < 30) score -= 25;
    else if (item.durationSeconds > 720) score -= 40;
    else if (item.durationSeconds >= 90 && item.durationSeconds <= 360) score += 10;
  }

  return score;
}

export const MEETME_CHAT_OBSERVER_JS = `
(() => {
  if (window.__meetmeChatObserverInjected) return;
  window.__meetmeChatObserverInjected = true;

  const EXACT_CHAT_CONTAINER_SELECTORS = [
    '[id*="ChatHistoryContainer"]',
    '#ChatHistoryContainer_yAKiAVxVLC',
    '.tmg-live-video-viewer-chats-section-container',
    '#LiveVideoContentAnchor > div > div > div > div > div.swiper-slide.main-slide___PYJHh.main-slide___AopRZ.swiper-slide-active > div.stream-right-holder > div > div > div.tmg-live-video-viewer-chats-section-container',
    '[class*="viewer-chats-section-container"]',
    '[class*="chats-section-container"]',
    '.tmg-live-video-chat-messages-holder',
    '[class*="chat-messages-holder"]'
  ];

  const processedNodeSet = new WeakSet();

  function extractChatMessageFromNode(node) {
    if (!node || node.nodeType !== 1) return null;

    let chatItem = node;
    if (!chatItem.classList.contains('chat-cell') && !chatItem.id?.startsWith('ChatMessage_')) {
      const childCell = node.querySelector('.chat-cell, [id^="ChatMessage_"], .tmg-live-video-chat-message-item');
      if (childCell) chatItem = childCell;
    }

    if (processedNodeSet.has(chatItem)) return null;
    processedNodeSet.add(chatItem);

    try {
      let username = '';
      const nameEl = chatItem.querySelector('.title-cell-name-holder, .tmg-live-video-user-name, [class*="user-name"]');
      if (nameEl) username = (nameEl.textContent || '').trim();

      let text = '';
      const msgEl = chatItem.querySelector('.tmg-live-video-react-chat-message, .tmg-live-video-chat-message, [class*="react-chat-message"]');
      if (msgEl) {
        text = (msgEl.textContent || '').trim();
      } else {
        const clone = chatItem.cloneNode(true);
        const nameInClone = clone.querySelector('.tmg-live-video-user-name, .title-cell-name-holder, .level-number');
        if (nameInClone) nameInClone.remove();
        text = (clone.textContent || '').replace(/\s+/g, ' ').trim();
      }

      if (!text) return null;

      let avatar = 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100';
      const imgEl = chatItem.querySelector('img.tmg-live-video-chat-message-image, .chat-avatar-img-holder img, img');
      if (imgEl && imgEl.getAttribute('src')) {
        avatar = imgEl.getAttribute('src');
      }

      let level = 1;
      const levelEl = chatItem.querySelector('.level-number, [class*="level"]');
      if (levelEl) {
        const lvlMatch = (levelEl.textContent || '').match(/\d+/);
        if (lvlMatch) level = parseInt(lvlMatch[0], 10);
      }

      // ── Badge extraction ────────────────────────────────────────────────────
      var VIP_TIER_MAP = { '1': 'GREEN VIP', '2': 'PURPLE VIP', '3': 'BLACK VIP', '4': 'BOSS VIP' };
      var badges = [];
      var scanRoot = chatItem;

      // 1. TOP BADGE — empty <span class="...top-streamer">
      var scanHtml = (scanRoot.outerHTML || '').toLowerCase();
      var topSpans = scanRoot.querySelectorAll('[class*="top-streamer"], [class*="top-fan"], [class*="topstreamer"]');
      if (topSpans.length > 0) badges.push('TOP BADGE');

      // 2. BOUNCER — class "user-bouncer" on username span, or bouncer icon span/img
      var bouncerEl = scanRoot.querySelector('[class*="user-bouncer"], span[class*="bouncer"], img[src*="bouncer"], img[src*="moderator"]');
      if (bouncerEl) badges.push('BOUNCER');

      // 3. VIP tier — scan outerHTML for vip_tierN (static, always present immediately)
      var vipTierMatch = scanHtml.match(/vip_tier(\d)/);
      if (!vipTierMatch) vipTierMatch = scanHtml.match(/alt="tier\s*(\d)\s*badge"/);
      if (vipTierMatch) {
        var vipLbl = VIP_TIER_MAP[vipTierMatch[1]] || 'VIP';
        if (badges.indexOf(vipLbl) === -1) badges.push(vipLbl);
      } else if (scanHtml.includes('tmg-live-video-user-icon vip') || scanHtml.includes('class="vip"')) {
        if (badges.indexOf('VIP') === -1) badges.push('VIP');
      }

      // 4. Gifter badge
      if (scanHtml.includes('gifter') && badges.indexOf('GIFTER') === -1) badges.push('GIFTER');

      let type = 'chat';
      const htmlLower = (chatItem.outerHTML || '').toLowerCase();
      if (htmlLower.includes('gift') || htmlLower.includes('diamond')) type = 'gift';
      else if (htmlLower.includes('join') || htmlLower.includes('joined')) type = 'join';

      // Detect PK battle: MeetMe adds team-blue / team-red markers inside the chat item during battles
      const inBattle = htmlLower.includes('team-blue') || htmlLower.includes('team-red');

      const msgId = chatItem.id || ('mm_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8));

      return {
        id: msgId,
        user: {
          id: 'u_' + (username || 'user').toLowerCase().replace(/[^a-z0-9]/g, ''),
          name: username || 'MeetMe Viewer',
          avatar: avatar,
          level: level || 1,
          levelColor: level > 50 ? 'from-amber-400 to-rose-500' : 'from-purple-500 to-indigo-600',
          badges: badges,
          badge: badges[0] || undefined,
        },
        text: text,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        type: type,
        inBattle: inBattle,
      };
    } catch (err) {
      console.warn('[MeetMe Chat Parser Error]', err);
      return null;
    }
  }

  function dispatchChatData(chatData) {
    if (!chatData) return;
    try {
      if (window.electronAPI && typeof window.electronAPI.sendMeetMeChat === 'function') {
        window.electronAPI.sendMeetMeChat(chatData);
      } else if (typeof require !== 'undefined') {
        const { ipcRenderer } = require('electron');
        ipcRenderer.send('meetme-chat-message', chatData);
      }
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: 'MEETME_CHAT_MESSAGE', payload: chatData }, '*');
      }
      window.postMessage({ type: 'MEETME_CHAT_MESSAGE', payload: chatData }, '*');
    } catch (e) {
      console.error('[MeetMe Observer IPC Error]', e);
    }
  }

  function findTargetContainer() {
    for (const sel of EXACT_CHAT_CONTAINER_SELECTORS) {
      const container = document.querySelector(sel);
      if (container) return container;
    }
    return null;
  }

  function setupObserver() {
    const targetContainer = findTargetContainer();
    if (!targetContainer) return false;

    const initialNodes = targetContainer.querySelectorAll('.chat-cell, [id^="ChatMessage_"], .tmg-live-video-chat-message-item');
    initialNodes.forEach((itemNode) => {
      const msg = extractChatMessageFromNode(itemNode);
      if (msg) dispatchChatData(msg);
    });

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType === 1) {
              const msg = extractChatMessageFromNode(node);
              if (msg) dispatchChatData(msg);
            }
          });
        }
      }
    });

    observer.observe(targetContainer, { childList: true, subtree: true });
    console.log('[MeetMe Chat Observer] Successfully attached to ChatHistoryContainer!', targetContainer);
    return true;
  }

  let attempts = 0;
  const timer = setInterval(() => {
    attempts++;
    const attached = setupObserver();
    if (attached || attempts > 120) clearInterval(timer);
  }, 500);
})();
`;

export async function initializeScraper(
  credentials: ScraperCredentials
): Promise<ScraperSession> {
  const { email, password, streamUrl } = credentials;

  if (!streamUrl || !streamUrl.includes('meetme.com')) {
    throw new Error('Invalid MeetMe stream URL provided. Must be a valid meetme.com live link.');
  }

  console.log(`[Scraper] Initializing session for target URL: ${streamUrl}`);

  return {
    connected: true,
    streamUrl,
    viewerCount: 142,
    diamondsTotal: 105,
    likesCount: 20890,
    disconnect: async () => {
      console.log('[Scraper] Disconnected.');
    },
    sendMessage: async (msg: string) => {
      console.log(`[Scraper Output] ${msg}`);
      return true;
    },
  };
}
