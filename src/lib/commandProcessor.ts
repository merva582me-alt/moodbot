import { ChatMessage, SongItem, SoundTrigger, EngagementAlertConfig, EdgeTTSVoice, CommandPermissionsConfig, BADGE_HIERARCHY, ALL_BADGES, ScheduleConfig, CustomCommand } from '../types';
import { audioEngine } from './audioEngine';
import { cleanUsername, stripGiftSuffix } from '../scraper';

export interface CommandProcessResult {
  updatedQueue?: SongItem[];
  newVolume?: number;
  newChatMessage?: ChatMessage;
  ttsTriggered?: { user: string; text: string };
  soundboardTriggered?: SoundTrigger;
  giftDetected?: { user: string; giftName: string; credits: number; thankMessage?: string };
  pauseMusic?: boolean;   // true = pause, false = resume
  clearQueue?: boolean;
  chatToSend?: string;   // message to send into the live stream chat
  customCommandTriggered?: { command: CustomCommand; response: string };
}

// In-Memory Leaderboards & User Points (Ported from SongBot)
export const userLoyaltyPoints: Record<string, number> = {};
export const userGiftTracking: Record<string, { credits: number; count: number }> = {};
export let giftSessionTotal = 0;
export let giftGoalTotal = 10000;

// Per-alert last-fired timestamps for cooldown enforcement (ms since epoch)
let lastWelcomeFiredAt = 0;
let lastGiftFiredAt = 0;
let lastFollowFiredAt = 0;

// Per-session set of usernames that have already received a welcome alert.
// Prevents the same viewer from being announced twice when join events arrive
// on multiple IPC channels simultaneously or the scraper re-snapshots on reattach.
const welcomedUsers = new Set<string>();

export function resetWelcomedUsers(): void {
  welcomedUsers.clear();
}

export function detectGiftInText(text: string): { giftName: string; recipient?: string; basePrice: number } | null {
  if (!text) return null;

  // Extract " to <recipient>" suffix and return it separately
  function extractRecipient(name: string): { clean: string; recipient?: string } {
    const m = name.match(/^(.*?)\s+to\s+(.+)$/i);
    if (m) return { clean: m[1].trim(), recipient: m[2].trim() };
    return { clean: name.trim() };
  }

  // Capitalized Sent <Gift>!
  const sentMatch = text.match(/Sent\s+([^\!\.]+?)\s*(?:[\!\.]|$)/);
  if (sentMatch && sentMatch[1]) {
    const { clean: giftName, recipient } = extractRecipient(sentMatch[1].trim());
    return { giftName, recipient, basePrice: estimateGiftValue(giftName) };
  }

  // "Spun the <Gift> and sent" — MeetMe coin-flip / spin-type gifts
  const spunMatch = text.match(/[Ss]pun\s+(?:the\s+)?(.+?)\s+and\s+sent/i);
  if (spunMatch && spunMatch[1]) {
    const { clean: giftName, recipient } = extractRecipient(spunMatch[1].trim());
    return { giftName, recipient, basePrice: estimateGiftValue(giftName) };
  }

  // Lowercase "sent a <Gift>" or "sent an <Gift>"
  const lower = text.toLowerCase();
  for (const pat of [' sent a ', ' sent an ']) {
    if (lower.includes(pat)) {
      const parts = lower.split(pat);
      if (parts[1]) {
        const { clean: giftName, recipient } = extractRecipient(parts[1].replace(/[\!\.]/g, '').trim());
        return { giftName, recipient, basePrice: estimateGiftValue(giftName) };
      }
    }
  }

  return null;
}

function estimateGiftValue(giftName: string): number {
  const gLower = giftName.toLowerCase();
  if (gLower.includes('rose') || gLower.includes('heart') || gLower.includes('kiss')) return 10;
  if (gLower.includes('diamond') || gLower.includes('gem') || gLower.includes('firework')) return 500;
  if (gLower.includes('car') || gLower.includes('yacht') || gLower.includes('castle') || gLower.includes('dragon')) return 5000;
  return 100;
}

