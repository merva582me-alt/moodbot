export interface EdgeTTSVoice {
  Name: string;
  ShortName: string;
  Gender: string;
  Locale: string;
  SuggestedCodec: string;
  FriendlyName: string;
  Status: string;
}

export interface ChatUser {
  id: string;
  name: string;
  avatar: string;
  level: number;
  levelColor: string;
  /** All role badges the user holds (e.g. ['VIP', 'BOUNCER']). */
  badges?: string[];
  /** @deprecated use badges instead */
  badge?: string;
  isVIP?: boolean;
}

export interface ChatMessage {
  id: string;
  user: ChatUser;
  text: string;
  timestamp: string;
  type: 'chat' | 'gift' | 'follow' | 'system' | 'command' | 'join';
  giftName?: string;
  giftValue?: number;
  inBattle?: boolean;
}

export interface SongItem {
  id: string;
  title: string;
  artist: string;
  duration: string;
  requestedBy: string;
  thumbnailUrl: string;
  youtubeUrl?: string;
}

export interface SoundTrigger {
  id: string;
  keyword: string;
  title: string;
  fileName: string;
  soundType: 'airhorn' | 'cheer' | 'drums' | 'ding' | 'custom';
  enabled: boolean;
  customDataUrl?: string;
}

export interface EngagementAlertConfig {
  welcomeMessage: string;
  welcomeTTS: boolean;
  welcomeVoiceURI?: string;
  welcomeEnabled?: boolean;
  welcomeInBattles?: boolean;
  /** Minimum seconds between welcome alerts (0 = no cooldown) */
  welcomeCooldownSeconds?: number;
  giftMessage: string;
  giftTTS: boolean;
  giftVoiceURI?: string;
  giftEnabled?: boolean;
  giftInBattles?: boolean;
  /** Minimum seconds between gift alerts (0 = no cooldown) */
  giftCooldownSeconds?: number;
  followMessage: string;
  followTTS: boolean;
  followVoiceURI?: string;
  followEnabled?: boolean;
  followInBattles?: boolean;
  /** Minimum seconds between follow alerts (0 = no cooldown) */
  followCooldownSeconds?: number;
}

export interface AudioMixerState {
  musicVolume: number; // 0 - 100
  ttsVolume: number; // 0 - 100
  soundboardVolume: number; // 0 - 100
  /** When true, YouTube music is paused during TTS/soundboard and resumed after. */
  musicPauseEnabled: boolean;
}

export interface TTSConfig {
  voiceURI: string;
  pitch: number; // 0.5 - 1.5
  rate: number;  // 0.5 - 1.5
  enabled?: boolean;
}

export type CommandPermissionLevel =
  | 'everyone'
  | 'Bouncer'
  | 'Boss VIP'
  | 'Black VIP'
  | 'Purple VIP'
  | 'Green VIP'
  | 'Top Badge';

/** Ordered from lowest (index 0) to highest privilege. Green VIP = tier 1 (lowest), Boss VIP = tier 4 (highest). */
export const BADGE_HIERARCHY: CommandPermissionLevel[] = [
  'everyone',
  'Bouncer',
  'Top Badge',
  'Green VIP',
  'Purple VIP',
  'Black VIP',
  'Boss VIP',
];

export type BotCommand =
  | '!sr'
  | '!skip'
  | '!clearqueue'
  | '!pause'
  | '!play'
  | '!volume'
  | '!tts'
  | '!commands'
  | '!schedule';

export type CommandPermissionsConfig = Record<BotCommand, CommandPermissionLevel[]>;

/** All badge levels — used as the "everyone" default (any badge may use the command). */
export const ALL_BADGES: CommandPermissionLevel[] = [...BADGE_HIERARCHY];

