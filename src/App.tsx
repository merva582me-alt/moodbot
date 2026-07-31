import React, { useState, useEffect, useRef } from 'react';
import {
  Radio,
  Tv,
  Square,
  MessageSquare,
  Volume2,
  VolumeX,
  Music,
  Zap,
  Settings,
  User,
  Gift,
  Heart,
  Play,
  Pause,
  SkipForward,
  Plus,
  Sliders,
  Send,
  Eye,
  Sparkles,
  Bot,
  Flame,
  CheckCircle2,
  AlertCircle,
  Mic,
  MicOff,
  Disc,
  Activity,
  Maximize2,
  Trash2,
  Volume1,
  Sparkle,
  ExternalLink,
  Pencil,
  X,
  Check,
  Youtube,
  Power,
  RotateCcw,
  Bell,
  BellOff,
  Ban,
  Swords,
  Upload,
  FolderPlus,
  Clock,
  Shield,
  Calendar,
  Terminal,
} from 'lucide-react';
import {
  ChatMessage,
  AudioMixerState,
  EdgeTTSVoice,
  EngagementAlertConfig,
  SongItem,
  SoundTrigger,
  StreamStats,
  TTSConfig,
  TTSQueueItem,
  CommandPermissionsConfig,
  DEFAULT_COMMAND_PERMISSIONS,
  ALL_BADGES,
  BotCommand,
  BADGE_HIERARCHY,
  CommandPermissionLevel,
  ScheduleConfig,
  DEFAULT_SCHEDULE_CONFIG,
  CustomCommand,
} from './types';
import { audioEngine } from './lib/audioEngine';
import { processIncomingChatMessage, resetWelcomedUsers } from './lib/commandProcessor';
import { EmbeddedLiveView } from './components/EmbeddedLiveView';
import { LiveChatPanel } from './components/LiveChatPanel';
import { TimedMessagesPanel, TimedMessagesConfig } from './components/TimedMessagesPanel';
import { ScheduleTab } from './components/ScheduleTab';
import { HeartsTab } from './components/HeartsTab';
import { GiftPreviewerTab } from './components/GiftPreviewerTab';
import { CustomCommandsTab } from './components/CustomCommandsTab';
import { idbGet, idbSet } from './lib/persistence';

// Maximum chat messages to keep in memory to avoid unbounded growth
const MAX_CHAT_MESSAGES = 500;

/**
 * Formats an Edge TTS FriendlyName like
 * "Microsoft WilliamMultilingual Online (Natural) - English (Australia)"
 * into a short "William - Australia" label.
 */