export function formatAlertMessage(
  template: string,
  user: string,
  giftName?: string,
  giftValue?: number | string,
  recipient?: string
): string {
  if (!template) return '';
  let msg = template;
  msg = msg.replace(/\{user\}|@user/gi, user);
  if (giftName) {
    msg = msg.replace(/\{gift\}|@gift/gi, giftName);
  } else {
    msg = msg.replace(/\{gift\}|@gift/gi, 'Gift');
  }
  msg = msg.replace(/\{recipient\}/gi, recipient || '');
  if (giftValue !== undefined) {
    msg = msg.replace(/\{value\}|@value/gi, String(giftValue));
  } else {
    msg = msg.replace(/\{value\}|@value/gi, '0');
  }
  return msg;
}

/**
 * Main Command Processor - adapted from SongBot Python loop logic.
 */
/** Returns a random ShortName from English-locale voices only, or undefined if none available. */
function randomVoice(voices: EdgeTTSVoice[]): string | undefined {
  const english = voices.filter(v => v.Locale.toLowerCase().startsWith('en-'));
  if (!english.length) return undefined;
  return english[Math.floor(Math.random() * english.length)].ShortName;
}

/** Resolves the effective voice URI, substituting a random pick for the "__random__" sentinel. */
function resolveVoiceURI(voiceURI: string | undefined, voices: EdgeTTSVoice[]): string | undefined {
  if (voiceURI === '__random__') return randomVoice(voices);
  return voiceURI;
}

/**
 * Returns true if any of the user's badges are in the allowed-badges list for a command.
 * Accepts either a single badge string (legacy) or an array of badges.
 * An empty allowed list means nobody can use the command (disabled).
 * A list containing 'everyone' grants access to all.
 * Badge strings from the scraper may be uppercase (e.g. 'BOUNCER') — matched case-insensitively.
 * A generic 'vip' badge (no tier detected) is treated as matching any VIP-type permission level.
 */
export function hasPermission(
  userBadge: string | string[] | undefined,
  allowed: import('../types').CommandPermissionLevel[]
): boolean {
  // Empty array means the command is disabled for everyone
  if (!allowed || allowed.length === 0) return false;
  // 'everyone' in the list means open to all
  if (allowed.includes('everyone')) return true;
  if (!userBadge) return false;
  // Normalise to array so we can check all badges the user holds
  const userBadges = Array.isArray(userBadge)
    ? userBadge.map((b) => b.trim().toLowerCase())
    : [userBadge.trim().toLowerCase()];
  return userBadges.some((ub) => {
    // Generic 'vip' badge (tier not detected by scraper) — treat as the lowest VIP tier (Green VIP)
    if (ub === 'vip') {
      return allowed.some((lvl) => lvl.toLowerCase() === 'green vip');
    }
    return allowed.some((lvl) => lvl.toLowerCase() === ub);
  });
}