export const DEFAULT_COMMAND_PERMISSIONS: CommandPermissionsConfig = {
  '!sr':          [...ALL_BADGES],
  '!skip':        [...ALL_BADGES],
  '!clearqueue':  [...ALL_BADGES],
  '!pause':       [...ALL_BADGES],
  '!play':        [...ALL_BADGES],
  '!volume':      [...ALL_BADGES],
  '!tts':         [...ALL_BADGES],
  '!commands':    [...ALL_BADGES],
  '!schedule':    [...ALL_BADGES],
};

export interface CustomCommand {
  id: string;
  /** The trigger keyword, e.g. "!hello" */
  trigger: string;
  /** The response the bot sends to chat. Supports {user} placeholder. */
  response: string;
  /** Which badge levels may invoke this command */
  allowedBadges: CommandPermissionLevel[];
  /** If true the bot speaks the response via TTS as well */
  tts: boolean;
  enabled: boolean;
  /** Optional description shown in the builder UI */
  description?: string;
}

export interface TTSQueueItem {
  id: string;
  user: string;
  text: string;
  timestamp: string;
  status: 'queued' | 'speaking' | 'completed';
}

export interface StreamStats {
  viewerCount: number;
  currentViewers?: number;
  totalViewers?: number;
  totalLikes?: number;
  broadcasterLifetimeDiamonds?: number;
  totalFollowers?: number;
  lifetimeFollowers?: number;
  streamTitle: string;
  diamondsTotal: number;
  likesCount: number;
  isConnected: boolean;
  streamUrl: string;
  streamMediaUrl?: string;
}

export interface ScheduleEntry {
  id: string;
  dayOfWeek: number; // 0 = Sunday, 6 = Saturday
  startTime: string; // "HH:MM" 24h
  endTime?: string;  // "HH:MM" 24h, optional
  title: string;
  enabled: boolean;
}

export interface ScheduleConfig {
  entries: ScheduleEntry[];
  announceMinutesBefore: number;
  announceEnabled: boolean;
  announceMessage: string; // supports {title}, {time}, {day}
}

export const DEFAULT_SCHEDULE_CONFIG: ScheduleConfig = {
  entries: [],
  announceMinutesBefore: 15,
  announceEnabled: false,
  announceMessage: 'Stream starting soon: {title} at {time} ({day})!',
};

export interface WheelOptionAnimation {
  lottie: string | null;
  rive: string | null;
  audio?: string | null;
}

export interface WheelOption {
  name: string;
  percent?: string;
  animations: WheelOptionAnimation[];
}

export interface MeetMeGift {
  id: string;
  name: string;
  /** Diamond price (integer). */
  diamonds?: number;
  price?: number;
  /** Image/thumbnail URL. */
  imageUrl?: string;
  thumbnailUrl?: string;
  image?: string;
  thumbnail?: string;
  /** Gift category — flat string (normalised from local data). */
  category?: string;
  /** Raw categories array as returned by the gift data JSON. */
  categories?: string[];
  /** Whether the gift is currently available. */
  available?: boolean;
  /** Lottie animation URLs (CDN-resolved). */
  lottieList?: string[];
  /** Rive animation — { src: string } where src is a CDN-resolved URL. */
  riveAnimation?: { src: string } | null;
  /** Wheel outcome options (CDN-resolved lottie/rive paths). Present on mystery-wheel gifts. */
  options?: WheelOption[];
  /** Raw API fields preserved for display. */
  [key: string]: unknown;
}

export interface HeartsStatus {
  running: boolean;
  totalSent: number;
  totalFail: number;
  sessionUrl: string | null;
}