function formatVoiceName(friendlyName: string): string {
  // Strip leading "Microsoft "
  const noMs = friendlyName.replace(/^Microsoft\s+/, '');
  // Extract the voice first name (word before "Multilingual" or "Online")
  const nameMatch = noMs.match(/^([A-Z][a-z]+)/);
  const name = nameMatch ? nameMatch[1] : noMs.split(' ')[0];
  // Extract the country/region from the last parenthetical, dropping "(Preview)"
  const stripped = friendlyName.replace(/\s*\(Preview\)/gi, '');
  const countryMatch = stripped.match(/\(([^)]+)\)\s*$/);
  const country = countryMatch ? countryMatch[1] : '';
  return country ? `${name} - ${country}` : name;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'stream' | 'alerts' | 'permissions' | 'music' | 'tts' | 'soundboard' | 'mixer' | 'timedmsg' | 'schedule' | 'hearts' | 'gifts' | 'customcmds'>('stream');
  const [isConnectingScraper, setIsConnectingScraper] = useState(false);
  const [scraperError, setScraperError] = useState<string | null>(null);

  // Stream & Connection State
  const [streamStats, setStreamStats] = useState<StreamStats>({
    viewerCount: 0,
    currentViewers: 0,
    totalViewers: 0,
    totalLikes: 0,
    broadcasterLifetimeDiamonds: 0,
    totalFollowers: 0,
    lifetimeFollowers: 0,
    streamTitle: 'MoodBot — The Ultimate Livestream Assistant!',
    diamondsTotal: 0,
    likesCount: 0,
    isConnected: false,
    streamUrl: 'https://app.meetme.com/live/search/trending/all',
  });

  // Auth Credentials State — held in-memory only, never persisted to disk
  const [auth, setAuth] = useState({ email: '', password: '', streamUrl: '' });

  const manualDisconnectRef = useRef(false);
  const isConnectingScraperRef = useRef(isConnectingScraper);
  useEffect(() => {
    isConnectingScraperRef.current = isConnectingScraper;
  }, [isConnectingScraper]);

  // Chat Feed State
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  // True when the DOM scraper is actively watching a /live/view/ page — independent of bot auth
  const [isScraperLive, setIsScraperLive] = useState(false);

  const [inputMessage, setInputMessage] = useState('');

  // Audio Mixer State (persisted between sessions & restarts)
  const [mixer, setMixer] = useState<AudioMixerState>(() => {
    const defaultMixer: AudioMixerState = {
      musicVolume: 80,
      ttsVolume: 90,
      soundboardVolume: 85,
      musicPauseEnabled: true,
    };
    try {
      const saved = localStorage.getItem('meetme_mixer_state');
      if (saved) {
        const parsed = JSON.parse(saved);
        // Strip legacy ducking fields so they don't pollute the new shape
        const { autoDuckingEnabled: _a, duckingDepthPercent: _d, isDuckingActive: _i, ...clean } = parsed;
        return { ...defaultMixer, ...clean };
      }
    } catch (e) {}
    return defaultMixer;
  });

  useEffect(() => {
    try {
      localStorage.setItem('meetme_mixer_state', JSON.stringify(mixer));
    } catch (e) {}
  }, [mixer]);

  // TTS Config State & Voices (persisted between sessions & restarts)
  const [ttsConfig, setTtsConfig] = useState<TTSConfig>(() => {
    const defaultConfig: TTSConfig = {
      voiceURI: '',
      pitch: 1.0,
      rate: 1.0,
      enabled: true,
    };
    try {
      const saved = localStorage.getItem('meetme_tts_config');
      if (saved) {
        const parsed = JSON.parse(saved);
        return { ...defaultConfig, ...parsed };
      }
    } catch (e) {}
    return defaultConfig;
  });

  useEffect(() => {
    try {
      localStorage.setItem('meetme_tts_config', JSON.stringify(ttsConfig));
    } catch (e) {}
  }, [ttsConfig]);

  const [ttsTestText, setTtsTestText] = useState<string>(() => {
    try {
      return localStorage.getItem('meetme_tts_test_text') ?? 'Welcome to MoodBot Live Stream on MeetMe!';
    } catch { return 'Welcome to MoodBot Live Stream on MeetMe!'; }
  });

  useEffect(() => {
    try {
      localStorage.setItem('meetme_tts_test_text', ttsTestText);
    } catch (e) {}
  }, [ttsTestText]);

  const [availableVoices, setAvailableVoices] = useState<EdgeTTSVoice[]>([]);
  const [voiceFilter, setVoiceFilter] = useState('');
  const [ttsQueue, setTtsQueue] = useState<TTSQueueItem[]>([]);

  // Automated Engagement Configuration (persisted between sessions & restarts)
  const [alerts, setAlerts] = useState<EngagementAlertConfig>(() => {
    const defaultAlerts: EngagementAlertConfig = {
      welcomeMessage: 'Welcome to the live stream {user}! Thanks for dropping in!',
      welcomeTTS: true,
      welcomeEnabled: true,
      welcomeInBattles: true,
      welcomeCooldownSeconds: 0,
      giftMessage: 'WOW! Thank you {user} for the amazing {gift} ({value} Diamonds)! You rock!',
      giftTTS: true,
      giftEnabled: true,
      giftInBattles: true,
      giftCooldownSeconds: 0,
      followMessage: 'Thank you {user} for joining the MoodBot community follow list!',
      followTTS: false,
      followEnabled: true,
      followInBattles: true,
      followCooldownSeconds: 0,
    };
    try {
      const saved = localStorage.getItem('meetme_alerts_config');
      if (saved) {
        const parsed = JSON.parse(saved);
        return { ...defaultAlerts, ...parsed };
      }
    } catch (e) {}
    return defaultAlerts;
  });

  useEffect(() => {
    try {
      localStorage.setItem('meetme_alerts_config', JSON.stringify(alerts));
    } catch (e) {}
  }, [alerts]);

  // Per-command permission locks configuration
  const [commandPermissions, setCommandPermissions] = useState<CommandPermissionsConfig>(() => {
    try {
      const saved = localStorage.getItem('meetme_command_permissions');
      if (saved) {
        const parsed = JSON.parse(saved);
        // Migrate old string-based values (single CommandPermissionLevel) to arrays
        const migrated: Partial<CommandPermissionsConfig> = {};
        for (const [cmd, val] of Object.entries(parsed)) {
          if (typeof val === 'string') {
            // Old format: 'everyone' → all badges, otherwise hierarchy ≥ that level
            if (val === 'everyone') {
              migrated[cmd as BotCommand] = [...ALL_BADGES];
            } else {
              const idx = BADGE_HIERARCHY.indexOf(val as CommandPermissionLevel);
              migrated[cmd as BotCommand] = idx >= 0 ? BADGE_HIERARCHY.slice(idx) : [...ALL_BADGES];
            }
          } else {
            migrated[cmd as BotCommand] = val as CommandPermissionLevel[];
          }
        }
        return { ...DEFAULT_COMMAND_PERMISSIONS, ...migrated };
      }
    } catch (e) {}
    return { ...DEFAULT_COMMAND_PERMISSIONS };
  });
  useEffect(() => {
    try { localStorage.setItem('meetme_command_permissions', JSON.stringify(commandPermissions)); } catch (e) {}
  }, [commandPermissions]);

  // Stream Schedule configuration
  const [scheduleConfig, setScheduleConfig] = useState<ScheduleConfig>(() => {
    try {
      const saved = localStorage.getItem('meetme_schedule_config');
      if (saved) return { ...DEFAULT_SCHEDULE_CONFIG, ...JSON.parse(saved) };
    } catch (e) {}
    return { ...DEFAULT_SCHEDULE_CONFIG };
  });
  useEffect(() => {
    try { localStorage.setItem('meetme_schedule_config', JSON.stringify(scheduleConfig)); } catch (e) {}
  }, [scheduleConfig]);
  // Track which upcoming entries have already been announced this session
  const announcedEntryIdsRef = useRef<Set<string>>(new Set());

  // Custom Commands configuration (persisted)
  const [customCommands, setCustomCommands] = useState<CustomCommand[]>(() => {
    try {
      const saved = localStorage.getItem('meetme_custom_commands');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (e) {}
    return [];
  });
  useEffect(() => {
    try { localStorage.setItem('meetme_custom_commands', JSON.stringify(customCommands)); } catch (e) {}
  }, [customCommands]);

  // PK Battle Mode Active State
  const [isInBattle, setIsInBattle] = useState<boolean>(false);

  // Music Queue & Active Track State
  const [activeYoutubeSong, setActiveYoutubeSong] = useState<SongItem | null>(null);
  const [musicQueue, setMusicQueue] = useState<SongItem[]>([]);
  const [totalSongRequests, setTotalSongRequests] = useState<number>(0);
  const [isPlayingMusic, setIsPlayingMusic] = useState(true);
  const isPlayingMusicRef = useRef(true);
  // Tracks the last person who requested a song so we can attribute non-queued playback
  const lastRequesterRef = useRef<string>('');

  // Live title scraped from the YouTube WebContentsView tab via IPC
  const [youtubeLiveTitle, setYoutubeLiveTitle] = useState<string>('');

  // Set to true when a skip action is triggered (command or UI button) so the
  // next onYouTubeNowPlaying fires a "Now Playing" chat announcement even when
  // a queued song takes over (normally suppressed for queued songs).
  const pendingSkipRef = useRef(false);

  // Song Requests Enable / Disable State
  const [songRequestsEnabled, setSongRequestsEnabled] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('meetme_song_requests_enabled');
      return saved !== null ? JSON.parse(saved) : true;
    } catch (e) {
      return true;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('meetme_song_requests_enabled', JSON.stringify(songRequestsEnabled));
    } catch (e) {}
  }, [songRequestsEnabled]);

  // Blocked Song Request Keywords State (persisted between sessions & restarts)
  const [blockedSongKeywords, setBlockedSongKeywords] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('meetme_blocked_song_keywords');
      if (saved !== null) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (e) {}
    return ['earrape', 'explicit', 'nazi', 'screamer', 'troll'];
  });
  const [newBlockedKeywordInput, setNewBlockedKeywordInput] = useState('');

  useEffect(() => {
    try {
      localStorage.setItem('meetme_blocked_song_keywords', JSON.stringify(blockedSongKeywords));
    } catch (e) {}
  }, [blockedSongKeywords]);

  const handleAddBlockedKeyword = () => {
    const kw = newBlockedKeywordInput.trim().toLowerCase();
    if (kw && !blockedSongKeywords.includes(kw)) {
      setBlockedSongKeywords((prev) => [...prev, kw]);
      setNewBlockedKeywordInput('');
    }
  };

  const handleRemoveBlockedKeyword = (keywordToRemove: string) => {
    setBlockedSongKeywords((prev) => prev.filter((kw) => kw !== keywordToRemove));
  };

  // Soundboard Keywords (persisted between sessions & restarts)
  const defaultSoundTriggers: SoundTrigger[] = [
    { id: 's1', keyword: 'gg', title: 'GG Fanfare Cheer', fileName: 'cheer_gg.mp3', soundType: 'cheer', enabled: true },
    { id: 's2', keyword: 'airhorn', title: 'Streamer Airhorn SFX', fileName: 'airhorn.wav', soundType: 'airhorn', enabled: true },
    { id: 's3', keyword: 'hype', title: 'Hype Drumroll', fileName: 'hype_drums.mp3', soundType: 'drums', enabled: true },
    { id: 's4', keyword: 'ding', title: 'Crystal Bell Ding', fileName: 'ding.wav', soundType: 'ding', enabled: true },
  ];

  const [soundTriggers, setSoundTriggers] = useState<SoundTrigger[]>(() => {
    try {
      const saved = localStorage.getItem('meetme_soundboard_triggers');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (e) {}
    return defaultSoundTriggers;
  });

  // Soundboard Master Enable/Disable State (persisted between sessions & restarts)
  const [soundboardEnabled, setSoundboardEnabled] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('meetme_soundboard_enabled');
      if (saved !== null) return JSON.parse(saved);
    } catch (e) {}
    return true;
  });

  // Timed Messages Config State (persisted between sessions)
  const defaultTimedMsgConfig: TimedMessagesConfig = {
    messages: [],
    cooldownMode: 'time',
    intervalSeconds: 60,
    intervalMessages: 20,
  };
  const [timedMsgRunning, setTimedMsgRunning] = useState(false);

  const [timedMessagesConfig, setTimedMessagesConfig] = useState<TimedMessagesConfig>(() => {
    try {
      const saved = localStorage.getItem('meetme_timed_messages');
      if (saved) return { ...defaultTimedMsgConfig, ...JSON.parse(saved) };
    } catch (e) {}
    return defaultTimedMsgConfig;
  });

  useEffect(() => {
    try {
      localStorage.setItem('meetme_timed_messages', JSON.stringify(timedMessagesConfig));
    } catch (e) {}
  }, [timedMessagesConfig]);

  // Master Settings Hydration Engine (IndexedDB only — no external server needed)
  useEffect(() => {
    async function loadPersistedSettings() {
      const idbTriggers = await idbGet<SoundTrigger[]>('soundboard_triggers');
      if (idbTriggers && Array.isArray(idbTriggers) && idbTriggers.length > 0) {
        setSoundTriggers(idbTriggers);
      }
    }
    loadPersistedSettings();
  }, []);

  // Master Settings Auto-Sync Effect — localStorage + IndexedDB
  useEffect(() => {
    try {
      if (streamStats.streamUrl) {
        localStorage.setItem('meetme_stream_url', streamStats.streamUrl);
      }
      localStorage.setItem('meetme_alerts_config', JSON.stringify(alerts));
      localStorage.setItem('meetme_blocked_song_keywords', JSON.stringify(blockedSongKeywords));
      localStorage.setItem('meetme_tts_config', JSON.stringify(ttsConfig));
      localStorage.setItem('meetme_soundboard_enabled', JSON.stringify(soundboardEnabled));
      localStorage.setItem('meetme_mixer_state', JSON.stringify(mixer));

      try {
        localStorage.setItem('meetme_soundboard_triggers', JSON.stringify(soundTriggers));
      } catch (quotaErr) {
        // Quota overflow for large sound files — handled by IndexedDB below
      }
    } catch (e) {}

    // Save large base64 soundboard audio files to IndexedDB
    idbSet('soundboard_triggers', soundTriggers);
  }, [streamStats.streamUrl, alerts, blockedSongKeywords, ttsConfig, soundboardEnabled, mixer, soundTriggers]);

  const soundFileInputRef = useRef<HTMLInputElement>(null);
  const singleAddFileInputRef = useRef<HTMLInputElement>(null);
  const singleEditFileInputRef = useRef<HTMLInputElement>(null);

  const [newKeywordInput, setNewKeywordInput] = useState('');
  const [newTitleInput, setNewTitleInput] = useState('');
  const [newSoundType, setNewSoundType] = useState<'airhorn' | 'cheer' | 'drums' | 'ding' | 'custom'>('ding');
  const [newCustomDataUrl, setNewCustomDataUrl] = useState<string | undefined>(undefined);
  const [newFileName, setNewFileName] = useState<string>('');

  // Edit Soundboard Trigger State
  const [editingSoundId, setEditingSoundId] = useState<string | null>(null);
  const [editKeywordInput, setEditKeywordInput] = useState('');
  const [editTitleInput, setEditTitleInput] = useState('');
  const [editSoundType, setEditSoundType] = useState<'airhorn' | 'cheer' | 'drums' | 'ding' | 'custom'>('ding');
  const [editCustomDataUrl, setEditCustomDataUrl] = useState<string | undefined>(undefined);
  const [editFileName, setEditFileName] = useState<string>('');

  const chatContainerRef = useRef<HTMLDivElement>(null);

  // Register IPC bridges for YouTube playback control (once on mount)
  useEffect(() => {
    audioEngine.setPauseYouTubeHandler(() => {
      isPlayingMusicRef.current = false;
      setIsPlayingMusic(false);
      window.electronAPI?.pauseYouTube?.();
    });
    audioEngine.setResumeYouTubeHandler(() => {
      isPlayingMusicRef.current = true;
      setIsPlayingMusic(true);
      window.electronAPI?.playYouTube?.();
    });
    audioEngine.setYouTubeVolumeHandler((volume: number) => {
      window.electronAPI?.setYouTubeVolume?.(volume);
    });
    audioEngine.setGetIsPlayingHandler(() => isPlayingMusicRef.current);
  }, []);

  // Synchronize Audio Engine with Mixer State
  useEffect(() => {
    audioEngine.updateMixerState(mixer);
  }, [mixer]);

  useEffect(() => {
    audioEngine.updateTTSConfig(ttsConfig);
  }, [ttsConfig]);

  // Fetch Edge TTS voices from main process (cached after first call)
  useEffect(() => {
    window.electronAPI?.ttsGetVoices?.().then((voices) => {
      if (!voices || voices.length === 0) return;
      const englishVoices = voices.filter((v: { Locale: string }) => v.Locale.toLowerCase().startsWith('en-'));
      const filtered = englishVoices.length > 0 ? englishVoices : voices;
      // Deduplicate by formatted label so e.g. "Neerja - India (Preview)" and "Neerja - India" collapse to one
      const seen = new Set<string>();
      const deduped = filtered.filter((v: EdgeTTSVoice) => {
        const label = formatVoiceName(v.FriendlyName);
        if (seen.has(label)) return false;
        seen.add(label);
        return true;
      });
      setAvailableVoices(deduped);
      audioEngine.updateAvailableVoices(deduped);
      setTtsConfig(prev => prev.voiceURI ? prev : { ...prev, voiceURI: 'en-US-AriaNeural' });
    }).catch((err) => console.warn('[App] Failed to load Edge TTS voices:', err));
  }, []);

  // Subscribe to live metrics pushed by the main-process polling loop via IPC
  useEffect(() => {
    if (!window.electronAPI) return;
    const unsub = window.electronAPI.onMetricsUpdate((data) => {
      setStreamStats((prev) => ({
        ...prev,
        // API fields (real MeetMe REST API)
        currentViewers:              data.currentViewers              ?? prev.currentViewers,
        viewerCount:                 data.currentViewers              ?? prev.viewerCount,
        totalViewers:                data.totalViewers                ?? prev.totalViewers,
        totalLikes:                  data.totalLikes                  ?? prev.totalLikes,
        totalDiamonds:               data.totalDiamonds               ?? prev.totalDiamonds,
        diamondsTotal:               data.totalDiamonds               ?? prev.diamondsTotal,
        broadcasterLifetimeDiamonds: data.broadcasterLifetimeDiamonds ?? prev.broadcasterLifetimeDiamonds,
        lifetimeFollowers:           data.lifetimeFollowers           ?? prev.lifetimeFollowers,
        // Use explicit undefined-check so an empty string or null resets the title
        streamTitle:                 data.streamTitle !== undefined ? (data.streamTitle ?? '') : prev.streamTitle,
        // DOM-scrape fallback fields (keep compat)
        likesCount:                  data.totalLikes                  ?? data.likesCount  ?? prev.likesCount,
      }));
    });
    return unsub;
  }, []);

  // Stable refs for command processor dependencies so the subscription
  // effect below doesn't re-run (and re-subscribe) on every state change.
  const musicQueueRef = useRef(musicQueue);
  const soundTriggersRef = useRef(soundTriggers);
  const alertsRef = useRef(alerts);
  const blockedSongKeywordsRef = useRef(blockedSongKeywords);
  const songRequestsEnabledRef = useRef(songRequestsEnabled);
  const isInBattleRef = useRef(isInBattle);
  const soundboardEnabledRef = useRef(soundboardEnabled);
  const availableVoicesRef = useRef(availableVoices);
  // Tracks the last known battle state so we can detect transitions (in → out or out → in)
  const lastBattleStateRef = useRef<boolean | null>(null);
  // Consecutive non-battle message counter — exit battle only after 10 in a row to avoid flicker
  const battleExitCounterRef = useRef<number>(0);
  const BATTLE_EXIT_THRESHOLD = 10;
  useEffect(() => { musicQueueRef.current = musicQueue; }, [musicQueue]);
  useEffect(() => { soundTriggersRef.current = soundTriggers; }, [soundTriggers]);
  useEffect(() => { alertsRef.current = alerts; }, [alerts]);
  useEffect(() => { blockedSongKeywordsRef.current = blockedSongKeywords; }, [blockedSongKeywords]);
  useEffect(() => { songRequestsEnabledRef.current = songRequestsEnabled; }, [songRequestsEnabled]);
  useEffect(() => { isInBattleRef.current = isInBattle; }, [isInBattle]);
  useEffect(() => { soundboardEnabledRef.current = soundboardEnabled; }, [soundboardEnabled]);
  useEffect(() => { availableVoicesRef.current = availableVoices; }, [availableVoices]);
  const commandPermissionsRef = useRef(commandPermissions);
  useEffect(() => { commandPermissionsRef.current = commandPermissions; }, [commandPermissions]);
  const scheduleConfigRef = useRef(scheduleConfig);
  useEffect(() => { scheduleConfigRef.current = scheduleConfig; }, [scheduleConfig]);
  const customCommandsRef = useRef(customCommands);
  useEffect(() => { customCommandsRef.current = customCommands; }, [customCommands]);
  // Ref so the stable IPC closure always calls the latest handleSendMessage (initialized below)
  const handleSendMessageRef = useRef<(text: string) => void>(() => {});
  // Per-session Set of message IDs that have already been fully processed.
  // Checked synchronously before processIncomingChatMessage so alerts never fire twice
  // even if the IPC bridge delivers the same message on two channels simultaneously.
  const processedMsgIdsRef = useRef<Set<string>>(new Set());
  // Short-lived set of texts the bot itself sent — used to ignore its own messages
  // when they loop back through the scraper and would otherwise trigger soundboard keywords.
  const recentBotMessagesRef = useRef<Set<string>>(new Set());

  // Electron IPC & window.postMessage chat subscription — runs once, uses refs for stable deps
  useEffect(() => {
    const handleIncomingMessage = (msg: ChatMessage) => {
      if (!msg || !msg.text) return;

      // Detect PK battle state transitions using the inBattle flag from the scraper.
      // Enter battle immediately on first team-marked message.
      // Exit battle only after BATTLE_EXIT_THRESHOLD consecutive non-team messages
      // (prevents non-team-coloured messages like gifts/joins from prematurely clearing the flag).
      // Only chat-type messages carry reliable team-colour markers; gift/join/follow/system
      // messages never have team-blue/team-red in their DOM, so they must not count against
      // the exit threshold or they will falsely clear the battle flag mid-battle.
      if (msg.inBattle !== undefined && msg.type === 'chat') {
        if (msg.inBattle) {
          battleExitCounterRef.current = 0;
          if (lastBattleStateRef.current !== true) {
            lastBattleStateRef.current = true;
            setIsInBattle(true);
            isInBattleRef.current = true;
            // Inject a visible system notice into the chat panel
            const battleStartNotice: ChatMessage = {
              id: 'sys_battle_enter_' + Date.now(),
              text: '⚔️ PK Battle started — battle mode is now active.',
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              type: 'system',
              user: { id: 'sys', name: 'System', avatar: '', level: 1, levelColor: '' },
            };
            setChatMessages((prev) => {
              const next = [...prev, battleStartNotice];
              return next.length > MAX_CHAT_MESSAGES ? next.slice(next.length - MAX_CHAT_MESSAGES) : next;
            });
            // NOTE: do NOT send powered-by here — the sys_reattach event (DOM swap on battle
            // entry) already triggers the send below, and calling it here too causes a double-send.
          }
        } else {
          battleExitCounterRef.current += 1;
          if (lastBattleStateRef.current === true && battleExitCounterRef.current >= BATTLE_EXIT_THRESHOLD) {
            lastBattleStateRef.current = false;
            setIsInBattle(false);
            isInBattleRef.current = false;
            // Inject a visible system notice into the chat panel
            const battleEndNotice: ChatMessage = {
              id: 'sys_battle_exit_' + Date.now(),
              text: '🏁 PK Battle ended — returning to normal stream mode.',
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              type: 'system',
              user: { id: 'sys', name: 'System', avatar: '', level: 1, levelColor: '' },
            };
            setChatMessages((prev) => {
              const next = [...prev, battleEndNotice];
              return next.length > MAX_CHAT_MESSAGES ? next.slice(next.length - MAX_CHAT_MESSAGES) : next;
            });
          }
        }
      }

      // Flag messages the bot itself sent — still display them in the chat panel
      // but skip command processing so they don't trigger soundboard keywords etc.
      const isBotEcho = recentBotMessagesRef.current.has(msg.text.trim());
      if (isBotEcho) {
        recentBotMessagesRef.current.delete(msg.text.trim());
      }

      // Guard: skip entirely if we've already processed this message ID.
      // This prevents duplicate alerts when both onChatEvent and onMeetMeChatMessage
      // deliver the same event, or when the drain interval emits a buffered message twice.
      if (processedMsgIdsRef.current.has(msg.id)) return;
      processedMsgIdsRef.current.add(msg.id);
      // Keep the processed set bounded — evict oldest 500 IDs when it grows past 2000
      if (processedMsgIdsRef.current.size > 2000) {
        const toDelete = [...processedMsgIdsRef.current].slice(0, 500);
        toDelete.forEach((id) => processedMsgIdsRef.current.delete(id));
      }

      // On DOM reattach (battle entry or chat observer reconnect), send the powered-by greeting.
      if (msg.user?.id === 'sys_reattach') {
        handleSendMessageRef.current('This stream is powered by a Livestream Assistant!');
      }

      setChatMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev;
        const next = [...prev, msg];
        // Cap to MAX_CHAT_MESSAGES to prevent unbounded memory growth
        return next.length > MAX_CHAT_MESSAGES ? next.slice(next.length - MAX_CHAT_MESSAGES) : next;
      });

      // Skip command processing for the bot's own echoed messages — they are
      // already displayed above but must not trigger soundboard or other commands.
      if (isBotEcho) return;

      const result = processIncomingChatMessage(
        msg,
        musicQueueRef.current,
        soundTriggersRef.current,
        alertsRef.current,
        blockedSongKeywordsRef.current,
        songRequestsEnabledRef.current,
        isInBattleRef.current,
        soundboardEnabledRef.current,
        availableVoicesRef.current,
        commandPermissionsRef.current,
        scheduleConfigRef.current,
        customCommandsRef.current
      );

      if (result.updatedQueue) {
        if (result.updatedQueue.length > musicQueueRef.current.length) {
          setTotalSongRequests((prev) => prev + (result.updatedQueue!.length - musicQueueRef.current.length));
        }
        // Detect a skip (queue shrank) — reset announce state so "Now Playing"
        // fires for the next song regardless of whether it came from the queue.
        if (result.updatedQueue.length < musicQueueRef.current.length) {
          pendingSkipRef.current = true;
          lastAnnouncedTitleRef.current = '';
          // If queue will be empty after the skip, clear the last-requester so
          // autoplay is not incorrectly attributed to the previous requester.
          if (result.updatedQueue.length === 0) {
            lastRequesterRef.current = '';
            setActiveYoutubeSong(null);
          }
        }
        setMusicQueue(result.updatedQueue);
      }
      if (result.pauseMusic !== undefined) {
        const pausing = result.pauseMusic;
        isPlayingMusicRef.current = !pausing;
        setIsPlayingMusic(!pausing);
        if (pausing) {
          window.electronAPI?.pauseYouTube?.();
        } else {
          window.electronAPI?.playYouTube?.();
        }
      }
      if (result.newVolume !== undefined) setMixer((prev) => ({ ...prev, musicVolume: result.newVolume! }));
      if (result.newChatMessage) {
        setChatMessages((prev) => {
          const next = [...prev, result.newChatMessage!];
          return next.length > MAX_CHAT_MESSAGES ? next.slice(next.length - MAX_CHAT_MESSAGES) : next;
        });
      }
      if (result.ttsTriggered) {
        setTtsQueue((prev) => [
          ...prev,
          {
            id: Date.now().toString(),
            user: result.ttsTriggered!.user,
            text: result.ttsTriggered!.text,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            status: 'queued',
          },
        ]);
      }
      if (result.chatToSend) {
        handleSendMessageRef.current(result.chatToSend);
      }
    };

    // Electron IPC (desktop)
    let unsubChat: () => void = () => {};
    let unsubMeetMe: () => void = () => {};
    if (window.electronAPI) {
      unsubChat = window.electronAPI.onChatEvent(handleIncomingMessage);
      if (window.electronAPI.onMeetMeChatMessage) {
        unsubMeetMe = window.electronAPI.onMeetMeChatMessage(handleIncomingMessage);
      }
    }

    // window.postMessage fallback (webview/iframe)
    const handleWindowMessage = (event: MessageEvent) => {
      try {
        if (event.data && (event.data.type === 'MEETME_CHAT_MESSAGE' || event.data.type === 'bot:chat-event')) {
          const payload = event.data.payload || event.data.data;
          if (payload) handleIncomingMessage(payload);
        }
      } catch (err) {
        console.warn('Window message handler error:', err);
      }
    };
    window.addEventListener('message', handleWindowMessage);

    return () => {
      unsubChat();
      unsubMeetMe();
      window.removeEventListener('message', handleWindowMessage);
    };
  }, []); // stable — uses refs for all mutable deps

  // Subscribe to scraper-active status from main process.
  // When the user leaves a stream (active=false) wipe the Live Chat so stale
  // messages from the previous stream don't linger.  When a new stream is
  // entered (active=true) the scraper's snapshotExisting() will re-deliver the
  // modbot/welcome pinned messages and any visible chat naturally.
  useEffect(() => {
    if (!window.electronAPI?.onScraperStatus) return;
    const unsub = window.electronAPI.onScraperStatus((data) => {
      setIsScraperLive(data.active);
      if (!data.active) {
        setChatMessages([]);
        processedMsgIdsRef.current.clear();
        resetWelcomedUsers();
      }
    });
    return unsub;
  }, []);

  // Track the last title we announced so we don't re-send on every poll tick
  const lastAnnouncedTitleRef = useRef<string>('');

  // Keep lastRequesterRef up to date whenever the queue has an active song
  useEffect(() => {
    if (musicQueue.length > 0 && musicQueue[0].requestedBy) {
      lastRequesterRef.current = musicQueue[0].requestedBy;
    }
  }, [musicQueue]);

  // Subscribe to YouTube now-playing title updates from the main process
  useEffect(() => {
    if (!window.electronAPI?.onYouTubeNowPlaying) return;
    const unsub = window.electronAPI.onYouTubeNowPlaying((title: string) => {
      // YouTube sets title to "YouTube" when idle/home; ignore those
      const clean = title.replace(/^\(\d+\)\s*/, '').replace(/\s*-\s*YouTube$/, '').trim();
      const resolvedTitle = clean === 'YouTube' || clean === '' ? '' : clean;
      setYoutubeLiveTitle(resolvedTitle);
      if (resolvedTitle) {
        const hasQueuedSong = musicQueueRef.current.length > 0;

        // Update the first queue item's title with the actual YouTube-resolved title.
        if (hasQueuedSong) {
          setMusicQueue((prev) => {
            if (prev.length === 0) return prev;
            if (prev[0].title === resolvedTitle) return prev;
            return [{ ...prev[0], title: resolvedTitle }, ...prev.slice(1)];
          });
        }

        // Announce "Now Playing" whenever the title changes (queued or autoplay).
        // lastAnnouncedTitleRef deduplicates so the same title never fires twice.
        if (resolvedTitle !== lastAnnouncedTitleRef.current) {
          lastAnnouncedTitleRef.current = resolvedTitle;
          pendingSkipRef.current = false;
          handleSendMessageRef.current(`Now Playing: ${resolvedTitle}`);
        } else {
          // Title unchanged — clear skip flag anyway (nothing new to announce)
          pendingSkipRef.current = false;
        }
      } else {
        // Song ended / idle — reset so the next track always announces
        lastAnnouncedTitleRef.current = '';
      }
    });
    return unsub;
  }, []);

  // Advance the queue when the YouTube video finishes playing
  useEffect(() => {
    if (!window.electronAPI?.onYouTubeVideoEnded) return;
    const unsub = window.electronAPI.onYouTubeVideoEnded(() => {
      setMusicQueue((prev) => prev.slice(1));
    });
    return unsub;
  }, []);

  // Update the first queue item's thumbnail and duration when YouTube resolves the video
  useEffect(() => {
    if (!window.electronAPI?.onYouTubeVideoMetadata) return;
    const unsub = window.electronAPI.onYouTubeVideoMetadata(({ videoId, duration }: { videoId: string; duration?: string }) => {
      const thumbUrl = `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
      setMusicQueue((prev) => {
        if (prev.length === 0) return prev;
        const updated = { ...prev[0], thumbnailUrl: thumbUrl };
        if (duration) updated.duration = duration;
        return [updated, ...prev.slice(1)];
      });
      // Also update the active song thumbnail so non-queued manual plays show the right thumbnail
      setActiveYoutubeSong((prev) => prev ? { ...prev, thumbnailUrl: thumbUrl } : prev);
    });
    return unsub;
  }, []);

  // Always track the current YouTube video thumbnail regardless of how the song started
  useEffect(() => {
    if (!window.electronAPI?.onYouTubeThumbnailUpdate) return;
    const unsub = window.electronAPI.onYouTubeThumbnailUpdate((videoId: string) => {
      const thumbUrl = `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
      // Update queue item if playing from queue, otherwise update activeYoutubeSong
      setMusicQueue((prev) => {
        if (prev.length === 0) return prev;
        if (prev[0].thumbnailUrl === thumbUrl) return prev; // already correct
        return [{ ...prev[0], thumbnailUrl: thumbUrl }, ...prev.slice(1)];
      });
      setActiveYoutubeSong((prev) => {
        if (!prev) {
          // No active song yet — create a minimal placeholder so the thumbnail shows
          return { id: `yt_${videoId}`, title: '', artist: '', duration: '', requestedBy: '', thumbnailUrl: thumbUrl, youtubeUrl: `https://www.youtube.com/watch?v=${videoId}` };
        }
        return { ...prev, thumbnailUrl: thumbUrl };
      });
    });
    return unsub;
  }, []);

  // Keep isPlayingMusicRef in sync with YouTube's actual play/pause state.
  // This ensures TTS/soundboard won't auto-resume music the user paused directly
  // inside the YouTube player (not via MoodBot's own pause button).
  // Guard: ignore events while the engine is managing a pause so the 2-second
  // poll doesn't race against the engine's own pause/resume IPC calls.
  useEffect(() => {
    if (!window.electronAPI?.onYouTubePlayState) return;
    const unsub = window.electronAPI.onYouTubePlayState(({ paused }: { paused: boolean }) => {
      if (audioEngine.isMidPause()) return;
      const playing = !paused;
      isPlayingMusicRef.current = playing;
      setIsPlayingMusic(playing);
    });
    return unsub;
  }, []);

  // Auto-announce upcoming scheduled streams (checks every 60 seconds)
  useEffect(() => {
    const check = () => {
      const cfg = scheduleConfigRef.current;
      if (!cfg.announceEnabled || cfg.entries.length === 0) return;
      const now = new Date();
      const nowDay = now.getDay();
      const nowMins = now.getHours() * 60 + now.getMinutes();
      for (const entry of cfg.entries) {
        if (!entry.enabled) continue;
        if (entry.dayOfWeek !== nowDay) continue;
        const [h, m] = entry.startTime.split(':').map(Number);
        const entryMins = h * 60 + m;
        const diff = entryMins - nowMins;
        if (diff > 0 && diff <= cfg.announceMinutesBefore && !announcedEntryIdsRef.current.has(entry.id)) {
          announcedEntryIdsRef.current.add(entry.id);
          const ampm = h >= 12 ? 'PM' : 'AM';
          const h12 = h % 12 || 12;
          const timeStr = `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
          const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
          const msg = cfg.announceMessage
            .replace(/\{title\}/gi, entry.title)
            .replace(/\{time\}/gi, timeStr)
            .replace(/\{day\}/gi, DAY_NAMES[entry.dayOfWeek]);
          handleSendMessageRef.current(msg);
        }
      }
    };
    const interval = setInterval(check, 60_000);
    check(); // run immediately on mount
    return () => clearInterval(interval);
  }, []);

  // When the first song in the queue changes, navigate the YouTube tab to search for it
  const playingSongIdRef = useRef<string | null>(null);
  useEffect(() => {
    const nextSong = musicQueue[0];
    if (!nextSong) return;
    if (nextSong.id === playingSongIdRef.current) return; // already playing this one
    playingSongIdRef.current = nextSong.id;
    const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(nextSong.title)}`;
    window.electronAPI?.navigateWebContentsView({ viewId: 'youtube', url: searchUrl });
  }, [musicQueue]);

  // Scroll chat to bottom on new messages, and also whenever switching back to the stream tab
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [chatMessages]);

  useEffect(() => {
    if (activeTab === 'stream' && chatContainerRef.current) {
      // Small rAF delay so the element is visible before we measure scrollHeight
      requestAnimationFrame(() => {
        if (chatContainerRef.current) {
          chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
        }
      });
    }
  }, [activeTab]);

  // Send Heart / Like Action — optimistic local update only (no external API to call)
  const handleSendHeart = () => {
    setStreamStats((prev) => ({
      ...prev,
      likesCount:  (prev.likesCount  ?? 0) + 1,
      totalLikes:  (prev.totalLikes  ?? 0) + 1,
    }));
  };

  // Launch Scraper / Connect Stream URL Handler
  const handleLaunchScraperSession = async () => {
    if (streamStats.isConnected) {
      // — DISCONNECT —
      manualDisconnectRef.current = true;

      // Tell main process to stop metrics polling
      if (window.electronAPI) {
        await window.electronAPI.disconnectBot().catch(() => {});
      }

      setStreamStats((prev) => ({ ...prev, isConnected: false }));
      return;
    }

    // — CONNECT —
    manualDisconnectRef.current = false;
    setIsConnectingScraper(true);
    setScraperError(null);

    try {
      const targetUrl = auth.streamUrl || 'https://app.meetme.com/live/search/trending/all';

      if (window.electronAPI) {
        // Navigate the embedded MeetMe WebContentsView to the stream URL,
        // authenticate with MeetMe API, and start the metrics polling loop.
        await window.electronAPI.connectBot({
          email: auth.email,
          password: auth.password,
          streamUrl: targetUrl,
        });
      }

      setStreamStats((prev) => ({
        ...prev,
        isConnected: true,
        streamUrl: targetUrl,
      }));
    } catch (err: any) {
      console.error('Failed to launch scraper session:', err);
      setScraperError(err?.message || 'Failed to connect to stream.');
    } finally {
      setIsConnectingScraper(false);
    }
  };

  // Chat message send handler — injects text into the live MeetMe chat via IPC
  const handleSendMessage = async (inputVal?: string | React.FormEvent) => {
    let messageText = '';
    if (typeof inputVal === 'string') {
      messageText = inputVal.trim();
    } else if (inputVal && typeof inputVal === 'object' && 'preventDefault' in inputVal) {
      inputVal.preventDefault();
      messageText = inputMessage.trim();
      setInputMessage('');
    } else {
      messageText = inputMessage.trim();
      setInputMessage('');
    }

    if (!messageText) return;

    // Track this outbound message so that when the scraper echoes it back we
    // can skip processing it (prevents bot responses from triggering soundboard keywords).
    recentBotMessagesRef.current.add(messageText);
    setTimeout(() => recentBotMessagesRef.current.delete(messageText), 10000);

    // Inject into the live MeetMe chat via IPC → main process → WebContentsView.
    // Allow sending whenever the scraper is watching a live page (isScraperLive)
    // OR the bot is fully connected — whichever is true first.
    if (window.electronAPI && (isScraperLive || streamStats.isConnected)) {
      window.electronAPI.sendChatMessage(messageText).catch((err) => {
        console.warn('[sendChatMessage] IPC error:', err);
      });
    }
  };
  // Keep the ref in sync so the stable IPC closure always has the latest version
  useEffect(() => { handleSendMessageRef.current = handleSendMessage; });

  // Test Message Simulator for Live Chat Panel
  const handleSendTestMessage = (type: 'chat' | 'gift' | 'command' | 'tts' = 'chat') => {
    let testMsg: ChatMessage;

    if (type === 'gift') {
      testMsg = {
        id: 'test_gift_' + Date.now(),
        user: {
          id: 'u_topgifter',
          name: 'R E E F 🥒 BIRD 4 TOP BADGE 🐹',
          avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100',
          level: 52,
          levelColor: 'from-amber-400 to-rose-500',
          badges: ['VIP', 'BOUNCER'],
          badge: 'VIP',
        },
        text: 'Sent Crazy Fireworks 🎆 (500 Diamonds)!',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        type: 'gift',
        giftName: 'Crazy Fireworks 🎆',
        giftValue: 500,
      };
    } else if (type === 'command') {
      testMsg = {
        id: 'test_cmd_' + Date.now(),
        user: {
          id: 'u_musicfan',
          name: 'SavageQueen_99',
          avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=100',
          level: 38,
          levelColor: 'from-purple-500 to-pink-500',
          badges: ['VIP'],
          badge: 'VIP',
        },
        text: '!sr Midnight City M83',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        type: 'command',
      };
    } else if (type === 'tts') {
      testMsg = {
        id: 'test_tts_' + Date.now(),
        user: {
          id: 'u_modbot',
          name: 'Modbot',
          avatar: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=100',
          level: 100,
          levelColor: 'from-cyan-400 to-purple-600',
          badges: ['MOD'],
          badge: 'MOD',
        },
        text: '!tts Welcome everyone to the stream! Enjoy the music!',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        type: 'command',
      };
    } else {
      testMsg = {
        id: 'test_chat_' + Date.now(),
        user: {
          id: 'u_viewer' + Math.floor(Math.random() * 900 + 100),
          name: 'MeetMe Streamer_' + Math.floor(Math.random() * 90 + 10),
          avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100',
          level: Math.floor(Math.random() * 40) + 1,
          levelColor: 'from-cyan-400 to-blue-500',
        },
        text: 'Modbot is watching to keep this stream safe!',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        type: 'chat',
      };
    }

    setChatMessages((prev) => [...prev, testMsg]);

    // Process command logic
    const result = processIncomingChatMessage(
      testMsg,
      musicQueue,
      soundTriggers,
      alerts,
      blockedSongKeywords,
      songRequestsEnabled,
      isInBattle,
      soundboardEnabled,
      availableVoices,
      commandPermissions,
      scheduleConfig,
      customCommands
    );

    if (result.updatedQueue) {
      if (result.updatedQueue.length > musicQueue.length) {
        setTotalSongRequests((prev) => prev + (result.updatedQueue!.length - musicQueue.length));
      }
      setMusicQueue(result.updatedQueue);
    }
    if (result.newVolume !== undefined) setMixer((prev) => ({ ...prev, musicVolume: result.newVolume! }));
    if (result.newChatMessage) setChatMessages((prev) => [...prev, result.newChatMessage!]);
  };

  // Soundboard File Auto-Import Handler (processes uploaded sound file(s))
  const processSoundboardFiles = (files: FileList | File[]) => {
    const audioFiles = Array.from(files).filter(
      (f) => f.type.startsWith('audio/') || f.name.match(/\.(mp3|wav|ogg|m4a|aac|flac|webm)$/i)
    );
    if (audioFiles.length === 0) return;

    audioFiles.forEach((file, index) => {
      const lastDotIndex = file.name.lastIndexOf('.');
      const rawName = lastDotIndex > 0 ? file.name.substring(0, lastDotIndex) : file.name;
      
      // Use file name without extension as keyword and formatted title
      const keyword = rawName.toLowerCase().trim();
      const title = rawName.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim();

      const reader = new FileReader();
      reader.onload = (e) => {
        const dataUrl = e.target?.result as string;
        if (!dataUrl) return;

        const newTrigger: SoundTrigger = {
          id: 'st_' + Date.now() + '_' + index + '_' + Math.random().toString(36).substring(2, 6),
          keyword: keyword,
          title: title,
          fileName: file.name,
          soundType: 'custom',
          customDataUrl: dataUrl,
          enabled: true,
        };

        setSoundTriggers((prev) => {
          const existsIndex = prev.findIndex((s) => s.keyword.toLowerCase() === keyword.toLowerCase());
          if (existsIndex >= 0) {
            const updated = [...prev];
            updated[existsIndex] = newTrigger;
            return updated;
          }
          return [...prev, newTrigger];
        });
      };
      reader.readAsDataURL(file);
    });
  };

  const handleSoundboardBatchUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processSoundboardFiles(e.target.files);
      e.target.value = '';
    }
  };

  const handleSelectSingleAddFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const lastDotIndex = file.name.lastIndexOf('.');
      const rawName = lastDotIndex > 0 ? file.name.substring(0, lastDotIndex) : file.name;
      const keyword = rawName.toLowerCase().trim();
      const title = rawName.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim();

      const reader = new FileReader();
      reader.onload = (ev) => {
        const dataUrl = ev.target?.result as string;
        setNewKeywordInput(keyword);
        setNewTitleInput(title);
        setNewSoundType('custom');
        setNewFileName(file.name);
        setNewCustomDataUrl(dataUrl);
      };
      reader.readAsDataURL(file);
      e.target.value = '';
    }
  };

  const handleSelectSingleEditFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const lastDotIndex = file.name.lastIndexOf('.');
      const rawName = lastDotIndex > 0 ? file.name.substring(0, lastDotIndex) : file.name;
      const keyword = rawName.toLowerCase().trim();
      const title = rawName.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim();

      const reader = new FileReader();
      reader.onload = (ev) => {
        const dataUrl = ev.target?.result as string;
        setEditKeywordInput(keyword);
        setEditTitleInput(title);
        setEditSoundType('custom');
        setEditFileName(file.name);
        setEditCustomDataUrl(dataUrl);
      };
      reader.readAsDataURL(file);
      e.target.value = '';
    }
  };

  // Soundboard Trigger Add, Edit & Delete Handlers
  const handleAddSoundTrigger = () => {
    if (!newKeywordInput.trim() || !newTitleInput.trim()) return;
    const newTrigger: SoundTrigger = {
      id: 'st_' + Date.now(),
      keyword: newKeywordInput.trim().toLowerCase(),
      title: newTitleInput.trim(),
      fileName: newFileName || `${newKeywordInput.trim().toLowerCase()}_sfx.wav`,
      soundType: newSoundType,
      customDataUrl: newSoundType === 'custom' ? newCustomDataUrl : undefined,
      enabled: true,
    };
    setSoundTriggers(prev => [...prev, newTrigger]);
    setNewKeywordInput('');
    setNewTitleInput('');
    setNewFileName('');
    setNewCustomDataUrl(undefined);
    setNewSoundType('ding');
  };

  const handleDeleteSoundTrigger = (id: string) => {
    setSoundTriggers(prev => prev.filter(s => s.id !== id));
    if (editingSoundId === id) {
      setEditingSoundId(null);
    }
  };

  const handleStartEditSound = (snd: SoundTrigger) => {
    setEditingSoundId(snd.id);
    setEditKeywordInput(snd.keyword);
    setEditTitleInput(snd.title);
    setEditSoundType(snd.soundType);
    setEditCustomDataUrl(snd.customDataUrl);
    setEditFileName(snd.fileName || '');
  };

  const handleSaveEditSound = (id: string) => {
    if (!editKeywordInput.trim() || !editTitleInput.trim()) return;
    setSoundTriggers(prev => prev.map(s => s.id === id ? {
      ...s,
      keyword: editKeywordInput.trim().toLowerCase(),
      title: editTitleInput.trim(),
      soundType: editSoundType,
      fileName: editFileName || `${editKeywordInput.trim().toLowerCase()}_sfx.wav`,
      customDataUrl: editSoundType === 'custom' ? editCustomDataUrl : undefined,
    } : s));
    setEditingSoundId(null);
  };

  const handleCancelEditSound = () => {
    setEditingSoundId(null);
  };

  return (
    <div className="flex h-screen bg-slate-950 text-slate-100 overflow-hidden font-sans">
      {/* LEFT SIDEBAR NAVIGATION */}
      <aside className="w-64 bg-slate-900 border-r border-slate-800/80 flex flex-col justify-between shrink-0">
        <div>
          {/* APP HEADER & BRAND */}
          <div className="p-4 border-b border-slate-800 flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl shrink-0 overflow-hidden">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" width="40" height="40">
                <defs>
                  <linearGradient id="sb-border-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%"   stopColor="#9333ea"/>
                    <stop offset="50%"  stopColor="#ec4899"/>
                    <stop offset="100%" stopColor="#f59e0b"/>
                  </linearGradient>
                  <linearGradient id="sb-icon-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%"   stopColor="#c084fc"/>
                    <stop offset="100%" stopColor="#a855f7"/>
                  </linearGradient>
                </defs>
                <rect x="1" y="1" width="38" height="38" rx="10" ry="10" fill="url(#sb-border-grad)"/>
                <rect x="3" y="3" width="34" height="34" rx="8" ry="8" fill="#030712"/>
                <rect x="10" y="13" width="20" height="14" rx="3" ry="3" fill="none" stroke="url(#sb-icon-grad)" strokeWidth="2" strokeLinecap="round"/>
                <line x1="20" y1="13" x2="20" y2="9" stroke="url(#sb-icon-grad)" strokeWidth="2" strokeLinecap="round"/>
                <circle cx="20" cy="8" r="1.5" fill="#c084fc"/>
                <rect x="13.5" y="17.5" width="3" height="3" rx="0.75" ry="0.75" fill="#c084fc"/>
                <rect x="23.5" y="17.5" width="3" height="3" rx="0.75" ry="0.75" fill="#c084fc"/>
                <line x1="15" y1="23" x2="25" y2="23" stroke="#c084fc" strokeWidth="1.8" strokeLinecap="round"/>
                <line x1="10" y1="18" x2="8"  y2="18" stroke="url(#sb-icon-grad)" strokeWidth="2" strokeLinecap="round"/>
                <line x1="30" y1="18" x2="32" y2="18" stroke="url(#sb-icon-grad)" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </div>
            <div>
              <h1 className="font-extrabold text-base tracking-tight bg-gradient-to-r from-purple-400 via-pink-400 to-amber-300 bg-clip-text text-transparent">
                MoodBot
              </h1>
              <p className="text-[11px] text-slate-400 font-medium">Livestream Assistant v1.0</p>
            </div>
          </div>

          {/* STREAM STATUS COUNTER CARD */}
          <div className="m-3 p-3 rounded-xl bg-slate-950/70 border border-slate-800">
            <div className="flex items-center justify-between text-xs mb-2">
              <span className="text-slate-400 font-medium flex items-center gap-1.5">
                <Radio className={`h-3.5 w-3.5 ${(isScraperLive || streamStats.isConnected) ? 'text-emerald-400 animate-pulse' : 'text-slate-500'}`} />
                Status
              </span>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${(isScraperLive || streamStats.isConnected) ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-slate-800 text-slate-400'}`}>
                {(isScraperLive || streamStats.isConnected) ? 'Online' : 'Offline'}
              </span>
            </div>
            <div className="flex items-center justify-between pt-1 gap-2">
              <div className="flex items-center gap-1.5 text-slate-300 text-xs font-bold min-w-0">
                <Eye className="h-4 w-4 text-purple-400 shrink-0" />
                <span className="font-bold text-slate-100 text-sm shrink-0">{streamStats.currentViewers ?? streamStats.viewerCount}</span>
                <span className="truncate">Current Viewers</span>
              </div>
              <div className="flex items-center gap-1 text-rose-400 text-xs font-semibold shrink-0">
                <Heart className="h-3.5 w-3.5 fill-rose-500/20 text-rose-400" />
                {(() => { const n = streamStats.totalLikes ?? 0; if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'; if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'; return n; })()}
              </div>
            </div>
          </div>

          {/* NAVIGATION LINKS */}
          <nav className="p-2 space-y-1">
            <button
              onClick={() => setActiveTab('stream')}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-semibold transition-all ${
                activeTab === 'stream'
                  ? 'bg-purple-600/20 text-purple-300 border border-purple-500/30'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              <Tv className="h-4 w-4 text-purple-400" />
              Stream & Live Chat
            </button>

            <button
              onClick={() => setActiveTab('alerts')}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-semibold transition-all ${
                activeTab === 'alerts'
                  ? 'bg-amber-600/20 text-amber-300 border border-amber-500/30'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              <Sparkles className="h-4 w-4 text-amber-400" />
              Automated Alerts
            </button>

            <button
              onClick={() => setActiveTab('music')}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-semibold transition-all ${
                activeTab === 'music'
                  ? 'bg-rose-600/20 text-rose-300 border border-rose-500/30'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              <Music className="h-4 w-4 text-rose-400" />
              Music Player & Queue
            </button>

            <button
              onClick={() => setActiveTab('tts')}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-semibold transition-all ${
                activeTab === 'tts'
                  ? 'bg-emerald-600/20 text-emerald-300 border border-emerald-500/30'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              <Mic className="h-4 w-4 text-emerald-400" />
              Text-To-Speech (TTS)
            </button>

            <button
              onClick={() => setActiveTab('soundboard')}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-semibold transition-all ${
                activeTab === 'soundboard'
                  ? 'bg-yellow-600/20 text-yellow-300 border border-yellow-500/30'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              <Disc className="h-4 w-4 text-yellow-400" />
              Soundboard
            </button>

            <button
              onClick={() => setActiveTab('mixer')}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-semibold transition-all ${
                activeTab === 'mixer'
                  ? 'bg-blue-600/20 text-blue-300 border border-blue-500/30'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              <Sliders className="h-4 w-4 text-blue-400" />
              Audio Mixer
            </button>

            <button
              onClick={() => setActiveTab('timedmsg')}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-semibold transition-all ${
                activeTab === 'timedmsg'
                  ? 'bg-cyan-600/20 text-cyan-300 border border-cyan-500/30'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              <Clock className="h-4 w-4 text-cyan-400" />
              Timed Messages
            </button>

            <button
              onClick={() => setActiveTab('permissions')}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-semibold transition-all ${
                activeTab === 'permissions'
                  ? 'bg-purple-600/20 text-purple-300 border border-purple-500/30'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              <Shield className="h-4 w-4 text-purple-400" />
              Command Permissions
            </button>

            <button
              onClick={() => setActiveTab('schedule')}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-semibold transition-all ${
                activeTab === 'schedule'
                  ? 'bg-purple-600/20 text-purple-300 border border-purple-500/30'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              <Calendar className="h-4 w-4 text-purple-400" />
              Stream Schedule
            </button>

            <button
              onClick={() => setActiveTab('hearts')}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-semibold transition-all ${
                activeTab === 'hearts'
                  ? 'bg-rose-600/20 text-rose-300 border border-rose-500/30'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              <Heart className={`h-4 w-4 ${activeTab === 'hearts' ? 'text-rose-400' : 'text-rose-500'}`} />
              Super Speed Hearts
            </button>

            <button
              onClick={() => setActiveTab('gifts')}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-semibold transition-all ${
                activeTab === 'gifts'
                  ? 'bg-amber-600/20 text-amber-300 border border-amber-500/30'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              <Gift className={`h-4 w-4 ${activeTab === 'gifts' ? 'text-amber-400' : 'text-amber-500'}`} />
              Gift Previewer
            </button>

            <button
              onClick={() => setActiveTab('customcmds')}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-semibold transition-all ${
                activeTab === 'customcmds'
                  ? 'bg-purple-600/20 text-purple-300 border border-purple-500/30'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              <Terminal className={`h-4 w-4 ${activeTab === 'customcmds' ? 'text-purple-400' : 'text-purple-500'}`} />
              Custom Commands
            </button>
          </nav>
        </div>

        {/* YOUTUBE TAB NOW PLAYING SIDEBAR WIDGET */}
        {(() => {
          const currentSong = musicQueue.length > 0 ? musicQueue[0] : activeYoutubeSong;
          if (currentSong) {
            return (
              <div className="p-3 border-t border-slate-800 bg-slate-950/80 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-300 font-bold flex items-center gap-1.5 text-[11px]">
                    <Youtube className="h-3.5 w-3.5 text-rose-500 shrink-0" /> YouTube Playing
                  </span>
                  <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-500/10 text-rose-400 border border-rose-500/20">
                    <span className="h-1.5 w-1.5 rounded-full bg-rose-500 animate-pulse" />
                    NOW PLAYING
                  </span>
                </div>

                <div
                  onClick={() => {
                    const next = !isPlayingMusic;
                    isPlayingMusicRef.current = next;
                    setIsPlayingMusic(next);
                    if (next) {
                      window.electronAPI?.playYouTube?.();
                    } else {
                      window.electronAPI?.pauseYouTube?.();
                    }
                  }}
                  className="p-2.5 bg-slate-900 border border-slate-800 rounded-xl hover:border-rose-500/40 transition-all cursor-pointer flex items-center gap-2.5 group shadow-inner"
                  title={isPlayingMusic ? 'Click to pause' : 'Click to resume'}
                >
                  <div className="relative shrink-0">
                    <img
                      src={currentSong.thumbnailUrl || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=150'}
                      alt="YouTube Track"
                      className="h-9 w-9 rounded-lg object-cover ring-1 ring-slate-700/80 group-hover:ring-rose-500/50 transition-all"
                    />
                    <div className="absolute inset-0 bg-slate-950/30 rounded-lg flex items-center justify-center">
                      {isPlayingMusic ? <Pause className="h-3 w-3 text-white fill-white" /> : <Play className="h-3 w-3 text-white fill-white" />}
                    </div>
                  </div>

                  <div className="min-w-0 flex-1">
                    <h4 className="text-xs font-bold text-slate-100 truncate group-hover:text-rose-300 transition-colors">
                      {currentSong.title || youtubeLiveTitle || 'Unknown Track'}
                    </h4>
                    <p className="text-[10px] text-slate-400 truncate">
                      {musicQueue.length > 0 && currentSong.requestedBy
                        ? `@${currentSong.requestedBy}`
                        : 'Auto-playing · YouTube Tab'}
                    </p>
                  </div>
                </div>
              </div>
            );
          }
          // No queued/requested song — show whatever is actually playing in the YouTube tab
          if (youtubeLiveTitle) {
            return (
              <div className="p-3 border-t border-slate-800 bg-slate-950/80 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-300 font-bold flex items-center gap-1.5 text-[11px]">
                    <Youtube className="h-3.5 w-3.5 text-rose-500 shrink-0" /> YouTube Playing
                  </span>
                  <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-500/10 text-rose-400 border border-rose-500/20">
                    <span className="h-1.5 w-1.5 rounded-full bg-rose-500 animate-pulse" />
                    NOW PLAYING
                  </span>
                </div>

                <div
                  onClick={() => setActiveTab('stream')}
                  className="p-2.5 bg-slate-900 border border-slate-800 rounded-xl hover:border-rose-500/40 transition-all cursor-pointer flex items-center gap-2.5 group shadow-inner"
                  title="Click to switch to YouTube tab"
                >
                  <div className="h-9 w-9 rounded-lg bg-rose-500/10 border border-rose-500/20 flex items-center justify-center shrink-0 group-hover:bg-rose-500/20 transition-colors">
                    <Youtube className="h-4 w-4 text-rose-400" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h4 className="text-xs font-bold text-slate-100 truncate group-hover:text-rose-300 transition-colors">
                      {youtubeLiveTitle}
                    </h4>
                    <p className="text-[10px] text-slate-400 truncate">YouTube Tab</p>
                  </div>
                </div>
              </div>
            );
          }
          return (
            <div className="p-3 border-t border-slate-800 bg-slate-950/80 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400 font-bold flex items-center gap-1.5 text-[11px]">
                  <Youtube className="h-3.5 w-3.5 text-slate-500 shrink-0" /> YouTube Audio
                </span>
                <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-900 text-slate-500 border border-slate-800">
                  IDLE
                </span>
              </div>

              <div
                onClick={() => setActiveTab('stream')}
                className="p-2.5 bg-slate-900/60 border border-slate-800/80 rounded-xl hover:border-slate-700 transition-all cursor-pointer flex items-center gap-2.5 text-slate-500 group"
                title="Click to open YouTube tab"
              >
                <div className="h-8 w-8 rounded-lg bg-slate-800 flex items-center justify-center shrink-0 text-slate-500 group-hover:text-rose-400 transition-colors">
                  <Music className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-slate-400 group-hover:text-slate-200 transition-colors">No track playing</p>
                  <p className="text-[10px] text-slate-500 truncate">Load track in YouTube tab</p>
                </div>
              </div>
            </div>
          );
        })()}
      </aside>

      {/* MAIN DASHBOARD CONTENT */}
      <main className="flex-1 flex flex-col bg-slate-950 overflow-hidden" style={{ minWidth: 0 }}>
        {/* TOP DASHBOARD CONTROL BAR */}
        <header className="h-14 border-b border-slate-800/80 px-6 flex items-center justify-between bg-slate-900/60 shrink-0 gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-950 border border-slate-800 rounded-xl shrink-0 shadow-sm">
              {activeTab === 'stream'      && <Tv className="h-4 w-4 text-purple-400" />}
              {activeTab === 'alerts'      && <Sparkles className="h-4 w-4 text-amber-400" />}
              {activeTab === 'permissions' && <Shield className="h-4 w-4 text-purple-400" />}
              {activeTab === 'music'       && <Music className="h-4 w-4 text-rose-400" />}
              {activeTab === 'tts'         && <Mic className="h-4 w-4 text-emerald-400" />}
              {activeTab === 'soundboard'  && <Disc className="h-4 w-4 text-yellow-400" />}
              {activeTab === 'mixer'       && <Sliders className="h-4 w-4 text-blue-400" />}
              {activeTab === 'timedmsg'    && <Clock className="h-4 w-4 text-cyan-400" />}
              {activeTab === 'schedule'    && <Calendar className="h-4 w-4 text-purple-400" />}
              {activeTab === 'hearts'      && <Heart className="h-4 w-4 text-rose-400" />}
              {activeTab === 'gifts'       && <Gift className="h-4 w-4 text-amber-400" />}
              {activeTab === 'customcmds'  && <Terminal className="h-4 w-4 text-purple-400" />}
              <span className="font-bold text-xs tracking-wider text-slate-200 uppercase">
                {activeTab === 'stream'
                  ? 'STREAM & LIVE CHAT'
                  : activeTab === 'alerts'
                  ? 'AUTOMATED ALERTS'
                  : activeTab === 'permissions'
                  ? 'COMMAND PERMISSIONS'
                  : activeTab === 'music'
                  ? 'MUSIC PLAYER & QUEUE'
                  : activeTab === 'tts'
                  ? 'TEXT-TO-SPEECH (TTS)'
                  : activeTab === 'soundboard'
                  ? 'SOUNDBOARD'
                  : activeTab === 'mixer'
                  ? 'AUDIO MIXER'
                  : activeTab === 'timedmsg'
                  ? 'TIMED MESSAGES'
                  : activeTab === 'schedule'
                  ? 'STREAM SCHEDULE'
                  : activeTab === 'hearts'
                  ? 'SUPER SPEED HEARTS'
                  : activeTab === 'gifts'
                  ? 'GIFT PREVIEWER'
                  : activeTab === 'customcmds'
                  ? 'CUSTOM COMMANDS'
                  : `${activeTab} PANEL`}
              </span>
            </div>
            {streamStats.streamTitle && (
              <span className="text-xs text-slate-400 truncate max-w-xs hidden xl:block bg-slate-950/60 px-3 py-1.5 rounded-xl border border-slate-800/80">
                {streamStats.streamTitle}
              </span>
            )}
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {/* Unified Stream Quick Feature Toggles */}
            <div className="flex items-center gap-1 p-1 bg-slate-950 border border-slate-800/80 rounded-xl shadow-inner">
              {/* Song Requests Toggle */}
              <button
                type="button"
                onClick={() => setSongRequestsEnabled((prev) => !prev)}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
                  songRequestsEnabled
                    ? 'bg-purple-500/15 text-purple-300 border border-purple-500/30 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50 border border-transparent'
                }`}
                title={songRequestsEnabled ? 'Song Requests: ENABLED (Click to disable)' : 'Song Requests: DISABLED (Click to enable)'}
              >
                <Music className={`h-3.5 w-3.5 ${songRequestsEnabled ? 'text-purple-400' : 'text-slate-500'}`} />
                <span className="hidden sm:inline">Requests</span>
                <span className={`h-1.5 w-1.5 rounded-full ${songRequestsEnabled ? 'bg-purple-400 animate-pulse' : 'bg-slate-600'}`} />
              </button>

              {/* Soundboard Quick Toggle */}
              <button
                type="button"
                onClick={() => setSoundboardEnabled((prev) => !prev)}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
                  soundboardEnabled
                    ? 'bg-yellow-500/15 text-yellow-300 border border-yellow-500/30 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50 border border-transparent'
                }`}
                title={soundboardEnabled ? 'Soundboard: ENABLED (Click to disable)' : 'Soundboard: DISABLED (Click to enable)'}
              >
                <Disc className={`h-3.5 w-3.5 ${soundboardEnabled ? 'text-yellow-400' : 'text-slate-500'}`} />
                <span className="hidden sm:inline">Soundboard</span>
                <span className={`h-1.5 w-1.5 rounded-full ${soundboardEnabled ? 'bg-yellow-400 animate-pulse' : 'bg-slate-600'}`} />
              </button>


              {/* TTS Toggle */}
              <button
                type="button"
                onClick={() => setTtsConfig((prev) => ({ ...prev, enabled: prev.enabled !== false ? false : true }))}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
                  ttsConfig.enabled !== false
                    ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50 border border-transparent'
                }`}
                title={ttsConfig.enabled !== false ? 'TTS Engine: ENABLED (Click to disable)' : 'TTS Engine: DISABLED (Click to enable)'}
              >
                {ttsConfig.enabled !== false ? (
                  <Mic className="h-3.5 w-3.5 text-emerald-400" />
                ) : (
                  <MicOff className="h-3.5 w-3.5 text-rose-400" />
                )}
                <span className="hidden sm:inline">TTS</span>
                <span className={`h-1.5 w-1.5 rounded-full ${ttsConfig.enabled !== false ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'}`} />
              </button>

            </div>

            {/* Timed Messages Start/Stop Quick Toggle */}
            {(() => {
              const enabledCount = timedMessagesConfig.messages.filter((m) => m.enabled && m.text.trim()).length;
              return (
                <button
                  type="button"
                  onClick={() => {
                    if (timedMsgRunning) {
                      setTimedMsgRunning(false);
                    } else if (enabledCount > 0) {
                      setTimedMsgRunning(true);
                    }
                  }}
                  disabled={!timedMsgRunning && enabledCount === 0}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all disabled:opacity-40 ${
                    timedMsgRunning
                      ? 'bg-rose-500/15 text-rose-300 border border-rose-500/30 shadow-sm'
                      : 'bg-slate-950 border border-slate-800/80 text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                  }`}
                  title={
                    timedMsgRunning
                      ? 'Timed Messages: RUNNING — click to stop'
                      : enabledCount === 0
                      ? 'Timed Messages: no enabled messages'
                      : 'Timed Messages: click to start'
                  }
                >
                  {timedMsgRunning ? (
                    <Square className="h-3.5 w-3.5 fill-rose-400 text-rose-400" />
                  ) : (
                    <Clock className="h-3.5 w-3.5 text-cyan-400" />
                  )}
                  <span className="hidden sm:inline">Timed Msgs</span>
                  <span className={`h-1.5 w-1.5 rounded-full ${timedMsgRunning ? 'bg-rose-400 animate-pulse' : 'bg-slate-600'}`} />
                </button>
              );
            })()}

          </div>
        </header>

        {/*
          TAB CONTENTS WRAPPER
          The stream tab contains WebContentsView placeholders that MUST always
          be in the DOM with real pixel dimensions so getBoundingClientRect()
          returns non-zero values. We use position:absolute overlay switching —
          the stream tab is always rendered at full size behind other tabs.
          We NEVER use display:none on anything containing an ElectronBrowserView.
        */}
        <div className="flex-1 relative overflow-hidden" style={{ minHeight: 0 }}>

          {/* ── TAB 1: STREAM & LIVE CHAT (always mounted, always full-size) ── */}
          <div
            style={{
              position: 'absolute', inset: 0,
              visibility: activeTab === 'stream' ? 'visible' : 'hidden',
              pointerEvents: activeTab === 'stream' ? 'auto' : 'none',
              overflow: 'hidden',
              padding: '24px',
              display: 'grid',
              gridTemplateColumns: 'repeat(12, minmax(0, 1fr))',
              gridTemplateRows: '1fr',
              gap: '24px',
              alignItems: 'stretch',
            }}
          >
            {/* LEFT: browser + stat cards */}
            <div style={{ gridColumn: 'span 7', display: 'flex', flexDirection: 'column', gap: '16px', minHeight: 0 }}>
              <EmbeddedLiveView streamTabActive={activeTab === 'stream'} />

              {/* QUICK STREAM STAT CARDS */}
              <div className="grid grid-cols-3 gap-3 shrink-0">
                <div className="bg-slate-900 border border-slate-800 p-3 rounded-xl flex items-center gap-3">
                  <div className="p-2 bg-purple-500/10 text-purple-400 rounded-lg">
                    <MessageSquare className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-200">{chatMessages.length} TOTAL MESSAGES</p>
                    <p className="text-[10px] text-slate-400">Messages This Stream</p>
                  </div>
                </div>
                <div className="bg-slate-900 border border-slate-800 p-3 rounded-xl flex items-center gap-3">
                  <div className="p-2 bg-emerald-500/10 text-emerald-400 rounded-lg">
                    <Mic className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-200">{ttsQueue.length} TOTAL TTS USES</p>
                    <p className="text-[10px] text-slate-400">Text To Speech Usage</p>
                  </div>
                </div>
                <div className="bg-slate-900 border border-slate-800 p-3 rounded-xl flex items-center gap-3">
                  <div className="p-2 bg-rose-500/10 text-rose-400 rounded-lg">
                    <Music className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-200">{totalSongRequests} SONG REQUESTS</p>
                    <p className="text-[10px] text-slate-400">Song Request Usage</p>
                  </div>
                </div>
              </div>
            </div>

            {/* RIGHT: Live chat panel */}
            <div style={{ gridColumn: 'span 5', height: '100%', minHeight: 0 }}>
              <LiveChatPanel
                chatMessages={chatMessages}
                onSendMessage={handleSendMessage}
                onClearChat={() => setChatMessages([])}
                onLaunchScraperSession={handleLaunchScraperSession}
                isConnected={isScraperLive || streamStats.isConnected}
              />
            </div>
          </div>

          {/* ── TAB: AUTOMATED ENGAGEMENT ── */}
          <div
            style={{
              position: 'absolute', inset: 0, overflowY: 'auto', overflowX: 'hidden', padding: '24px',
              display: activeTab === 'alerts' ? 'grid' : 'none',
              gridTemplateColumns: 'repeat(12, minmax(0, 1fr))',
              gridTemplateRows: 'auto 1fr',
              gap: '24px',
              zIndex: 30,
              background: 'rgb(2 6 23)',
            }}
          >
            {/* PAGE HEADER — full width */}
            <div style={{ gridColumn: 'span 12' }} className="flex items-center justify-between gap-3 shrink-0 self-start">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-amber-500/10 text-amber-400 rounded-xl">
                  <Sparkles className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-100">Automated Engagement Alerts</h3>
                  <p className="text-xs text-slate-400">Configure auto-responses for Stream events. Use placeholders <code className="text-amber-300">&#123;user&#125;</code>, <code className="text-amber-300">&#123;gift&#125;</code>, <code className="text-amber-300">&#123;value&#125;</code>.</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (window.confirm('Reset alert templates to default messages?')) {
                    setAlerts({
                      welcomeMessage: 'Welcome to the live stream {user}! Thanks for dropping in!',
                      welcomeTTS: true, welcomeEnabled: true, welcomeInBattles: true, welcomeCooldownSeconds: 0,
                      giftMessage: 'WOW! Thank you {user} for the amazing {gift} ({value} Diamonds)! You rock!',
                      giftTTS: true, giftEnabled: true, giftInBattles: true, giftCooldownSeconds: 0,
                      followMessage: 'Thank you {user} for joining the MoodBot community follow list!',
                      followTTS: false, followEnabled: true, followInBattles: true, followCooldownSeconds: 0,
                    });
                  }
                }}
                className="px-2.5 py-1.5 bg-slate-950 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 text-slate-400 hover:text-slate-200 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors shrink-0"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>Reset Defaults</span>
              </button>
            </div>

            {/* WELCOME ALERT CARD — col span 4 */}
            <div style={{ gridColumn: 'span 4' }} className="flex flex-col min-h-0">
              <div className={`bg-slate-900 border border-slate-800 rounded-2xl shadow-xl flex flex-col h-full transition-opacity ${alerts.welcomeEnabled === false ? 'opacity-70' : ''}`}>
                <div className="px-5 py-4 border-b border-slate-800 shrink-0 space-y-3">
                  <div className="flex items-center gap-2">
                    <User className="h-4 w-4 text-purple-400 shrink-0" />
                    <span className="text-xs font-bold text-slate-200">New Viewer Welcome Alert</span>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                      <button type="button" disabled={alerts.welcomeEnabled === false}
                        onClick={() => setAlerts({ ...alerts, welcomeInBattles: !(alerts.welcomeInBattles ?? true) })}
                        className={`px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all disabled:opacity-40 ${alerts.welcomeInBattles !== false ? 'bg-amber-500/10 text-amber-400 border border-amber-500/30 hover:bg-amber-500/20' : 'bg-slate-900 text-slate-500 border border-slate-800 hover:bg-slate-800'}`}>
                        <Swords className="h-3.5 w-3.5" />{alerts.welcomeInBattles !== false ? 'In Battles: ON' : 'In Battles: OFF'}
                      </button>
                      <button type="button" onClick={() => setAlerts({ ...alerts, welcomeEnabled: !(alerts.welcomeEnabled ?? true) })}
                        className={`px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all ${alerts.welcomeEnabled !== false ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20' : 'bg-slate-900 text-slate-500 border border-slate-800 hover:bg-slate-800'}`}>
                        <Power className="h-3.5 w-3.5" />{alerts.welcomeEnabled !== false ? 'Enabled' : 'Disabled'}
                      </button>
                      <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-slate-300">
                        <span>TTS</span>
                        <input type="checkbox" checked={alerts.welcomeTTS} disabled={alerts.welcomeEnabled === false}
                          onChange={(e) => setAlerts({ ...alerts, welcomeTTS: e.target.checked })}
                          className="rounded bg-slate-800 border-slate-700 text-purple-600 focus:ring-0 h-4 w-4 disabled:opacity-50" />
                      </label>
                  </div>
                </div>
                <div className="p-5 flex flex-col flex-1 gap-4 min-h-0">
                  <div className="space-y-1.5 shrink-0">
                    <label className="block text-[11px] font-bold text-slate-400">Template Message</label>
                    <input type="text" value={alerts.welcomeMessage} disabled={alerts.welcomeEnabled === false}
                      onChange={(e) => setAlerts({ ...alerts, welcomeMessage: e.target.value })}
                      className={`w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-purple-500 ${alerts.welcomeEnabled === false ? 'opacity-40 cursor-not-allowed' : ''}`} />
                  </div>
                  <div className="flex flex-col flex-1 gap-1.5 min-h-0">
                    <div className="flex items-center justify-between shrink-0">
                      <label className="text-[11px] font-bold text-slate-400">TTS Voice</label>
                      <button type="button" disabled={alerts.welcomeEnabled === false}
                        onClick={() => { const s = (alerts.welcomeMessage||'Welcome {user}').replace('{user}','Viewer'); const v = alerts.welcomeVoiceURI==='__random__' ? (() => { const en=availableVoices.filter(v=>v.Locale.toLowerCase().startsWith('en-')); return en[Math.floor(Math.random()*en.length)]?.ShortName; })() : alerts.welcomeVoiceURI; audioEngine.speakTTS(s,v); }}
                        className="text-[10px] text-purple-400 hover:text-purple-300 font-bold flex items-center gap-1 disabled:opacity-40">
                        <Volume2 className="h-3 w-3" /> Test
                      </button>
                    </div>
                    <select value={alerts.welcomeVoiceURI || ''} disabled={alerts.welcomeEnabled === false}
                      onChange={(e) => setAlerts({ ...alerts, welcomeVoiceURI: e.target.value })}
                      size={10}
                      className={`flex-1 w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-slate-200 focus:outline-none focus:border-purple-500 ${alerts.welcomeEnabled === false ? 'opacity-40 cursor-not-allowed' : ''}`}>
                      <option value="__random__">🎲 Random Voice</option>
                      {availableVoices.map((v) => <option key={v.ShortName} value={v.ShortName}>{formatVoiceName(v.FriendlyName)}</option>)}
                    </select>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <label className="text-[11px] font-bold text-slate-400 whitespace-nowrap">Cooldown</label>
                    <input type="number" min={0} max={3600} step={1} disabled={alerts.welcomeEnabled === false}
                      value={alerts.welcomeCooldownSeconds ?? 0}
                      onChange={(e) => setAlerts({ ...alerts, welcomeCooldownSeconds: Math.max(0, Number(e.target.value)||0) })}
                      className={`w-20 bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-purple-500 text-center ${alerts.welcomeEnabled === false ? 'opacity-40 cursor-not-allowed' : ''}`} />
                    <span className={`text-[11px] text-slate-500 ${alerts.welcomeEnabled === false ? 'opacity-40' : ''}`}>sec (0 = no cooldown)</span>
                  </div>
                </div>
              </div>
            </div>

            {/* GIFT ALERT CARD — col span 4 */}
            <div style={{ gridColumn: 'span 4' }} className="flex flex-col min-h-0">
              <div className={`bg-slate-900 border border-slate-800 rounded-2xl shadow-xl flex flex-col h-full transition-opacity ${alerts.giftEnabled === false ? 'opacity-70' : ''}`}>
                <div className="px-5 py-4 border-b border-slate-800 shrink-0 space-y-3">
                  <div className="flex items-center gap-2">
                    <Gift className="h-4 w-4 text-amber-400 shrink-0" />
                    <span className="text-xs font-bold text-slate-200">Gift Received Alert</span>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <button type="button" disabled={alerts.giftEnabled === false}
                      onClick={() => setAlerts({ ...alerts, giftInBattles: !(alerts.giftInBattles ?? true) })}
                      className={`px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all disabled:opacity-40 ${alerts.giftInBattles !== false ? 'bg-amber-500/10 text-amber-400 border border-amber-500/30 hover:bg-amber-500/20' : 'bg-slate-900 text-slate-500 border border-slate-800 hover:bg-slate-800'}`}>
                      <Swords className="h-3.5 w-3.5" />{alerts.giftInBattles !== false ? 'In Battles: ON' : 'In Battles: OFF'}
                    </button>
                    <button type="button" onClick={() => setAlerts({ ...alerts, giftEnabled: !(alerts.giftEnabled ?? true) })}
                      className={`px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all ${alerts.giftEnabled !== false ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20' : 'bg-slate-900 text-slate-500 border border-slate-800 hover:bg-slate-800'}`}>
                      <Power className="h-3.5 w-3.5" />{alerts.giftEnabled !== false ? 'Enabled' : 'Disabled'}
                    </button>
                    <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-slate-300">
                      <span>TTS</span>
                      <input type="checkbox" checked={alerts.giftTTS} disabled={alerts.giftEnabled === false}
                        onChange={(e) => setAlerts({ ...alerts, giftTTS: e.target.checked })}
                        className="rounded bg-slate-800 border-slate-700 text-purple-600 focus:ring-0 h-4 w-4 disabled:opacity-50" />
                    </label>
                  </div>
                </div>
                <div className="p-5 flex flex-col flex-1 gap-4 min-h-0">
                  <div className="space-y-1.5 shrink-0">
                    <label className="block text-[11px] font-bold text-slate-400">Template Message</label>
                    <input type="text" value={alerts.giftMessage} disabled={alerts.giftEnabled === false}
                      onChange={(e) => setAlerts({ ...alerts, giftMessage: e.target.value })}
                      className={`w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-amber-500 ${alerts.giftEnabled === false ? 'opacity-40 cursor-not-allowed' : ''}`} />
                    <p className="text-[10px] text-slate-500">Placeholders: <span className="text-slate-400 font-mono">{'{user}'}</span> sender · <span className="text-slate-400 font-mono">{'{gift}'}</span> gift name · <span className="text-slate-400 font-mono">{'{recipient}'}</span> receiver · <span className="text-slate-400 font-mono">{'{value}'}</span> diamonds</p>
                  </div>
                  <div className="flex flex-col flex-1 gap-1.5 min-h-0">
                    <div className="flex items-center justify-between shrink-0">
                      <label className="text-[11px] font-bold text-slate-400">TTS Voice</label>
                      <button type="button" disabled={alerts.giftEnabled === false}
                        onClick={() => { const s = (alerts.giftMessage||'Thank you {user} for {gift}').replace('{user}','Gifter').replace('{gift}','Rose').replace('{recipient}','Dani').replace('{value}','100'); const v = alerts.giftVoiceURI==='__random__' ? (() => { const en=availableVoices.filter(v=>v.Locale.toLowerCase().startsWith('en-')); return en[Math.floor(Math.random()*en.length)]?.ShortName; })() : alerts.giftVoiceURI; audioEngine.speakTTS(s,v); }}
                        className="text-[10px] text-amber-400 hover:text-amber-300 font-bold flex items-center gap-1 disabled:opacity-40">
                        <Volume2 className="h-3 w-3" /> Test
                      </button>
                    </div>
                    <select value={alerts.giftVoiceURI || ''} disabled={alerts.giftEnabled === false}
                      onChange={(e) => setAlerts({ ...alerts, giftVoiceURI: e.target.value })}
                      size={10}
                      className={`flex-1 w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-slate-200 focus:outline-none focus:border-amber-500 ${alerts.giftEnabled === false ? 'opacity-40 cursor-not-allowed' : ''}`}>
                      <option value="__random__">🎲 Random Voice</option>
                      {availableVoices.map((v) => <option key={v.ShortName} value={v.ShortName}>{formatVoiceName(v.FriendlyName)}</option>)}
                    </select>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <label className="text-[11px] font-bold text-slate-400 whitespace-nowrap">Cooldown</label>
                    <input type="number" min={0} max={3600} step={1} disabled={alerts.giftEnabled === false}
                      value={alerts.giftCooldownSeconds ?? 0}
                      onChange={(e) => setAlerts({ ...alerts, giftCooldownSeconds: Math.max(0, Number(e.target.value)||0) })}
                      className={`w-20 bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-amber-500 text-center ${alerts.giftEnabled === false ? 'opacity-40 cursor-not-allowed' : ''}`} />
                    <span className={`text-[11px] text-slate-500 ${alerts.giftEnabled === false ? 'opacity-40' : ''}`}>sec (0 = no cooldown)</span>
                  </div>
                </div>
              </div>
            </div>

            {/* FOLLOW ALERT CARD — col span 4 */}
            <div style={{ gridColumn: 'span 4' }} className="flex flex-col min-h-0">
              <div className={`bg-slate-900 border border-slate-800 rounded-2xl shadow-xl flex flex-col h-full transition-opacity ${alerts.followEnabled === false ? 'opacity-70' : ''}`}>
                <div className="px-5 py-4 border-b border-slate-800 shrink-0 space-y-3">
                  <div className="flex items-center gap-2">
                    <Heart className="h-4 w-4 text-rose-400 shrink-0" />
                    <span className="text-xs font-bold text-slate-200">New Follower Alert</span>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <button type="button" disabled={alerts.followEnabled === false}
                      onClick={() => setAlerts({ ...alerts, followInBattles: !(alerts.followInBattles ?? true) })}
                      className={`px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all disabled:opacity-40 ${alerts.followInBattles !== false ? 'bg-amber-500/10 text-amber-400 border border-amber-500/30 hover:bg-amber-500/20' : 'bg-slate-900 text-slate-500 border border-slate-800 hover:bg-slate-800'}`}>
                      <Swords className="h-3.5 w-3.5" />{alerts.followInBattles !== false ? 'In Battles: ON' : 'In Battles: OFF'}
                    </button>
                    <button type="button" onClick={() => setAlerts({ ...alerts, followEnabled: !(alerts.followEnabled ?? true) })}
                      className={`px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all ${alerts.followEnabled !== false ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20' : 'bg-slate-900 text-slate-500 border border-slate-800 hover:bg-slate-800'}`}>
                      <Power className="h-3.5 w-3.5" />{alerts.followEnabled !== false ? 'Enabled' : 'Disabled'}
                    </button>
                    <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-slate-300">
                      <span>TTS</span>
                      <input type="checkbox" checked={alerts.followTTS} disabled={alerts.followEnabled === false}
                        onChange={(e) => setAlerts({ ...alerts, followTTS: e.target.checked })}
                        className="rounded bg-slate-800 border-slate-700 text-purple-600 focus:ring-0 h-4 w-4 disabled:opacity-50" />
                    </label>
                  </div>
                </div>
                <div className="p-5 flex flex-col flex-1 gap-4 min-h-0">
                  <div className="space-y-1.5 shrink-0">
                    <label className="block text-[11px] font-bold text-slate-400">Template Message</label>
                    <input type="text" value={alerts.followMessage} disabled={alerts.followEnabled === false}
                      onChange={(e) => setAlerts({ ...alerts, followMessage: e.target.value })}
                      className={`w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-rose-500 ${alerts.followEnabled === false ? 'opacity-40 cursor-not-allowed' : ''}`} />
                  </div>
                  <div className="flex flex-col flex-1 gap-1.5 min-h-0">
                    <div className="flex items-center justify-between shrink-0">
                      <label className="text-[11px] font-bold text-slate-400">TTS Voice</label>
                      <button type="button" disabled={alerts.followEnabled === false}
                        onClick={() => { const s = (alerts.followMessage||'Thanks for following {user}').replace('{user}','Follower'); const v = alerts.followVoiceURI==='__random__' ? (() => { const en=availableVoices.filter(v=>v.Locale.toLowerCase().startsWith('en-')); return en[Math.floor(Math.random()*en.length)]?.ShortName; })() : alerts.followVoiceURI; audioEngine.speakTTS(s,v); }}
                        className="text-[10px] text-rose-400 hover:text-rose-300 font-bold flex items-center gap-1 disabled:opacity-40">
                        <Volume2 className="h-3 w-3" /> Test
                      </button>
                    </div>
                    <select value={alerts.followVoiceURI || ''} disabled={alerts.followEnabled === false}
                      onChange={(e) => setAlerts({ ...alerts, followVoiceURI: e.target.value })}
                      size={10}
                      className={`flex-1 w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-slate-200 focus:outline-none focus:border-rose-500 ${alerts.followEnabled === false ? 'opacity-40 cursor-not-allowed' : ''}`}>
                      <option value="__random__">🎲 Random Voice</option>
                      {availableVoices.map((v) => <option key={v.ShortName} value={v.ShortName}>{formatVoiceName(v.FriendlyName)}</option>)}
                    </select>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <label className="text-[11px] font-bold text-slate-400 whitespace-nowrap">Cooldown</label>
                    <input type="number" min={0} max={3600} step={1} disabled={alerts.followEnabled === false}
                      value={alerts.followCooldownSeconds ?? 0}
                      onChange={(e) => setAlerts({ ...alerts, followCooldownSeconds: Math.max(0, Number(e.target.value)||0) })}
                      className={`w-20 bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-rose-500 text-center ${alerts.followEnabled === false ? 'opacity-40 cursor-not-allowed' : ''}`} />
                    <span className={`text-[11px] text-slate-500 ${alerts.followEnabled === false ? 'opacity-40' : ''}`}>sec (0 = no cooldown)</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ── TAB: COMMAND PERMISSIONS ── */}
          <div
            style={{
              position: 'absolute', inset: 0, overflow: 'hidden', padding: '24px',
              display: activeTab === 'permissions' ? 'block' : 'none',
              zIndex: 30,
              background: 'rgb(2 6 23)',
            }}
          >
            <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl flex flex-col h-full">
              {/* FIXED HEADER */}
              <div className="px-6 py-5 border-b border-slate-800 shrink-0 flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-purple-500/10 text-purple-400 rounded-xl">
                    <Shield className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-100">Command Permissions</h3>
                    <p className="text-xs text-slate-400">
                      Choose which badges can use each command. Any selected badge may trigger it.
                      <br />
                      Deselect all badges on a command to disable it entirely.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setCommandPermissions({ ...DEFAULT_COMMAND_PERMISSIONS })}
                  className="px-2.5 py-1.5 bg-slate-950 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 text-slate-400 hover:text-slate-200 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors shrink-0"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Reset Defaults
                </button>
              </div>
              {/* SCROLLABLE COMMAND LIST */}
              <div className="flex-1 overflow-y-auto no-scrollbar p-6 space-y-3">
                  {(Object.keys(commandPermissions) as BotCommand[]).map((cmd) => {
                    const descriptions: Record<BotCommand, string> = {
                      '!sr':         'Request a song from YouTube',
                      '!skip':       'Skip the current song',
                      '!clearqueue': 'Clear the entire song queue',
                      '!pause':      'Pause music playback',
                      '!play':       'Resume music playback',
                      '!volume':     'Set the music volume (0–100)',
                      '!tts':        'Trigger Text-To-Speech',
                      '!commands':   'Show the commands list',
                      '!schedule':   'Show the next scheduled stream',
                    };
                    const badgeStyles: Record<CommandPermissionLevel, { pill: string; dot: string }> = {
                      'everyone':   { pill: 'bg-slate-700 border-slate-600 text-slate-200',   dot: 'bg-slate-400' },
                      'Bouncer':    { pill: 'bg-blue-500/20 border-blue-500/40 text-blue-200',   dot: 'bg-blue-400' },
                      'Boss VIP':   { pill: 'bg-amber-500/20 border-amber-500/40 text-amber-200',  dot: 'bg-amber-400' },
                      'Black VIP':  { pill: 'bg-slate-600/50 border-slate-500/50 text-slate-200',  dot: 'bg-slate-300' },
                      'Purple VIP': { pill: 'bg-purple-500/20 border-purple-500/40 text-purple-200', dot: 'bg-purple-400' },
                      'Green VIP':  { pill: 'bg-emerald-500/20 border-emerald-500/40 text-emerald-200', dot: 'bg-emerald-400' },
                      'Top Badge':  { pill: 'bg-rose-500/20 border-rose-500/40 text-rose-200',  dot: 'bg-rose-400' },
                    };
                    const allowed = commandPermissions[cmd];
                    const toggleBadge = (lvl: CommandPermissionLevel) => {
                      setCommandPermissions((prev) => {
                        const cur = prev[cmd];
                        const next = cur.includes(lvl) ? cur.filter((b) => b !== lvl) : [...cur, lvl];
                        return { ...prev, [cmd]: next };
                      });
                    };
                    return (
                      <div
                        key={cmd}
                        className="bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 hover:border-slate-700 transition-colors space-y-2.5"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <span className="text-xs font-mono font-bold text-purple-300">{cmd}</span>
                            <p className="text-[10px] text-slate-500 mt-0.5">{descriptions[cmd]}</p>
                          </div>
                          {allowed.length === 0 && (
                            <span className="text-[10px] font-semibold text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg px-2 py-0.5 shrink-0">Disabled</span>
                          )}
                          {allowed.length > 0 && allowed.length === ALL_BADGES.length && (
                            <span className="text-[10px] font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-2 py-0.5 shrink-0">All badges</span>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {BADGE_HIERARCHY.map((lvl) => {
                            const active = allowed.includes(lvl);
                            const s = badgeStyles[lvl];
                            return (
                              <button
                                key={lvl}
                                type="button"
                                onClick={() => toggleBadge(lvl)}
                                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-semibold transition-all ${
                                  active
                                    ? s.pill
                                    : 'bg-transparent border-slate-700 text-slate-600 hover:border-slate-500 hover:text-slate-400'
                                }`}
                              >
                                {active && <span className={`w-1.5 h-1.5 rounded-full ${s.dot} shrink-0`} />}
                                {lvl === 'everyone' ? 'Everyone' : lvl}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          </div>

          {/* ── TAB: MUSIC PLAYER & QUEUE ── */}
          <div
            style={{
              position: 'absolute', inset: 0, overflow: 'hidden', padding: '24px',
              display: activeTab === 'music' ? 'grid' : 'none',
              gridTemplateColumns: 'repeat(12, minmax(0, 1fr))', gap: '24px',
              zIndex: 30,
              background: 'rgb(2 6 23)',
            }}
          >
            {/* LEFT COL — player + queue */}
            <div style={{ gridColumn: 'span 7', height: '100%', minHeight: 0 }}>
              <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl flex flex-col h-full">
                {/* HEADER */}
                <div className="px-5 py-4 border-b border-slate-800 shrink-0">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <div className="p-2 bg-purple-500/10 text-purple-400 rounded-lg">
                        <Music className="h-4 w-4" />
                      </div>
                      <div>
                        <h3 className="text-sm font-semibold text-slate-100 leading-tight">Music Player &amp; Queue</h3>
                        <p className="text-[10px] text-slate-500 mt-0.5">
                          <code className="text-purple-400">!sr</code>
                          <span className="mx-1 text-slate-600">·</span>
                          <code className="text-purple-400">!skip</code>
                          <span className="mx-1 text-slate-600">·</span>
                          <code className="text-purple-400">!pause</code>
                          <span className="mx-1 text-slate-600">·</span>
                          <code className="text-purple-400">!play</code>
                          <span className="mx-1 text-slate-600">·</span>
                          <code className="text-purple-400">!clearqueue</code>
                        </p>
                      </div>
                    </div>

                    {/* CONTROLS */}
                    <div className="flex items-center gap-1.5">
                      {/* Requests toggle */}
                      <button
                        onClick={() => setSongRequestsEnabled(!songRequestsEnabled)}
                        className={`h-8 px-3 rounded-lg text-[11px] font-semibold transition-all flex items-center gap-1.5 border ${
                          songRequestsEnabled
                            ? 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border-emerald-500/25'
                            : 'bg-slate-800 hover:bg-slate-700 text-slate-400 border-slate-700'
                        }`}
                        title={songRequestsEnabled ? 'Requests ON – click to disable' : 'Requests OFF – click to enable'}
                      >
                        <span className={`h-1.5 w-1.5 rounded-full ${songRequestsEnabled ? 'bg-emerald-400' : 'bg-slate-500'}`} />
                        {songRequestsEnabled ? 'Requests ON' : 'Requests OFF'}
                      </button>

                      {/* Divider */}
                      <div className="h-5 w-px bg-slate-700 mx-0.5" />

                      {/* Play / Pause */}
                      <button
                        onClick={() => {
                          const next = !isPlayingMusic;
                          isPlayingMusicRef.current = next;
                          setIsPlayingMusic(next);
                          if (next) {
                            window.electronAPI?.playYouTube?.();
                          } else {
                            window.electronAPI?.pauseYouTube?.();
                          }
                        }}
                        className="h-8 w-8 flex items-center justify-center bg-purple-600 hover:bg-purple-500 text-white rounded-lg transition-all"
                        title={isPlayingMusic ? 'Pause (!pause)' : 'Resume (!play)'}
                      >
                        {isPlayingMusic ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                      </button>

                      {/* Skip */}
                      <button
                        onClick={() => {
                          // Reset announce state so the next song triggers a "Now Playing"
                          // chat message, and clear the requester attribution for autoplay.
                          pendingSkipRef.current = true;
                          lastAnnouncedTitleRef.current = '';
                          setMusicQueue((prev) => {
                            const next = prev.slice(1);
                            if (next.length === 0) {
                              lastRequesterRef.current = '';
                              setActiveYoutubeSong(null);
                            }
                            return next;
                          });
                        }}
                        disabled={musicQueue.length === 0}
                        className="h-8 w-8 flex items-center justify-center bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-slate-300 rounded-lg transition-all"
                        title="Skip (!skip)"
                      >
                        <SkipForward className="h-3.5 w-3.5" />
                      </button>

                      {/* Clear queue */}
                      <button
                        onClick={() => {
                          lastAnnouncedTitleRef.current = '';
                          lastRequesterRef.current = '';
                          setActiveYoutubeSong(null);
                          setMusicQueue([]);
                        }}
                        disabled={musicQueue.length === 0}
                        className="h-8 w-8 flex items-center justify-center bg-slate-800 hover:bg-rose-500/20 disabled:opacity-30 text-slate-400 hover:text-rose-400 rounded-lg transition-all"
                        title="Clear queue (!clearqueue)"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>

                {/* NOW PLAYING + QUEUE — scrollable body */}
                <div className="flex-1 overflow-y-auto no-scrollbar p-5 space-y-3">
                {/* CURRENT SONG DISPLAY */}
                {(() => {
                  const queuedSong = musicQueue.length > 0 ? musicQueue[0] : null;
                  // Show queued/bot-requested song first; fall back to live YouTube title or activeYoutubeSong
                  const displaySong = queuedSong ?? activeYoutubeSong;
                  const liveTitle   = youtubeLiveTitle;

                  if (displaySong) {
                    const isQueued = !!queuedSong;
                    return (
                      <div className="p-3.5 bg-slate-950/70 rounded-xl border border-purple-500/20 flex items-center gap-3.5">
                        <img
                          src={displaySong.thumbnailUrl || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=150'}
                          alt="Album Cover"
                          className="h-14 w-14 rounded-lg object-cover ring-1 ring-purple-500/30 shrink-0"
                        />
                        <div className="flex-1 min-w-0">
                          <span className="text-[9px] uppercase tracking-widest font-bold text-purple-400 opacity-80">Now Playing</span>
                          <h4 className="text-sm font-semibold text-slate-100 truncate leading-tight mt-0.5">
                            {displaySong.title || liveTitle || 'Unknown Track'}
                          </h4>
                          {isQueued ? (
                            <p className="text-[11px] text-slate-500 mt-0.5">{displaySong.artist || 'YouTube Track'} · @{displaySong.requestedBy}</p>
                          ) : (
                            <p className="text-[11px] text-slate-500 mt-0.5">Auto-playing · YouTube Tab</p>
                          )}
                        </div>
                        <span className="text-[11px] font-mono text-purple-300/70 bg-purple-950/60 px-2 py-0.5 rounded border border-purple-500/20 shrink-0">
                          {displaySong.duration || 'LIVE'}
                        </span>
                      </div>
                    );
                  }

                  // No queued/active song — show live YouTube title if available
                  if (liveTitle) {
                    return (
                      <div className="p-3.5 bg-slate-950/70 rounded-xl border border-slate-700/50 flex items-center gap-3.5">
                        <div className="h-14 w-14 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center shrink-0">
                          <Youtube className="h-6 w-6 text-rose-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <span className="text-[9px] uppercase tracking-widest font-bold text-rose-400 opacity-80">Now Playing</span>
                          <h4 className="text-sm font-semibold text-slate-100 truncate leading-tight mt-0.5">{liveTitle}</h4>
                          <p className="text-[11px] text-slate-500 mt-0.5">Auto-playing · YouTube Tab</p>
                        </div>
                        <span className="text-[11px] font-mono text-rose-300/70 bg-rose-950/40 px-2 py-0.5 rounded border border-rose-500/20 shrink-0">
                          LIVE
                        </span>
                      </div>
                    );
                  }

                  return (
                    <div className="py-10 flex flex-col items-center gap-2 text-center">
                      <Music className="h-7 w-7 text-slate-700" />
                      <p className="text-xs font-medium text-slate-500">No song currently playing</p>
                      <p className="text-[10px] text-slate-600">Load a track in the YouTube tab or request with <code className="text-purple-500">!sr &lt;song&gt;</code></p>
                    </div>
                  );
                })()}

                {/* QUEUE LIST */}
                <div>
                  <div className="flex items-center justify-between mb-2 px-0.5">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                      Up Next
                      {musicQueue.length > 1 && <span className="ml-1.5 text-slate-600">({Math.max(0, musicQueue.length - 1)})</span>}
                    </p>
                  </div>
                  {musicQueue.slice(1).length === 0 ? (
                    <p className="text-[11px] text-slate-600 px-0.5">Queue is empty</p>
                  ) : (
                    <div className="space-y-1.5">
                      {musicQueue.slice(1).map((song, idx) => (
                        <div key={song.id} className="group px-3 py-2.5 bg-slate-950/60 rounded-lg border border-slate-800/80 flex items-center gap-3 hover:border-slate-700 transition-colors">
                          <span className="text-[10px] font-mono text-slate-600 w-4 shrink-0">{idx + 1}</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-[11px] font-medium text-slate-200 truncate">{song.title}</p>
                            <p className="text-[10px] text-slate-500">@{song.requestedBy}</p>
                          </div>
                          {song.duration && (
                            <span className="text-[10px] font-mono text-slate-500 shrink-0">{song.duration}</span>
                          )}
                          <button
                            onClick={() => setMusicQueue(prev => prev.filter(s => s.id !== song.id))}
                            className="opacity-0 group-hover:opacity-100 text-slate-600 hover:text-rose-400 transition-all p-0.5 shrink-0"
                            title="Remove"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                </div>{/* end scrollable body */}
              </div>
            </div>

            {/* RIGHT COL — keyword blocker */}
            <div style={{ gridColumn: 'span 5', height: '100%', minHeight: 0 }}>
              <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl flex flex-col h-full">
                <div className="px-6 py-5 border-b border-slate-800 shrink-0 flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2">
                    <Ban className="h-4 w-4 text-rose-400" />
                    <h4 className="text-sm font-bold text-slate-100">Song Request Keyword Blocker</h4>
                  </div>
                  <div className="flex items-center gap-3">
                    <button onClick={() => setBlockedSongKeywords(['earrape', 'explicit', 'nazi', 'screamer', 'troll'])}
                      className="text-[11px] text-slate-400 hover:text-rose-300 font-medium transition-colors flex items-center gap-1">
                      <RotateCcw className="h-3 w-3 text-slate-500" /><span>Reset Defaults</span>
                    </button>
                    {blockedSongKeywords.length > 0 && (
                      <button onClick={() => setBlockedSongKeywords([])}
                        className="text-[11px] text-slate-500 hover:text-rose-400 font-medium transition-colors">
                        Clear All
                      </button>
                    )}
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto no-scrollbar p-6 space-y-4">
                  <p className="text-[11px] text-slate-400">
                    Chat song requests (<code className="text-purple-300 font-mono">!sr</code>) containing any blocked word will be automatically rejected.
                  </p>
                  <div className="flex items-center gap-2">
                    <input type="text" value={newBlockedKeywordInput}
                      onChange={(e) => setNewBlockedKeywordInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleAddBlockedKeyword()}
                      placeholder="Add blocked keyword…"
                      className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-rose-500/50" />
                    <button onClick={handleAddBlockedKeyword}
                      className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-xl text-xs transition-all flex items-center gap-1.5 shrink-0">
                      <Plus className="h-3.5 w-3.5" /> Add Keyword
                    </button>
                  </div>
                  {blockedSongKeywords.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {blockedSongKeywords.map((kw) => (
                        <span key={kw} className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold bg-rose-500/10 text-rose-300 border border-rose-500/20">
                          {kw}
                          <button onClick={() => handleRemoveBlockedKeyword(kw)} className="text-rose-400 hover:text-white transition-colors" title={`Remove "${kw}"`}>
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div className="p-3 bg-slate-950/40 rounded-xl border border-slate-800/60 text-center flex items-center justify-between">
                      <span className="text-[11px] text-slate-500">No keywords currently blocked.</span>
                      <button onClick={() => setBlockedSongKeywords(['earrape', 'explicit', 'nazi', 'screamer', 'troll'])}
                        className="text-xs text-rose-400 hover:text-rose-300 font-bold underline transition-colors">
                        Load Presets
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* ── TAB: TTS ENGINE ── */}
          <div
            style={{
              position: 'absolute', inset: 0, overflow: 'hidden', padding: '24px',
              display: activeTab === 'tts' ? 'grid' : 'none',
              gridTemplateColumns: 'repeat(12, minmax(0, 1fr))', gap: '24px',
              zIndex: 30,
              background: 'rgb(2 6 23)',
            }}
          >
            {/* LEFT COL — voice config */}
            <div style={{ gridColumn: 'span 7', height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl flex flex-col h-full">
                <div className="px-6 py-5 border-b border-slate-800 shrink-0 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className={`p-2.5 rounded-xl transition-colors ${ttsConfig.enabled !== false ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
                      {ttsConfig.enabled !== false ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-bold text-slate-100">Text-To-Speech Engine</h3>
                        <span className={`px-2 py-0.5 text-[10px] font-bold rounded-full border ${ttsConfig.enabled !== false ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' : 'bg-rose-500/10 text-rose-400 border-rose-500/30'}`}>
                          {ttsConfig.enabled !== false ? 'ENABLED' : 'DISABLED'}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400">Chat trigger: <code className="text-emerald-300">!tts &lt;message&gt;</code></p>
                    </div>
                  </div>
                  <button type="button"
                    onClick={() => setTtsConfig((prev) => ({ ...prev, enabled: prev.enabled === false ? true : false }))}
                    className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 border shadow-sm ${ttsConfig.enabled !== false ? 'bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border-rose-500/30' : 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border-emerald-500/30'}`}>
                    {ttsConfig.enabled !== false ? <><MicOff className="h-4 w-4 text-rose-400" />Disable TTS</> : <><Mic className="h-4 w-4 text-emerald-400" />Enable TTS</>}
                  </button>
                </div>
                <div className="flex-1 min-h-0 p-6 flex flex-col gap-4">
                  <div className="space-y-1.5 flex-1 min-h-0 flex flex-col">
                    <label className="block text-xs font-bold text-slate-300 shrink-0">Select Speech Voice</label>
                    <input type="text" placeholder="Filter voices by name or language…" value={voiceFilter}
                      onChange={(e) => setVoiceFilter(e.target.value)}
                      className="w-full shrink-0 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-400 placeholder-slate-600 focus:outline-none focus:border-purple-500" />
                    <select value={ttsConfig.voiceURI} onChange={(e) => setTtsConfig({ ...ttsConfig, voiceURI: e.target.value })}
                      className="w-full flex-1 min-h-0 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-200" size={4}>
                      <option value="__random__">🎲 Random Voice</option>
                      {availableVoices.filter(v => { if (!voiceFilter) return true; const q = voiceFilter.toLowerCase(); return formatVoiceName(v.FriendlyName).toLowerCase().includes(q) || v.Locale.toLowerCase().includes(q); }).map(v => (
                        <option key={v.ShortName} value={v.ShortName}>{formatVoiceName(v.FriendlyName)}</option>
                      ))}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-4 shrink-0">
                    <div>
                      <label className="block text-xs font-bold text-slate-300 mb-2">Pitch ({ttsConfig.pitch}x)</label>
                      <input type="range" min="0.5" max="1.5" step="0.1" value={ttsConfig.pitch}
                        onChange={(e) => setTtsConfig({ ...ttsConfig, pitch: Number(e.target.value) })}
                        className="w-full accent-emerald-500 cursor-pointer" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-300 mb-2">Speech Rate ({ttsConfig.rate}x)</label>
                      <input type="range" min="0.5" max="1.5" step="0.1" value={ttsConfig.rate}
                        onChange={(e) => setTtsConfig({ ...ttsConfig, rate: Number(e.target.value) })}
                        className="w-full accent-emerald-500 cursor-pointer" />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* RIGHT COL — test + history */}
            <div style={{ gridColumn: 'span 5', height: '100%', minHeight: 0 }}>
              <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl flex flex-col h-full">
                <div className="px-6 py-5 border-b border-slate-800 shrink-0">
                  <h3 className="text-sm font-bold text-slate-100">Test & History</h3>
                  <p className="text-xs text-slate-400 mt-0.5">Speak a test phrase and review recent TTS usage</p>
                </div>
                <div className="p-6 shrink-0 border-b border-slate-800 space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="block text-xs font-bold text-slate-300">Test TTS Voice Synthesis</label>
                    {ttsConfig.enabled === false && (
                      <span className="text-[11px] text-rose-400 font-bold flex items-center gap-1">
                        <AlertCircle className="h-3 w-3" /> TTS disabled
                      </span>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <input type="text" placeholder="Type a test phrase to read aloud..." value={ttsTestText}
                      onChange={(e) => setTtsTestText(e.target.value)} disabled={ttsConfig.enabled === false}
                      className="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2 text-xs text-slate-200 disabled:opacity-40" />
                    <button disabled={ttsConfig.enabled === false} onClick={() => { audioEngine.updateTTSConfig(ttsConfig); audioEngine.clearTTSQueue(); audioEngine.speakTTS(ttsTestText || 'Testing MoodBot TTS'); }}
                      className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white rounded-xl text-xs font-bold transition-all shadow-lg shadow-emerald-600/20 shrink-0">
                      Speak
                    </button>
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto no-scrollbar p-6 space-y-2">
                  <h4 className="text-xs font-bold text-slate-300 mb-3">Recent TTS History ({ttsQueue.length})</h4>
                  {ttsQueue.length === 0 && <p className="text-[11px] text-slate-500 text-center py-8">No TTS messages yet this session.</p>}
                  {ttsQueue.map(item => (
                    <div key={item.id} className="p-3 bg-slate-950 rounded-xl border border-slate-800 flex items-center justify-between text-xs">
                      <div><span className="font-bold text-slate-200">@{item.user}: </span><span className="text-slate-300">{item.text}</span></div>
                      <span className="text-[10px] text-slate-500">{item.timestamp}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* ── TAB: SOUNDBOARD KEYWORDS ── */}
          <div
            style={{
              position: 'absolute', inset: 0, overflow: 'hidden', padding: '24px',
              display: activeTab === 'soundboard' ? 'block' : 'none',
              zIndex: 30,
              background: 'rgb(2 6 23)',
            }}
          >
            <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl flex flex-col h-full">
              {/* FIXED HEADER */}
              <div className="px-6 py-5 border-b border-slate-800 shrink-0 flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-3">
                    <div className={`p-2.5 rounded-xl transition-colors ${soundboardEnabled ? 'bg-yellow-500/10 text-yellow-400' : 'bg-slate-800 text-slate-500'}`}>
                      <Disc className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-bold text-slate-100">Keyword Soundboard Triggers</h3>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${soundboardEnabled ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30' : 'bg-slate-800 text-slate-400 border border-slate-700'}`}>
                          {soundboardEnabled ? 'ACTIVE' : 'OFF'}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400">Chat keywords automatically trigger audio SFX.</p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setSoundboardEnabled((prev) => !prev)}
                    className={`px-3.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-2 transition-all border ${
                      soundboardEnabled
                        ? 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40 shadow-lg shadow-yellow-500/10 hover:bg-yellow-500/30'
                        : 'bg-slate-950 text-slate-400 border-slate-800 hover:bg-slate-800 hover:text-slate-200'
                    }`}
                  >
                    <Disc className={`h-4 w-4 ${soundboardEnabled ? 'text-yellow-400 animate-spin-slow' : 'text-slate-500'}`} />
                    <span>Soundboard: <strong className={soundboardEnabled ? 'text-yellow-400' : 'text-slate-500'}>{soundboardEnabled ? 'ENABLED' : 'DISABLED'}</strong></span>
                  </button>
              </div>{/* end fixed header */}
              {/* SCROLLABLE BODY */}
              <div className="flex-1 overflow-y-auto no-scrollbar p-6 space-y-6">
                {/* HIDDEN FILE INPUTS */}
                <input
                  type="file"
                  ref={soundFileInputRef}
                  onChange={handleSoundboardBatchUpload}
                  accept="audio/*"
                  multiple
                  className="hidden"
                />
                <input
                  type="file"
                  ref={singleAddFileInputRef}
                  onChange={handleSelectSingleAddFile}
                  accept="audio/*"
                  className="hidden"
                />
                <input
                  type="file"
                  ref={singleEditFileInputRef}
                  onChange={handleSelectSingleEditFile}
                  accept="audio/*"
                  className="hidden"
                />

                {/* TOP ACTIONS GRID: UPLOAD & MANUAL ADD */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* BATCH FILE UPLOAD / DRAG & DROP */}
                  <div
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                        processSoundboardFiles(e.dataTransfer.files);
                      }
                    }}
                    onClick={() => soundFileInputRef.current?.click()}
                    className="p-5 bg-slate-950/90 hover:bg-slate-950 border-2 border-dashed border-amber-500/30 hover:border-amber-400/60 rounded-xl flex flex-col items-center justify-center text-center gap-2 cursor-pointer transition-all group shadow-inner"
                  >
                    <div className="p-2.5 bg-amber-500/10 text-amber-400 group-hover:scale-110 rounded-xl transition-transform border border-amber-500/20">
                      <FolderPlus className="h-5 w-5" />
                    </div>
                    <div>
                      <span className="text-xs font-bold text-amber-300 group-hover:text-amber-200 block">
                        Batch Audio File Upload
                      </span>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        Drag & drop files or click to browse (.mp3, .wav, .ogg)
                      </p>
                    </div>
                    <span className="text-[10px] text-slate-500 bg-slate-900 px-2 py-0.5 rounded-full border border-slate-800">
                      ⚡ Filename automatically sets trigger keyword
                    </span>
                  </div>

                  {/* MANUAL ADD TRIGGER FORM */}
                  <div className="p-4 bg-slate-950 rounded-xl border border-slate-800 flex flex-col justify-between gap-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                        <Plus className="h-3.5 w-3.5 text-amber-400" />
                        Add Custom Trigger
                      </h4>
                      {newFileName && (
                        <span className="text-[10px] text-amber-400 font-mono truncate max-w-[120px]" title={newFileName}>
                          📁 {newFileName}
                        </span>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="text"
                        placeholder="Keyword (e.g. gg)"
                        value={newKeywordInput}
                        onChange={(e) => setNewKeywordInput(e.target.value)}
                        className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:border-amber-400 focus:outline-none"
                      />
                      <input
                        type="text"
                        placeholder="Title (e.g. GG Cheer)"
                        value={newTitleInput}
                        onChange={(e) => setNewTitleInput(e.target.value)}
                        className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:border-amber-400 focus:outline-none"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => singleAddFileInputRef.current?.click()}
                        className="bg-slate-900 hover:bg-slate-800 border border-slate-700 hover:border-amber-500/50 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-amber-400 flex items-center justify-center gap-1.5 transition-colors truncate"
                        title={newFileName ? `File: ${newFileName}` : 'Pick audio file'}
                      >
                        <Upload className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                        <span className="truncate">{newFileName ? 'Change Audio' : 'Pick Audio File'}</span>
                      </button>
                      <button
                        onClick={handleAddSoundTrigger}
                        disabled={!newKeywordInput.trim() || !newTitleInput.trim()}
                        className="py-1.5 bg-yellow-600 hover:bg-yellow-500 disabled:opacity-40 text-white font-bold rounded-lg text-xs transition-all shadow flex items-center justify-center gap-1"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        <span>Add Trigger</span>
                      </button>
                    </div>
                  </div>
                </div>

                {/* SOUNDBOARD TRIGGERS LIST HEADER */}
                <div className="flex items-center justify-between border-t border-slate-800 pt-4">
                  <h4 className="text-xs font-bold text-slate-300 flex items-center gap-2">
                    <span>Configured Triggers</span>
                    <span className="bg-slate-800 text-slate-400 px-2 py-0.5 rounded-full text-[10px] font-mono">
                      {soundTriggers.length}
                    </span>
                  </h4>

                  <button
                    onClick={() => {
                      if (window.confirm('Reset soundboard triggers to default sounds?')) {
                        setSoundTriggers(defaultSoundTriggers);
                      }
                    }}
                    className="text-[11px] text-slate-400 hover:text-yellow-300 font-medium transition-colors flex items-center gap-1"
                    title="Reset soundboard triggers to default sounds"
                  >
                    <RotateCcw className="h-3 w-3 text-slate-500" />
                    <span>Reset Defaults</span>
                  </button>
                </div>

                {/* TRIGGERS GRID */}
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                  {soundTriggers.map(snd => (
                    editingSoundId === snd.id ? (
                      <div key={snd.id} className="p-3.5 bg-slate-900 rounded-xl border border-yellow-500/50 flex flex-col gap-2.5 shadow-lg">
                        <div className="text-xs font-bold text-amber-400 flex items-center justify-between border-b border-slate-800 pb-1.5">
                          <span>Edit Sound Trigger</span>
                          <button onClick={handleCancelEditSound} className="text-slate-400 hover:text-slate-200">
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <div className="space-y-2">
                          <div>
                            <label className="text-[10px] text-slate-400 font-medium block mb-0.5">Keyword</label>
                            <input
                              type="text"
                              value={editKeywordInput}
                              onChange={(e) => setEditKeywordInput(e.target.value)}
                              className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 focus:border-amber-400 focus:outline-none"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] text-slate-400 font-medium block mb-0.5">Title</label>
                            <input
                              type="text"
                              value={editTitleInput}
                              onChange={(e) => setEditTitleInput(e.target.value)}
                              className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 focus:border-amber-400 focus:outline-none"
                            />
                          </div>
                          <div>
                            <button
                              type="button"
                              onClick={() => singleEditFileInputRef.current?.click()}
                              className="w-full py-1 bg-slate-950 hover:bg-slate-800 text-amber-400 border border-slate-700 rounded text-[11px] font-semibold flex items-center justify-center gap-1 transition-colors"
                            >
                              <Upload className="h-3 w-3" /> Replace Audio File
                            </button>
                            {editFileName && (
                              <p className="text-[10px] text-slate-400 font-mono truncate mt-1">{editFileName}</p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 pt-1">
                          <button
                            onClick={() => handleSaveEditSound(snd.id)}
                            className="flex-1 py-1.5 bg-yellow-600 hover:bg-yellow-500 text-white rounded-lg font-bold text-xs flex items-center justify-center gap-1 transition-colors"
                          >
                            <Check className="h-3.5 w-3.5" /> Save
                          </button>
                          <button
                            onClick={handleCancelEditSound}
                            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div key={snd.id} className="p-3.5 bg-slate-950 rounded-xl border border-slate-800/80 hover:border-slate-700 flex flex-col justify-between gap-3 transition-colors">
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-extrabold text-amber-300 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20 font-mono">
                              "{snd.keyword}"
                            </span>
                            <div className="flex items-center gap-1">
                              <label className="flex items-center cursor-pointer p-0.5" title={snd.enabled ? 'Enabled' : 'Disabled'}>
                                <input
                                  type="checkbox"
                                  checked={snd.enabled}
                                  onChange={() => {
                                    setSoundTriggers(prev => prev.map(s => s.id === snd.id ? { ...s, enabled: !s.enabled } : s));
                                  }}
                                  className="rounded bg-slate-800 border-slate-700 text-yellow-500 focus:ring-0 h-3.5 w-3.5 cursor-pointer"
                                />
                              </label>
                              <button
                                onClick={() => handleStartEditSound(snd)}
                                className="p-1 text-slate-400 hover:text-amber-300 hover:bg-slate-800 rounded transition-colors"
                                title="Edit Sound Trigger"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              <button
                                onClick={() => handleDeleteSoundTrigger(snd.id)}
                                className="p-1 text-slate-400 hover:text-rose-400 hover:bg-slate-800 rounded transition-colors"
                                title="Delete Sound Trigger"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                        </div>

                        <button
                          onClick={() => audioEngine.playSoundboardEffect(snd.soundType, snd.customDataUrl)}
                          className="w-full py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 text-slate-300 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
                        >
                          <Play className="h-3 w-3 text-yellow-400" /> Test SFX Trigger
                        </button>
                      </div>
                    )
                  ))}
                </div>
              </div>{/* end scrollable body */}
            </div>
          </div>

          {/* ── TAB: AUDIO MIXER ── */}
          <div
            style={{
              position: 'absolute', inset: 0, overflow: 'auto', padding: '24px',
              display: activeTab === 'mixer' ? 'grid' : 'none',
              gridTemplateColumns: 'repeat(12, minmax(0, 1fr))',
              gridTemplateRows: 'auto 1fr',
              gap: '20px',
              zIndex: 30,
              background: 'rgb(2 6 23)',
            }}
          >
            {/* ══ LEFT COL — channel strips (spans 7 cols) ══ */}
            <div style={{ gridColumn: 'span 7', gridRow: '1 / 3', minHeight: 0 }}>
              <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl flex flex-col">
                {/* Header */}
                <div className="px-6 py-5 border-b border-slate-800 shrink-0">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 bg-blue-500/10 text-blue-400 rounded-xl">
                        <Sliders className="h-5 w-5" />
                      </div>
                      <div>
                        <h3 className="text-sm font-bold text-slate-100">Audio Channel Mixer</h3>
                        <p className="text-xs text-slate-400">Independent volume control for music, TTS, and soundboard.</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                      <span className={`h-1.5 w-1.5 rounded-full ${isPlayingMusic ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'}`} />
                      {isPlayingMusic ? 'Live' : 'Idle'}
                    </div>
                  </div>
                </div>

                {/* Channel Strips */}
                <div className="p-6 flex flex-col gap-5">

                  {/* ── MUSIC CHANNEL ── */}
                  {(() => {
                    const vol = mixer.musicVolume;
                    const currentSong = musicQueue.length > 0 ? musicQueue[0] : activeYoutubeSong;
                    const trackTitle = currentSong?.title || youtubeLiveTitle || null;
                    const requester = currentSong?.requestedBy || null;
                    const pct = vol;
                    // color zones: 0-60 green, 61-85 yellow, 86-100 red
                    const barColor = pct <= 60 ? '#34d399' : pct <= 85 ? '#fbbf24' : '#f87171';
                    return (
                      <div className="p-5 bg-slate-950 rounded-xl border border-slate-800 flex flex-col gap-4">
                        {/* Row 1: label + status badge + value */}
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className="p-1.5 bg-rose-500/10 rounded-lg">
                              <Music className="h-4 w-4 text-rose-400" />
                            </div>
                            <div>
                              <p className="text-xs font-bold text-slate-100">Music Channel</p>
                              {trackTitle
                                ? <p className="text-[10px] text-slate-500 truncate max-w-[220px]">{trackTitle}{requester ? ` — @${requester}` : ''}</p>
                                : <p className="text-[10px] text-slate-600">No track playing</p>
                              }
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${isPlayingMusic ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30' : 'bg-slate-800 text-slate-500 border border-slate-700'}`}>
                              {isPlayingMusic ? '▶ PLAYING' : '⏸ PAUSED'}
                            </span>
                            <span className="font-mono text-lg font-bold text-rose-400 w-12 text-right">{vol}%</span>
                          </div>
                        </div>
                        {/* Row 2: VU meter bar */}
                        <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                          <div style={{ width: `${pct}%`, background: barColor, height: '100%', borderRadius: '9999px', transition: 'width 0.1s ease' }} />
                        </div>
                        {/* Row 3: slider */}
                        <input type="range" min="0" max="100" value={vol}
                          onChange={(e) => setMixer({ ...mixer, musicVolume: Number(e.target.value) })}
                          className="w-full accent-rose-500 cursor-pointer h-2" />
                        {/* Row 4: stats strip */}
                        <div className="flex items-center gap-4 pt-1 border-t border-slate-800">
                          <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
                            <Music className="h-3 w-3" />
                            <span>{totalSongRequests} requests this session</span>
                          </div>
                          <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
                            <Activity className="h-3 w-3" />
                            <span>Queue: {musicQueue.length} tracks</span>
                          </div>
                          <div className="flex items-center gap-1.5 text-[10px] text-slate-500 ml-auto">
                            <span className={songRequestsEnabled ? 'text-emerald-500' : 'text-slate-600'}>Requests {songRequestsEnabled ? 'ON' : 'OFF'}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  {/* ── TTS CHANNEL ── */}
                  {(() => {
                    const vol = mixer.ttsVolume;
                    const pct = vol;
                    const barColor = pct <= 60 ? '#34d399' : pct <= 85 ? '#fbbf24' : '#f87171';
                    const lastTts = ttsQueue[ttsQueue.length - 1];
                    return (
                      <div className="p-5 bg-slate-950 rounded-xl border border-slate-800 flex flex-col gap-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className="p-1.5 bg-emerald-500/10 rounded-lg">
                              <Mic className="h-4 w-4 text-emerald-400" />
                            </div>
                            <div>
                              <p className="text-xs font-bold text-slate-100">TTS Channel</p>
                              {lastTts
                                ? <p className="text-[10px] text-slate-500 truncate max-w-[220px]">Last: {lastTts.text?.slice(0, 40)}{(lastTts.text?.length ?? 0) > 40 ? '…' : ''}</p>
                                : <p className="text-[10px] text-slate-600">No TTS activity yet</p>
                              }
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${ttsConfig.enabled !== false ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30' : 'bg-slate-800 text-slate-500 border border-slate-700'}`}>
                              {ttsConfig.enabled !== false ? '● ENABLED' : '○ OFF'}
                            </span>
                            <span className="font-mono text-lg font-bold text-emerald-400 w-12 text-right">{vol}%</span>
                          </div>
                        </div>
                        <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                          <div style={{ width: `${pct}%`, background: barColor, height: '100%', borderRadius: '9999px', transition: 'width 0.1s ease' }} />
                        </div>
                        <input type="range" min="0" max="100" value={vol}
                          onChange={(e) => setMixer({ ...mixer, ttsVolume: Number(e.target.value) })}
                          className="w-full accent-emerald-500 cursor-pointer h-2" />
                        <div className="flex items-center gap-4 pt-1 border-t border-slate-800">
                          <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
                            <Mic className="h-3 w-3" />
                            <span>{ttsQueue.length} messages this session</span>
                          </div>
                          <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
                            <Volume2 className="h-3 w-3" />
                            <span>Voice: {ttsConfig.voiceURI?.split('-')[2]?.trim() ?? 'Default'}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  {/* ── SOUNDBOARD CHANNEL ── */}
                  {(() => {
                    const vol = mixer.soundboardVolume;
                    const pct = vol;
                    const barColor = pct <= 60 ? '#34d399' : pct <= 85 ? '#fbbf24' : '#f87171';
                    const activeTriggers = soundTriggers.filter(s => s.enabled).length;
                    return (
                      <div className="p-5 bg-slate-950 rounded-xl border border-slate-800 flex flex-col gap-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className="p-1.5 bg-yellow-500/10 rounded-lg">
                              <Disc className="h-4 w-4 text-yellow-400" />
                            </div>
                            <div>
                              <p className="text-xs font-bold text-slate-100">Soundboard Channel</p>
                              <p className="text-[10px] text-slate-500">{activeTriggers} of {soundTriggers.length} triggers active</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${soundboardEnabled ? 'bg-yellow-500/15 text-yellow-400 border border-yellow-500/30' : 'bg-slate-800 text-slate-500 border border-slate-700'}`}>
                              {soundboardEnabled ? '● ACTIVE' : '○ OFF'}
                            </span>
                            <span className="font-mono text-lg font-bold text-yellow-400 w-12 text-right">{vol}%</span>
                          </div>
                        </div>
                        <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                          <div style={{ width: `${pct}%`, background: barColor, height: '100%', borderRadius: '9999px', transition: 'width 0.1s ease' }} />
                        </div>
                        <input type="range" min="0" max="100" value={vol}
                          onChange={(e) => setMixer({ ...mixer, soundboardVolume: Number(e.target.value) })}
                          className="w-full accent-yellow-500 cursor-pointer h-2" />
                        <div className="flex items-center gap-4 pt-1 border-t border-slate-800">
                          {soundTriggers.slice(0, 3).map(s => (
                            <div key={s.id} className="flex items-center gap-1.5 text-[10px]">
                              <span className={`h-1.5 w-1.5 rounded-full ${s.enabled ? 'bg-yellow-400' : 'bg-slate-600'}`} />
                              <span className="text-slate-500">!{s.keyword}</span>
                            </div>
                          ))}
                          {soundTriggers.length > 3 && (
                            <span className="text-[10px] text-slate-600 ml-1">+{soundTriggers.length - 3} more</span>
                          )}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>
            </div>

            {/* ══ RIGHT COL — settings + status (spans 5 cols, 2 rows) ══ */}

            {/* NOW PLAYING card */}
            <div style={{ gridColumn: 'span 5', gridRow: '1' }}>
              <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl p-5 flex flex-col gap-4">
                <div className="flex items-center gap-2 mb-1">
                  <div className="p-1.5 bg-rose-500/10 rounded-lg text-rose-400"><Music className="h-4 w-4" /></div>
                  <h3 className="text-xs font-bold text-slate-100">Now Playing</h3>
                </div>
                {(() => {
                  const currentSong = musicQueue.length > 0 ? musicQueue[0] : activeYoutubeSong;
                  const title = currentSong?.title || youtubeLiveTitle;
                  const thumb = currentSong?.thumbnailUrl;
                  return title ? (
                    <div className="flex items-center gap-3">
                      {thumb && (
                        <img src={thumb} alt="thumb" className="h-12 w-12 rounded-lg object-cover border border-slate-700 shrink-0" />
                      )}
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-slate-100 truncate">{title}</p>
                        {currentSong?.requestedBy && (
                          <p className="text-[10px] text-slate-500">Requested by @{currentSong.requestedBy}</p>
                        )}
                        <div className="flex items-center gap-2 mt-1.5">
                          <div className="flex-1 h-1 bg-slate-800 rounded-full overflow-hidden">
                            <div className="h-full bg-rose-500 rounded-full" style={{ width: `${mixer.musicVolume}%` }} />
                          </div>
                          <span className="text-[10px] text-slate-500 font-mono">{mixer.musicVolume}%</span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3 py-1">
                      <div className="h-12 w-12 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center shrink-0">
                        <Music className="h-5 w-5 text-slate-600" />
                      </div>
                      <p className="text-xs text-slate-500">No track currently playing</p>
                    </div>
                  );
                })()}
                {/* Queue preview */}
                {musicQueue.length > 1 && (
                  <div className="border-t border-slate-800 pt-3">
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Up Next</p>
                    <div className="flex flex-col gap-1.5">
                      {musicQueue.slice(1, 4).map((s, i) => (
                        <div key={s.id ?? i} className="flex items-center gap-2 text-[11px] text-slate-400">
                          <span className="text-slate-600 font-mono w-3">{i + 2}</span>
                          <span className="truncate flex-1">{s.title || 'Unknown'}</span>
                          {s.requestedBy && <span className="text-slate-600 shrink-0">@{s.requestedBy}</span>}
                        </div>
                      ))}
                      {musicQueue.length > 4 && <p className="text-[10px] text-slate-600">+{musicQueue.length - 4} more in queue</p>}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* PLAYBACK SETTINGS + SESSION STATS card */}
            <div style={{ gridColumn: 'span 5', gridRow: '2' }}>
              <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl flex flex-col gap-0 overflow-hidden">
                {/* Playback behavior */}
                <div className="px-5 py-4 border-b border-slate-800">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="p-1.5 bg-blue-500/10 rounded-lg text-blue-400"><Settings className="h-4 w-4" /></div>
                    <h3 className="text-xs font-bold text-slate-100">Playback Settings</h3>
                  </div>
                  <div className="flex flex-col gap-3">
                    <div className="flex items-start justify-between gap-4 p-3 bg-slate-950 rounded-xl border border-slate-800">
                      <div>
                        <p className="text-xs font-bold text-slate-200">Pause Music During Audio</p>
                        <p className="text-[10px] text-slate-500 mt-0.5">Ducks music when TTS or soundboard effects play, then auto-resumes.</p>
                      </div>
                      <label className="flex items-center cursor-pointer shrink-0 mt-0.5">
                        <input type="checkbox" checked={mixer.musicPauseEnabled}
                          onChange={(e) => setMixer({ ...mixer, musicPauseEnabled: e.target.checked })}
                          className="rounded bg-slate-800 border-slate-700 text-blue-600 focus:ring-0 h-4 w-4" />
                      </label>
                    </div>
                    <div className="flex items-start justify-between gap-4 p-3 bg-slate-950 rounded-xl border border-slate-800">
                      <div>
                        <p className="text-xs font-bold text-slate-200">Song Requests</p>
                        <p className="text-[10px] text-slate-500 mt-0.5">Allow viewers to queue music with !song in chat.</p>
                      </div>
                      <label className="flex items-center cursor-pointer shrink-0 mt-0.5">
                        <input type="checkbox" checked={songRequestsEnabled}
                          onChange={(e) => setSongRequestsEnabled(e.target.checked)}
                          className="rounded bg-slate-800 border-slate-700 text-blue-600 focus:ring-0 h-4 w-4" />
                      </label>
                    </div>
                    <div className="flex items-start justify-between gap-4 p-3 bg-slate-950 rounded-xl border border-slate-800">
                      <div>
                        <p className="text-xs font-bold text-slate-200">Soundboard Triggers</p>
                        <p className="text-[10px] text-slate-500 mt-0.5">Play sound effects when chat triggers a keyword.</p>
                      </div>
                      <label className="flex items-center cursor-pointer shrink-0 mt-0.5">
                        <input type="checkbox" checked={soundboardEnabled}
                          onChange={(e) => setSoundboardEnabled(e.target.checked)}
                          className="rounded bg-slate-800 border-slate-700 text-blue-600 focus:ring-0 h-4 w-4" />
                      </label>
                    </div>
                  </div>
                </div>

                {/* Session stats */}
                <div className="px-5 py-4">
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-3">Session Stats</p>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 text-center">
                      <p className="text-lg font-bold text-rose-400 font-mono">{totalSongRequests}</p>
                      <p className="text-[10px] text-slate-500 mt-0.5">Song Requests</p>
                    </div>
                    <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 text-center">
                      <p className="text-lg font-bold text-emerald-400 font-mono">{ttsQueue.length}</p>
                      <p className="text-[10px] text-slate-500 mt-0.5">TTS Messages</p>
                    </div>
                    <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 text-center">
                      <p className="text-lg font-bold text-yellow-400 font-mono">{soundTriggers.filter(s => s.enabled).length}</p>
                      <p className="text-[10px] text-slate-500 mt-0.5">Active SFX</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ── TAB: STREAM SCHEDULE ── */}
          <div
            style={{
              position: 'absolute', inset: 0, overflow: 'hidden', padding: '24px',
              display: activeTab === 'schedule' ? 'block' : 'none',
              zIndex: 30,
              background: 'rgb(2 6 23)',
            }}
          >
            <ScheduleTab
              scheduleConfig={scheduleConfig}
              onConfigChange={setScheduleConfig}
            />
          </div>

          {/* ── TAB: SUPER SPEED HEARTS ── */}
          <div
            style={{
              position: 'absolute', inset: 0, overflow: 'hidden', padding: '24px',
              display: activeTab === 'hearts' ? 'block' : 'none',
              zIndex: 30,
              background: 'rgb(2 6 23)',
            }}
          >
            <HeartsTab isStreamConnected={isScraperLive || streamStats.isConnected} />
          </div>

          {/* ── TAB: GIFT PREVIEWER ── */}
          <div
            style={{
              position: 'absolute', inset: 0, overflow: 'hidden', padding: '24px',
              display: activeTab === 'gifts' ? 'block' : 'none',
              zIndex: 30,
              background: 'rgb(2 6 23)',
            }}
          >
            <GiftPreviewerTab
              chatMessages={chatMessages}
              isConnected={isScraperLive || streamStats.isConnected}
            />
          </div>

          {/* ── TAB: TIMED MESSAGES ── */}
          <div
            style={{
              position: 'absolute', inset: 0, overflow: 'hidden', padding: '24px',
              display: activeTab === 'timedmsg' ? 'block' : 'none',
              zIndex: 30,
              background: 'rgb(2 6 23)',
            }}
          >
            <TimedMessagesPanel
              config={timedMessagesConfig}
              onConfigChange={setTimedMessagesConfig}
              onSendMessage={handleSendMessage}
              chatMessageCount={chatMessages.length}
              isRunning={timedMsgRunning}
              onStart={() => setTimedMsgRunning(true)}
              onStop={() => setTimedMsgRunning(false)}
            />
          </div>

          {/* ── TAB: CUSTOM COMMANDS ── */}
          <div
            style={{
              position: 'absolute', inset: 0, overflow: 'hidden', padding: '24px',
              display: activeTab === 'customcmds' ? 'block' : 'none',
              zIndex: 30,
              background: 'rgb(2 6 23)',
            }}
          >
            <CustomCommandsTab
              commands={customCommands}
              onCommandsChange={setCustomCommands}
            />
          </div>

        </div>
      </main>
    </div>
  );
}