export function processIncomingChatMessage(
  message: ChatMessage,
  currentQueue: SongItem[],
  soundTriggers: SoundTrigger[],
  alerts: EngagementAlertConfig,
  blockedSongKeywords: string[] = [],
  songRequestsEnabled: boolean = true,
  isInBattle: boolean = false,
  soundboardEnabled: boolean = true,
  availableVoices: EdgeTTSVoice[] = [],
  commandPermissions?: CommandPermissionsConfig,
  scheduleConfig?: ScheduleConfig,
  customCommands: CustomCommand[] = []
): CommandProcessResult {
  const text = message.text.trim();
  const lowerText = text.toLowerCase();
  const rawUser = message.user.name;
  const username = cleanUsername(rawUser);
  const userKey = username.toLowerCase();

  const result: CommandProcessResult = {};

  // Shorthand permission check using caller-supplied config (falls back to all-badges if missing)
  // Uses badges array when available so users with multiple roles are checked correctly.
  const perm = (cmd: import('../types').BotCommand) =>
    hasPermission(message.user.badges ?? message.user.badge, commandPermissions?.[cmd] ?? ALL_BADGES);

  /** Returns a "restricted" chat message listing which badges can use this command. */
  const restrictedMsg = (cmd: import('../types').BotCommand): string => {
    const allowed = commandPermissions?.[cmd] ?? ALL_BADGES;
    if (!allowed || allowed.length === 0) return `⛔ ${cmd} is currently disabled.`;
    const badgeList = allowed.join(', ');
    return `⛔ This command is restricted to: ${badgeList}`;
  };

  // Award chat activity points (+5 points per chat message)
  userLoyaltyPoints[userKey] = (userLoyaltyPoints[userKey] || 0) + 5;

  // 1. GIFT DETECTION PASS
  // Prefer the structured giftName field when present — it contains the clean gift name without
  // the sender or recipient glued on. Only fall back to parsing the raw text when giftName is absent.
  // For gift-type messages the raw giftName field may contain "Username Sent GiftName!" —
  // parse it the same way as the chat text so {gift} never resolves to the sender's name.
  const resolvedGiftName = (() => {
    const raw = message.giftName || '';
    const parsed = detectGiftInText(raw);
    if (parsed) return parsed.giftName;
    // raw contains no "Sent" keyword — it is either just the gift name or just the username.
    // Only use it if it doesn't look like a bare username (i.e. it differs from the cleaned username).
    const cleaned = cleanUsername(raw);
    if (cleaned !== cleanUsername(message.user.name) && raw.trim()) return raw.trim();
    return 'Gift';
  })();
  // When the message already carries a structured giftName, use it directly rather than
  // re-parsing the text field (which includes the recipient username and would produce
  // "GiftName Recipient" as the gift name).
  const giftHit = message.type === 'gift' && message.giftName
    ? { giftName: resolvedGiftName, recipient: detectGiftInText(message.giftName)?.recipient, basePrice: message.giftValue || 100 }
    : detectGiftInText(text) || (message.type === 'gift' ? { giftName: resolvedGiftName, basePrice: message.giftValue || 100 } : null);
  if (giftHit && message.type !== 'system') {
    const sender = stripGiftSuffix(username);
    const credits = giftHit.basePrice;

    // Track gifts
    if (!userGiftTracking[userKey]) {
      userGiftTracking[userKey] = { credits: 0, count: 0 };
    }
    userGiftTracking[userKey].credits += credits;
    userGiftTracking[userKey].count += 1;
    giftSessionTotal += credits;

    // Award loyalty points per credit (+1 point per credit)
    userLoyaltyPoints[userKey] = (userLoyaltyPoints[userKey] || 0) + credits;

    // Auto-thank generator using alert template (only if gift alert is enabled and allowed during battles)
    const giftCooldownMs = (alerts.giftCooldownSeconds ?? 0) * 1000;
    const giftCooldownPassed = giftCooldownMs <= 0 || (Date.now() - lastGiftFiredAt) >= giftCooldownMs;
    const giftAlertAllowed = alerts.giftEnabled !== false && (!isInBattle || alerts.giftInBattles !== false) && giftCooldownPassed;
    if (giftAlertAllowed) {
      const thankMessage = alerts.giftMessage
        ? formatAlertMessage(alerts.giftMessage, sender, giftHit.giftName, credits.toLocaleString(), giftHit.recipient)
        : `WOW! Thank you ${sender} for the amazing ${giftHit.giftName} (${credits.toLocaleString()} Diamonds)! You rock!`;

      result.giftDetected = {
        user: sender,
        giftName: giftHit.giftName,
        credits,
        thankMessage
      };

      result.chatToSend = thankMessage;
      lastGiftFiredAt = Date.now();

      if (alerts.giftTTS) {
        audioEngine.speakTTS(thankMessage, resolveVoiceURI(alerts.giftVoiceURI, availableVoices));
      }
    }

    return result;
  }

  // WELCOME / JOIN PASS
  if (message.type === 'join' || message.text.toLowerCase().includes('joined the stream')) {
    const welcomeCooldownMs = (alerts.welcomeCooldownSeconds ?? 0) * 1000;
    const welcomeCooldownPassed = welcomeCooldownMs <= 0 || (Date.now() - lastWelcomeFiredAt) >= welcomeCooldownMs;
    const welcomeAlertAllowed = alerts.welcomeEnabled !== false && (!isInBattle || alerts.welcomeInBattles !== false) && welcomeCooldownPassed;
    const alreadyWelcomed = welcomedUsers.has(userKey);
    if (welcomeAlertAllowed && !alreadyWelcomed) {
      welcomedUsers.add(userKey);
      const welcomeText = formatAlertMessage(alerts.welcomeMessage || 'Welcome {user}!', username);
      result.chatToSend = welcomeText;
      lastWelcomeFiredAt = Date.now();
      if (alerts.welcomeTTS) {
        audioEngine.speakTTS(welcomeText, resolveVoiceURI(alerts.welcomeVoiceURI, availableVoices));
      }
    }
  }

  // FOLLOW PASS
  if (message.type === 'follow' || message.text.toLowerCase().includes('followed the stream')) {
    const followCooldownMs = (alerts.followCooldownSeconds ?? 0) * 1000;
    const followCooldownPassed = followCooldownMs <= 0 || (Date.now() - lastFollowFiredAt) >= followCooldownMs;
    const followAlertAllowed = alerts.followEnabled !== false && (!isInBattle || alerts.followInBattles !== false) && followCooldownPassed;
    if (followAlertAllowed) {
      const followText = formatAlertMessage(alerts.followMessage || 'Thanks for following {user}!', username);
      result.chatToSend = followText;
      lastFollowFiredAt = Date.now();
      if (alerts.followTTS) {
        audioEngine.speakTTS(followText, resolveVoiceURI(alerts.followVoiceURI, availableVoices));
      }
    }
  }

  // 2. COMMAND: !play (bare, no args) — resume playback if paused
  if (lowerText === '!play') {
    if (perm('!play')) {
      result.pauseMusic = false; // false = resume
      result.chatToSend = '▶️ Music Resumed!';
    } else {
      result.chatToSend = restrictedMsg('!play');
    }
    return result;
  }

  // 2b. COMMAND: !sr / !songrequest <song title / artist>  (only these trigger a song request)
  const isSongRequest = lowerText.startsWith('!sr ') || lowerText.startsWith('!songrequest ');
  if (isSongRequest) {
    if (!songRequestsEnabled) {
      return result;
    }
    if (!perm('!sr')) {
      result.chatToSend = restrictedMsg('!sr');
      return result;
    }

    let songName = '';
    if (lowerText.startsWith('!sr ')) songName = text.substring(4).trim();
    else if (lowerText.startsWith('!songrequest ')) songName = text.substring(13).trim();

    if (songName) {
      // Check for blocked keywords
      const matchedBlockedKeyword = blockedSongKeywords.find(
        (kw) => kw.trim() !== '' && songName.toLowerCase().includes(kw.trim().toLowerCase())
      );

      if (matchedBlockedKeyword) {
        return result;
      }

      // Award points for song request
      userLoyaltyPoints[userKey] = (userLoyaltyPoints[userKey] || 0) + 10;

      const newSong: SongItem = {
        id: Date.now().toString() + Math.random().toString(36).substr(2, 4),
        title: songName,
        artist: 'YouTube Requested',
        duration: '',
        requestedBy: username,
        thumbnailUrl: '',
      };
      result.updatedQueue = [...currentQueue, newSong];
    }
    return result;
  }

  // COMMAND: !clearqueue / !cq
  if (lowerText === '!clearqueue' || lowerText === '!cq') {
    if (perm('!clearqueue')) {
      result.updatedQueue = [];
      result.clearQueue = true;
    } else {
      result.chatToSend = restrictedMsg('!clearqueue');
    }
    return result;
  }

  // 3. COMMAND: !skip
  if (lowerText === '!skip' || lowerText.startsWith('!skip ')) {
    if (perm('!skip')) {
      if (currentQueue.length > 0) {
        result.updatedQueue = currentQueue.slice(1);
      }
      result.chatToSend = 'Song Skipped!';
    } else {
      result.chatToSend = restrictedMsg('!skip');
    }
    return result;
  }

  // COMMAND: !pause
  if (lowerText === '!pause') {
    if (perm('!pause')) {
      result.pauseMusic = true;
      result.chatToSend = 'Music Paused!';
    } else {
      result.chatToSend = restrictedMsg('!pause');
    }
    return result;
  }

  // 3b. COMMAND: !volume <0-100>
  if (lowerText.startsWith('!volume')) {
    if (perm('!volume')) {
      const args = lowerText.replace('!volume', '').trim().split(/\s+/);
      if (args[0] && args[0] !== '') {
        const volNum = parseInt(args[0], 10);
        if (!isNaN(volNum) && volNum >= 0 && volNum <= 100) {
          result.newVolume = volNum;
          audioEngine.updateMixerState({ musicVolume: volNum });
          result.chatToSend = `Volume Set To ${volNum}%!`;
        }
      }
    } else {
      result.chatToSend = restrictedMsg('!volume');
    }
    return result;
  }

  // 4. COMMAND: !commands / !help
  if (lowerText.startsWith('!commands') || lowerText.startsWith('!help')) {
    if (!perm('!commands')) {
      result.chatToSend = restrictedMsg('!commands');
      return result;
    }
    result.chatToSend = '📋 Commands: !sr <song> | !skip | !clearqueue | !pause | !play | !volume <0-100> | !tts <msg> | !schedule | !commands';
    return result;
  }

  // COMMAND: !schedule
  if (lowerText === '!schedule') {
    if (!perm('!schedule')) {
      result.chatToSend = restrictedMsg('!schedule');
      return result;
    }
    if (scheduleConfig && scheduleConfig.entries.length > 0) {
      const now = new Date();
      const nowDay = now.getDay();
      const nowMins = now.getHours() * 60 + now.getMinutes();
      const enabled = scheduleConfig.entries.filter((e) => e.enabled);
      const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      let next: typeof enabled[0] | null = null;
      for (let offset = 0; offset < 7; offset++) {
        const checkDay = (nowDay + offset) % 7;
        const dayEntries = enabled
          .filter((e) => e.dayOfWeek === checkDay)
          .sort((a, b) => a.startTime.localeCompare(b.startTime));
        for (const entry of dayEntries) {
          const [h, m] = entry.startTime.split(':').map(Number);
          if (offset > 0 || h * 60 + m > nowMins) { next = entry; break; }
        }
        if (next) break;
      }
      if (!next && enabled.length > 0) next = enabled[0];
      if (next) {
        const [h, m] = next.startTime.split(':').map(Number);
        const ampm = h >= 12 ? 'PM' : 'AM';
        const h12 = h % 12 || 12;
        const timeStr = `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
        result.chatToSend = `📅 Next stream: ${next.title} — ${DAY_NAMES[next.dayOfWeek]} at ${timeStr}`;
      }
    } else {
      result.chatToSend = '📅 No stream schedule set yet.';
    }
    return result;
  }

  // CUSTOM COMMANDS — matched before the soundboard scanner
  for (const cc of customCommands) {
    if (!cc.enabled) continue;
    if (lowerText !== cc.trigger.toLowerCase()) continue;
    if (!hasPermission(message.user.badges ?? message.user.badge, cc.allowedBadges)) continue;

    const response = formatAlertMessage(cc.response, username);
    result.chatToSend = response;
    result.customCommandTriggered = { command: cc, response };

    if (cc.tts) {
      audioEngine.speakTTS(response);
    }
    return result;
  }

  // 9. COMMAND: !tts <message>
  if (lowerText.startsWith('!tts ')) {
    if (perm('!tts')) {
      const ttsText = text.substring(5).trim();
      if (ttsText) {
        result.ttsTriggered = { user: username, text: ttsText };
        audioEngine.speakTTS(`${username} says: ${ttsText}`);
      }
    } else {
      result.chatToSend = restrictedMsg('!tts');
    }
    return result;
  }

  // 10. SOUNDBOARD KEYWORD SCANNER
  if (soundboardEnabled) {
    const matchedTrigger = soundTriggers.find((st) => {
      if (!st.enabled) return false;
      const escaped = st.keyword.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`(?<![\\w])${escaped}(?![\\w])`).test(lowerText);
    });
    if (matchedTrigger) {
      result.soundboardTriggered = matchedTrigger;
      audioEngine.playSoundboardEffect(matchedTrigger.soundType, matchedTrigger.customDataUrl);
    }
  }

  return result;
}