declare global {
  interface Window {
    electronAPI?: {
      // ── WebContentsView ────────────────────────────────────────────────────
      createOrUpdateWebContentsView: (params: {
        viewId: string;
        url: string;
        bounds?: { x: number; y: number; width: number; height: number };
        partition?: string;
        devicePixelRatio?: number;
      }) => Promise<{ success: boolean; error?: string }>;
      showWebContentsView: (params: { viewId: string }) => Promise<{ success: boolean }>;
      hideWebContentsView: (params: { viewId: string }) => Promise<{ success: boolean }>;
      destroyWebContentsView: (params: { viewId: string }) => Promise<{ success: boolean }>;
      navigateWebContentsView: (params: { viewId: string; url: string }) => Promise<{ success: boolean }>;

      // ── Bot connection ─────────────────────────────────────────────────────
      connectBot: (credentials: {
        email: string;
        password: string;
        streamUrl: string;
      }) => Promise<{
        success: boolean;
        status?: string;
        streamUrl?: string;
        broadcastId?: string | null;
        loggedIn?: boolean;
      }>;
      disconnectBot: () => Promise<{ success: boolean; status?: string }>;
      sendChatMessage: (message: string) => Promise<{ success: boolean }>;
      sendMeetMeChat?: (data: any) => void;
      scrapeMetrics?: () => Promise<{
        success: boolean;
        viewers?: number | null;
        diamonds?: number | null;
        likes?: number | null;
      }>;

      // ── Resize ping ────────────────────────────────────────────────────────
      onViewRequestResize: (callback: () => void) => () => void;

      // ── Events ────────────────────────────────────────────────────────────
      bringViewToFront?: (params: { viewId: string }) => Promise<void>;
      onChatEvent: (callback: (data: any) => void) => () => void;
      onMeetMeChatMessage?: (callback: (data: any) => void) => () => void;
      onYouTubeNowPlaying?: (callback: (title: string) => void) => () => void;
      onYouTubeVideoEnded?: (callback: () => void) => () => void;
      onYouTubeVideoMetadata?: (callback: (data: { videoId: string; duration: string }) => void) => () => void;
      onYouTubeThumbnailUpdate?: (callback: (videoId: string) => void) => () => void;
      onYouTubePlayState?: (callback: (data: { paused: boolean }) => void) => () => void;
      onScraperStatus?: (callback: (data: { active: boolean }) => void) => () => void;
      onMetricsUpdate: (callback: (data: {
        currentViewers?: number | null;
        totalViewers?: number | null;
        totalLikes?: number | null;
        totalDiamonds?: number | null;
        broadcasterLifetimeDiamonds?: number | null;
        lifetimeFollowers?: number | null;
        streamTitle?: string | null;
      }) => void) => () => void;

      // ── Audio ──────────────────────────────────────────────────────────────
      setYouTubeVolume?: (volume: number) => Promise<void>;
      pauseYouTube?: () => Promise<void>;
      playYouTube?: () => Promise<void>;

      // ── Edge TTS ───────────────────────────────────────────────────────────
      ttsGetVoices?: () => Promise<EdgeTTSVoice[]>;
      ttsSpeak?: (payload: {
        text: string;
        voiceShortName: string;
        rate: number;
        pitch: number;
      }) => Promise<ArrayBuffer | null>;

      // ── MeetMe tab initial URL ──────────────────────────────────────────────
      getMeetMeInitialUrl?: () => Promise<string>;

      // ── Gift Catalogue ──────────────────────────────────────────────────────
      giftsGetCatalog?: () => Promise<{ success: boolean; gifts: MeetMeGift[]; error?: string }>;

      // ── Animation asset proxy ───────────────────────────────────────────────
      fetchAnimationAsset?: (url: string) => Promise<{ ok: boolean; data: string; mimeType: string; error?: string }>;

      // ── Super Speed Hearts ──────────────────────────────────────────────────
      heartsStart?: (params?: { intervalMs?: number }) => Promise<{ success: boolean; sessionUrl: string | null }>;
      heartsStop?: () => Promise<{ success: boolean; totalSent: number; totalFail: number }>;
      heartsStatus?: () => Promise<HeartsStatus>;
      onHeartsUpdate?: (callback: (data: HeartsStatus) => void) => () => void;
    };
  }
}

