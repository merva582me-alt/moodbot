/**
 * MoodBot Web Audio Engine
 * Handles TTS queueing, soundboard SFX synthesis, and music pause/resume
 * around audio events.  The old volume-ducking approach has been replaced
 * with a simple pause-before / resume-after strategy so YouTube music is
 * cleanly silenced for the duration of every TTS or soundboard clip —
 * regardless of whether the trigger came from a user gesture or a background
 * IPC message.
 *
 * YouTube playback lives in a separate Electron WebContentsView; control is
 * exercised via IPC callbacks registered by App.tsx on mount.
 */

import { AudioMixerState, TTSConfig, EdgeTTSVoice } from '../types';

// ── Unicode fancy-font → plain ASCII transliteration ─────────────────────────
// Social-media "font generators" use dozens of Unicode blocks to fake styled
// text. Edge TTS cannot pronounce any of them, so we map every styled codepoint
// back to its plain ASCII equivalent before synthesis.
//
// Coverage (A-Z / a-z / 0-9 mapped unless noted):
//   • Mathematical Alphanumeric Symbols (U+1D400–U+1D7FF) — all 13 styles
//   • Letterlike Symbols BMP holes (ℬℰℱ… filling the Math block gaps)
//   • Fullwidth Latin + digits (U+FF10–U+FF5A)
//   • Enclosed Alphanumerics: circled (Ⓐ–ⓩ), parenthesised (⒜–⒵ / 🄐–🄩)
//   • Enclosed Alphanumeric Supplement: squared (🄰–🅉), neg-squared (🅰–🆉),
//     neg-circled (🅐–🅩), regional indicators (🇦–🇿)
//   • Small caps / phonetic extensions (U+1D00–U+1D22, U+1D2C–U+1D65)
//   • Modifier superscript letters (ᴬ–ᵂ / ᵃ–ᵛ)
//   • Superscript digits (⁰¹²³⁴⁵⁶⁷⁸⁹) and subscript digits (₀–₉)
//   • Subscript letters (ₐₑₒₓ…)
//   • Circled / dingbat digit variants (①–⑨ ❶–❾ ⓵–⓾ ⓪⓿)

const _FANCY_MAP: Record<number, string> = (() => {
  const map: Record<number, string> = {};

  // Each entry: [blockStart, baseCharCode, count]
  // baseCharCode: 65='A', 97='a', 48='0'
  const ranges: [number, number, number][] = [
    // ── Mathematical Alphanumeric Symbols (U+1D400–U+1D7FF) ──────────────────
    // Mathematical Bold
    [0x1D400, 65, 26], [0x1D41A, 97, 26],
    // Mathematical Italic
    [0x1D434, 65, 26], [0x1D44E, 97, 26],
    // Mathematical Bold Italic
    [0x1D468, 65, 26], [0x1D482, 97, 26],
    // Mathematical Script
    [0x1D49C, 65, 26], [0x1D4B6, 97, 26],
    // Mathematical Bold Script
    [0x1D4D0, 65, 26], [0x1D4EA, 97, 26],
    // Mathematical Fraktur
    [0x1D504, 65, 26], [0x1D51E, 97, 26],
    // Mathematical Double-Struck
    [0x1D538, 65, 26], [0x1D552, 97, 26],
    // Mathematical Bold Fraktur
    [0x1D56C, 65, 26], [0x1D586, 97, 26],
    // Mathematical Sans-Serif
    [0x1D5A0, 65, 26], [0x1D5BA, 97, 26],
    // Mathematical Sans-Serif Bold
    [0x1D5D4, 65, 26], [0x1D5EE, 97, 26],
    // Mathematical Sans-Serif Italic
    [0x1D608, 65, 26], [0x1D622, 97, 26],
    // Mathematical Sans-Serif Bold Italic
    [0x1D63C, 65, 26], [0x1D656, 97, 26],
    // Mathematical Monospace
    [0x1D670, 65, 26], [0x1D68A, 97, 26],
    // Mathematical digit variants (bold, double-struck, sans, sans-bold, mono)
    [0x1D7CE, 48, 10], [0x1D7D8, 48, 10], [0x1D7E2, 48, 10],
    [0x1D7EC, 48, 10], [0x1D7F6, 48, 10],

    // ── Enclosed Alphanumerics (U+2400 block) ────────────────────────────────
    // Circled capital A-Z (Ⓐ–Ⓩ) and small a-z (ⓐ–ⓩ)
    [0x24B6, 65, 26], [0x24D0, 97, 26],
    // Parenthesised small a-z (⒜–⒵)
    [0x249C, 97, 26],

    // ── Enclosed Alphanumeric Supplement (U+1F100–U+1F1FF) ───────────────────
    // Parenthesised capital A-Z (🄐–🄩)
    [0x1F110, 65, 26],
    // Squared capital A-Z (🄰–🅉)
    [0x1F130, 65, 26],
    // Negative circled capital A-Z (🅐–🅩)
    [0x1F150, 65, 26],
    // Negative squared capital A-Z (🅰–🆉)
    [0x1F170, 65, 26],
    // Regional indicator symbols A-Z (🇦–🇿)
    [0x1F1E6, 65, 26],
  ];

  for (const [start, base, count] of ranges) {
    for (let i = 0; i < count; i++) {
      map[start + i] = String.fromCharCode(base + i);
    }
  }

  // Fullwidth: Ａ–Ｚ (U+FF21–U+FF3A), ａ–ｚ (U+FF41–U+FF5A), ０–９ (U+FF10–U+FF19)
  for (let i = 0; i < 26; i++) map[0xFF21 + i] = String.fromCharCode(65 + i);
  for (let i = 0; i < 26; i++) map[0xFF41 + i] = String.fromCharCode(97 + i);
  for (let i = 0; i < 10; i++) map[0xFF10 + i] = String.fromCharCode(48 + i);

  // Subscript digits ₀–₉ (U+2080–U+2089)
  for (let i = 0; i < 10; i++) map[0x2080 + i] = String.fromCharCode(48 + i);

  // Circled digit variants: ①–⑨ (U+2460), ❶–❾ (U+2776), ⓵–⓾ (U+24F5)
  for (let i = 0; i < 9; i++) map[0x2460 + i] = String.fromCharCode(49 + i); // 1-9
  for (let i = 0; i < 9; i++) map[0x2776 + i] = String.fromCharCode(49 + i); // 1-9 dingbat
  for (let i = 0; i < 9; i++) map[0x2477 + i] = String.fromCharCode(49 + i); // 1-9 dingbat alt
  for (let i = 0; i < 9; i++) map[0x24F5 + i] = String.fromCharCode(49 + i); // ⓵–⓾ (1-9 double)
  map[0x24FF] = '0'; // ⓿ circled digit zero
  map[0x24EA] = '0'; // ⓪ circled zero

  // Individual outliers — BMP holes in the Mathematical Alphanumeric block
  // (pre-existing Unicode chars that were reused instead of assigning new cps)
  const singles: [number, string][] = [
    // Mathematical Italic / Script holes
    [0x210E, 'h'], // ℎ PLANCK CONSTANT (italic h)
    [0x212C, 'B'], // ℬ SCRIPT CAPITAL B
    [0x2130, 'E'], // ℰ SCRIPT CAPITAL E
    [0x2131, 'F'], // ℱ SCRIPT CAPITAL F
    [0x210B, 'H'], // ℋ SCRIPT CAPITAL H
    [0x2110, 'I'], // ℐ SCRIPT CAPITAL I
    [0x2112, 'L'], // ℒ SCRIPT CAPITAL L
    [0x2133, 'M'], // ℳ SCRIPT CAPITAL M
    [0x211B, 'R'], // ℛ SCRIPT CAPITAL R
    [0x212F, 'e'], // ℯ SCRIPT SMALL E
    [0x210A, 'g'], // ℊ SCRIPT SMALL G
    [0x2134, 'o'], // ℴ SCRIPT SMALL O
    // Fraktur holes
    [0x212D, 'C'], // ℭ BLACK-LETTER CAPITAL C
    [0x210C, 'H'], // ℌ BLACK-LETTER CAPITAL H
    [0x2111, 'I'], // ℑ BLACK-LETTER CAPITAL I
    [0x211C, 'R'], // ℜ BLACK-LETTER CAPITAL R
    [0x2128, 'Z'], // ℨ BLACK-LETTER CAPITAL Z
    // Double-struck holes
    [0x2102, 'C'], // ℂ
    [0x210D, 'H'], // ℍ
    [0x2115, 'N'], // ℕ
    [0x2119, 'P'], // ℙ
    [0x211A, 'Q'], // ℚ
    [0x211D, 'R'], // ℝ
    [0x2124, 'Z'], // ℤ

    // Superscript digits (scattered across Latin-1 Supplement + Super/Subscripts block)
    [0x2070, '0'], // ⁰
    [0x00B9, '1'], // ¹
    [0x00B2, '2'], // ²
    [0x00B3, '3'], // ³
    [0x2074, '4'], // ⁴
    [0x2075, '5'], // ⁵
    [0x2076, '6'], // ⁶
    [0x2077, '7'], // ⁷
    [0x2078, '8'], // ⁸
    [0x2079, '9'], // ⁹
    // Superscript letters (modifier letters, U+1D2C–U+1D42 uppercase)
    [0x1D2C, 'A'], // ᴬ
    [0x1D2E, 'B'], // ᴮ
    [0x1D30, 'D'], // ᴰ
    [0x1D31, 'E'], // ᴱ
    [0x1D33, 'G'], // ᴳ
    [0x1D34, 'H'], // ᴴ
    [0x1D35, 'I'], // ᴵ
    [0x1D36, 'J'], // ᴶ
    [0x1D37, 'K'], // ᴷ
    [0x1D38, 'L'], // ᴸ
    [0x1D39, 'M'], // ᴹ
    [0x1D3A, 'N'], // ᴺ
    [0x1D3C, 'O'], // ᴼ
    [0x1D3E, 'P'], // ᴾ
    [0x1D3F, 'R'], // ᴿ
    [0x1D40, 'T'], // ᵀ
    [0x1D41, 'U'], // ᵁ
    [0x1D42, 'W'], // ᵂ
    // Superscript letters (U+1D43–U+1D65 lowercase)
    [0x1D43, 'a'], // ᵃ
    [0x1D47, 'b'], // ᵇ
    [0x1D48, 'd'], // ᵈ
    [0x1D49, 'e'], // ᵉ
    [0x1D4D, 'g'], // ᵍ
    [0x1D4F, 'k'], // ᵏ
    [0x1D50, 'm'], // ᵐ
    [0x1D52, 'o'], // ᵒ
    [0x1D56, 'p'], // ᵖ
    [0x1D57, 't'], // ᵗ
    [0x1D58, 'u'], // ᵘ
    [0x1D5B, 'v'], // ᵛ
    [0x1D62, 'i'], // ᵢ
    [0x1D63, 'r'], // ᵣ
    [0x1D64, 'u'], // ᵤ
    [0x1D65, 'v'], // ᵥ
    // Subscript letters (U+2090–U+209C)
    [0x2090, 'a'], // ₐ
    [0x2091, 'e'], // ₑ
    [0x2092, 'o'], // ₒ
    [0x2093, 'x'], // ₓ
    [0x2095, 'h'], // ₕ
    [0x2096, 'k'], // ₖ
    [0x2097, 'l'], // ₗ
    [0x2098, 'm'], // ₘ
    [0x2099, 'n'], // ₙ
    [0x209A, 'p'], // ₚ
    [0x209B, 's'], // ₛ
    [0x209C, 't'], // ₜ
    // Small capitals — Phonetic Extensions (U+1D00–U+1D22)
    [0x1D00, 'A'], // ᴀ SMALL CAPITAL A
    [0x1D04, 'C'], // ᴄ SMALL CAPITAL C
    [0x1D05, 'D'], // ᴅ SMALL CAPITAL D
    [0x1D06, 'D'], // ᴆ SMALL CAPITAL ETH → D
    [0x1D07, 'E'], // ᴇ SMALL CAPITAL E
    [0x1D0A, 'J'], // ᴊ SMALL CAPITAL J
    [0x1D0B, 'K'], // ᴋ SMALL CAPITAL K
    [0x1D0C, 'L'], // ᴌ SMALL CAPITAL L WITH STROKE → L
    [0x1D0D, 'M'], // ᴍ SMALL CAPITAL M
    [0x1D0E, 'N'], // ᴎ SMALL CAPITAL REVERSED N → N
    [0x1D0F, 'O'], // ᴏ SMALL CAPITAL O
    [0x1D18, 'P'], // ᴘ SMALL CAPITAL P
    [0x1D19, 'R'], // ᴙ SMALL CAPITAL REVERSED R → R
    [0x1D1A, 'R'], // ᴚ SMALL CAPITAL TURNED R → R
    [0x1D1B, 'T'], // ᴛ SMALL CAPITAL T
    [0x1D1C, 'U'], // ᴜ SMALL CAPITAL U
    [0x1D20, 'V'], // ᴠ SMALL CAPITAL V
    [0x1D21, 'W'], // ᴡ SMALL CAPITAL W
    [0x1D22, 'Z'], // ᴢ SMALL CAPITAL Z
  ];

  for (const [cp, ch] of singles) {
    map[cp] = ch;
  }

  return map;
})();

// Explicit map for Latin Extended / IPA characters that do NOT decompose via
// NFD into a base letter + combining mark (e.g. ƴ, ɛ, ɔ, ŋ, ƒ, etc.).
const _LATIN_EXT_MAP: Record<number, string> = (() => {
  const m: Record<number, string> = {};
  const pairs: [number, string][] = [
    // ── Latin Extended-B (U+0180–U+024F) non-decomposing chars ───────────────
    [0x0180, 'b'],  // ƀ b with stroke
    [0x0181, 'B'],  // Ɓ B with hook
    [0x0182, 'B'],  // Ƃ B with topbar
    [0x0183, 'b'],  // ƃ b with topbar
    [0x0187, 'C'],  // Ƈ C with hook
    [0x0188, 'c'],  // ƈ c with hook
    [0x0189, 'D'],  // Ɖ African D
    [0x018A, 'D'],  // Ɗ D with hook
    [0x018B, 'D'],  // Ƌ D with topbar
    [0x018C, 'd'],  // ƌ d with topbar
    [0x0191, 'F'],  // Ƒ F with hook
    [0x0192, 'f'],  // ƒ f with hook (florin)
    [0x0193, 'G'],  // Ɠ G with hook
    [0x0194, 'G'],  // Ɣ gamma → G
    [0x0195, 'hv'], // ƕ hv ligature
    [0x0197, 'I'],  // Ɨ I with stroke
    [0x0198, 'K'],  // Ƙ K with hook
    [0x0199, 'k'],  // ƙ k with hook
    [0x019A, 'l'],  // ƚ l with bar
    [0x019D, 'N'],  // Ɲ N with left hook
    [0x019E, 'n'],  // ƞ n with long right leg
    [0x019F, 'O'],  // Ɵ O with middle tilde
    [0x01A2, 'O'],  // Ƣ OI → O
    [0x01A3, 'o'],  // ƣ oi → o
    [0x01A4, 'P'],  // Ƥ P with hook
    [0x01A5, 'p'],  // ƥ p with hook
    [0x01AB, 't'],  // ƫ t with palatal hook
    [0x01AC, 'T'],  // Ƭ T with hook
    [0x01AD, 't'],  // ƭ t with hook
    [0x01AE, 'T'],  // Ʈ T with retroflex hook
    [0x01AF, 'U'],  // Ư U with horn → U (NFD won't split horn)
    [0x01B0, 'u'],  // ư u with horn
    [0x01B2, 'V'],  // Ʋ V with hook
    [0x01B3, 'Y'],  // Ƴ Y with hook
    [0x01B4, 'y'],  // ƴ y with hook
    [0x01B5, 'Z'],  // Ƶ Z with stroke
    [0x01B6, 'z'],  // ƶ z with stroke
    [0x01BF, 'w'],  // ƿ wynn → w
    [0x0243, 'B'],  // Ƀ B with stroke
    [0x0244, 'U'],  // Ʉ U bar
    [0x0245, 'V'],  // Ʌ turned V
    [0x024C, 'R'],  // Ɍ R with stroke
    [0x024D, 'r'],  // ɍ r with stroke
    [0x024E, 'Y'],  // Ɏ Y with stroke
    [0x024F, 'y'],  // ɏ y with stroke

    // ── IPA Extensions (U+0250–U+02AF) ───────────────────────────────────────
    [0x0250, 'a'], [0x0251, 'a'], [0x0252, 'a'], // ɐɑɒ turned/open a
    [0x0253, 'b'], // ɓ b with hook
    [0x0254, 'o'], // ɔ open o
    [0x0255, 'c'], // ɕ c with curl
    [0x0256, 'd'], [0x0257, 'd'], // ɖɗ d variants
    [0x0258, 'e'], [0x0259, 'e'], [0x025A, 'e'], // ɘəɚ e variants
    [0x025B, 'e'], // ɛ open e
    [0x025C, 'e'], [0x025D, 'e'], [0x025E, 'e'], // ɜɝɞ reversed e
    [0x025F, 'j'], // ɟ dotless j with stroke
    [0x0260, 'g'], [0x0261, 'g'], [0x0262, 'G'], // ɠɡɢ g variants
    [0x0263, 'g'], // ɣ gamma
    [0x0264, 'o'], // ɤ baby gamma → o
    [0x0265, 'h'], [0x0266, 'h'], [0x0267, 'h'], // ɥɦɧ h variants
    [0x0268, 'i'], [0x0269, 'i'], [0x026A, 'I'], // ɨɩɪ i variants
    [0x026B, 'l'], [0x026C, 'l'], [0x026D, 'l'], [0x026E, 'l'], // ɫɬɭɮ l variants
    [0x026F, 'm'], [0x0270, 'm'], [0x0271, 'm'], // ɯɰɱ m variants
    [0x0272, 'n'], [0x0273, 'n'], [0x0274, 'N'], // ɲɳɴ n variants
    [0x0275, 'o'], [0x0276, 'o'], [0x0277, 'o'], // ɵɶɷ o variants
    [0x0278, 'p'], // ɸ phi → p
    [0x0279, 'r'], [0x027A, 'r'], [0x027B, 'r'], // ɹɺɻ r variants
    [0x027C, 'r'], [0x027D, 'r'], [0x027E, 'r'], [0x027F, 'r'],
    [0x0280, 'R'], [0x0281, 'R'], // ʀʁ capital R variants
    [0x0282, 's'], [0x0283, 's'], // ʂʃ s variants
    [0x0284, 'j'], [0x0285, 's'], [0x0286, 's'], // ʄʅʆ
    [0x0287, 't'], [0x0288, 't'], // ʇʈ t variants
    [0x0289, 'u'], [0x028A, 'u'], [0x028B, 'v'], // ʉʊʋ u/v variants
    [0x028C, 'v'], [0x028D, 'w'], // ʌʍ
    [0x028E, 'y'], [0x028F, 'Y'], // ʎʏ y variants
    [0x0290, 'z'], [0x0291, 'z'], [0x0292, 'z'], [0x0293, 'z'], // ʐʑʒʓ z variants
    [0x0294, ''],  // ʔ glottal stop → silent
    [0x0295, ''],  // ʕ pharyngeal → silent
    [0x0299, 'B'], [0x029B, 'G'], [0x029C, 'H'], [0x029D, 'j'], [0x029F, 'L'],
    [0x02A0, 'q'],
    [0x02A3, 'dz'], [0x02A4, 'dz'], [0x02A5, 'dz'],
    [0x02A6, 'ts'], [0x02A7, 'ts'], [0x02A8, 'tc'],
  ];
  for (const [cp, ch] of pairs) m[cp] = ch;
  return m;
})();

/**
 * Converts fancy Unicode font characters (bold, italic, script, fraktur,
 * double-struck, fullwidth, etc.) to their plain ASCII equivalents, then
 * strips any remaining non-ASCII / non-printable / emoji characters.
 *
 * Also handles Latin-extended / accented characters (e.g. usernames like
 * "Śąƴ Lɛŝš") by:
 *   1. NFD-normalising so that composed diacritics split into base + combining
 *      mark, then stripping the combining marks (covers ś→s, ą→a, ŝ→s, etc.).
 *   2. Applying an explicit IPA/Latin-Ext map for characters that don't
 *      decompose (covers ƴ→y, ɛ→e, etc.).
 */
function transliterateFancyUnicode(text: string): string {
  // 1. Map styled Unicode letters/digits → plain ASCII
  const transliterated = [...text]
    .map(ch => {
      const cp = ch.codePointAt(0)!;
      return _FANCY_MAP[cp] ?? ch;
    })
    .join('');

  // 2. Strip emoji / pictographic symbols before further processing
  const noEmoji = transliterated
    .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, '');

  // 3. NFD-normalise: decomposes "ś" → "s" + combining-acute, etc.
  //    Then strip all Unicode combining/diacritic marks (category M).
  const nfdStripped = noEmoji.normalize('NFD').replace(/\p{M}/gu, '');

  // 4. Apply explicit IPA/Latin-Ext map for chars that survived NFD intact
  const latinMapped = [...nfdStripped]
    .map(ch => {
      const cp = ch.codePointAt(0)!;
      return _LATIN_EXT_MAP[cp] ?? ch;
    })
    .join('');

  // 5. Strip any remaining non-ASCII characters that TTS cannot pronounce
  return latinMapped
    .replace(/[^\x00-\x7F]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

class MoodBotAudioEngine {
  private audioCtx: AudioContext | null = null;
  private musicGainNode: GainNode | null = null;
  private ttsGainNode: GainNode | null = null;
  private sfxGainNode: GainNode | null = null;
  private masterGainNode: GainNode | null = null;

  /** Serial TTS queue — one utterance plays at a time. */
  private ttsQueue: Array<() => void> = [];
  private ttsSpeaking = false;

  /**
   * Counts overlapping audio sources that need the music paused.
   * Music is paused on 0→1 and resumed on N→0.
   */
  private pauseRefCount = 0;
  /** True if YouTube was playing at the moment the first pause was acquired. */
  private wasPlayingBeforePause = false;

  private state: AudioMixerState = {
    musicVolume: 100,
    ttsVolume: 100,
    soundboardVolume: 100,
    musicPauseEnabled: true,
  };

  private ttsConfig: TTSConfig = {
    voiceURI: '',
    pitch: 1.0,
    rate: 1.0,
    enabled: true,
  };

  private availableVoices: EdgeTTSVoice[] = [];

  // ── IPC callbacks registered by App.tsx ────────────────────────────────────

  /** Pauses YouTube playback via IPC. */
  private pauseYouTubeCallback?: () => void;

  /** Resumes YouTube playback via IPC. */
  private resumeYouTubeCallback?: () => void;

  /** Sets YouTube volume (0.0–1.0) via IPC — used for volume slider sync. */
  private setYouTubeVolumeCallback?: (volume: number) => void;

  /** Returns whether YouTube is currently in a playing (not user-paused) state. */
  private getIsPlayingCallback?: () => boolean;

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  constructor() {}

  public init() {
    if (this.audioCtx) return;
    try {
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtxClass) return;

      this.audioCtx = new AudioCtxClass();
      this.audioCtx.resume().catch(() => {});

      this.masterGainNode = this.audioCtx.createGain();
      this.masterGainNode.connect(this.audioCtx.destination);

      this.musicGainNode = this.audioCtx.createGain();
      this.musicGainNode.connect(this.masterGainNode);

      this.ttsGainNode = this.audioCtx.createGain();
      this.ttsGainNode.connect(this.masterGainNode);

      this.sfxGainNode = this.audioCtx.createGain();
      this.sfxGainNode.connect(this.masterGainNode);

      this.applyGainLevels();
    } catch (e) {
      console.warn('[AudioEngine] Could not initialize Web Audio Context:', e);
    }
  }

  // ── Callback registration ───────────────────────────────────────────────────

  public setPauseYouTubeHandler(cb: () => void) {
    this.pauseYouTubeCallback = cb;
  }

  public setResumeYouTubeHandler(cb: () => void) {
    this.resumeYouTubeCallback = cb;
  }

  public setYouTubeVolumeHandler(cb: (volume: number) => void) {
    this.setYouTubeVolumeCallback = cb;
  }

  public setGetIsPlayingHandler(cb: () => boolean) {
    this.getIsPlayingCallback = cb;
  }

  /** True while the engine is actively managing a pause (TTS/soundboard playing). */
  public isMidPause(): boolean {
    return this.pauseRefCount > 0;
  }

  // ── State accessors ─────────────────────────────────────────────────────────

  public getMixerState(): AudioMixerState {
    return { ...this.state };
  }

  public updateMixerState(newState: Partial<AudioMixerState>) {
    this.state = { ...this.state, ...newState };
    this.applyGainLevels();
  }

  public updateTTSConfig(newConfig: Partial<TTSConfig>) {
    this.ttsConfig = { ...this.ttsConfig, ...newConfig };
  }

  public updateAvailableVoices(voices: EdgeTTSVoice[]) {
    this.availableVoices = voices;
  }

  /** Discard any pending (not-yet-started) TTS utterances from the queue. */
  public clearTTSQueue() {
    this.ttsQueue = [];
  }

  // ── Internal helpers ────────────────────────────────────────────────────────

  private applyGainLevels() {
    // Sync YouTube volume via IPC (only when not currently managing pause)
    if (this.pauseRefCount === 0 && this.setYouTubeVolumeCallback) {
      this.setYouTubeVolumeCallback(this.state.musicVolume / 100);
    }

    if (!this.audioCtx) return;

    const ttsGain = this.state.ttsVolume / 100;
    const sfxGain = this.state.soundboardVolume / 100;
    const now = this.audioCtx.currentTime;

    if (this.ttsGainNode) this.ttsGainNode.gain.setValueAtTime(ttsGain, now);
    if (this.sfxGainNode) this.sfxGainNode.gain.setValueAtTime(sfxGain, now);
    if (this.musicGainNode) this.musicGainNode.gain.setValueAtTime(1.0, now);
  }

  /**
   * Acquire a music-pause hold.  The first acquire pauses YouTube.
   * Each matching release() call decrements the counter; when it hits 0
   * YouTube resumes.  A safety timer is always armed so a crashed caller
   * can never leave music permanently paused.
   */
  private acquirePause(safetyMs: number): () => void {
    if (!this.state.musicPauseEnabled) {
      // Return a no-op release so callers don't need to branch
      return () => {};
    }

    this.pauseRefCount += 1;
    if (this.pauseRefCount === 1) {
      // First acquire — record whether music was playing, then pause YouTube
      this.wasPlayingBeforePause = this.getIsPlayingCallback?.() ?? true;
      this.pauseYouTubeCallback?.();
    }

    let released = false;
    const safetyTimer = window.setTimeout(() => {
      if (!released) {
        released = true;
        this.releasePause();
      }
    }, safetyMs);

    return () => {
      if (!released) {
        released = true;
        window.clearTimeout(safetyTimer);
        this.releasePause();
      }
    };
  }

  private releasePause() {
    if (this.pauseRefCount <= 0) return;
    this.pauseRefCount -= 1;
    if (this.pauseRefCount === 0) {
      // Only resume if music was actually playing before the audio event interrupted it
      if (this.wasPlayingBeforePause) {
        this.resumeYouTubeCallback?.();
      }
    }
  }

  // ── TTS ─────────────────────────────────────────────────────────────────────

  /**
   * Speaks text via Edge TTS.  Music is paused for the duration of the clip.
   * Accepts an optional voiceURI override and/or end callback.
   */
  public speakTTS(
    text: string,
    voiceURIOverride?: string | (() => void),
    onEndCallback?: () => void
  ): Promise<void> {
    return new Promise((resolve) => {
      let targetVoiceURI: string | undefined;
      let callback: (() => void) | undefined = onEndCallback;

      if (typeof voiceURIOverride === 'function') {
        callback = voiceURIOverride;
      } else {
        targetVoiceURI = voiceURIOverride;
      }

      if (this.ttsConfig.enabled === false) {
        if (callback) callback();
        resolve();
        return;
      }

      this.init();
      if (this.audioCtx && this.audioCtx.state === 'suspended') {
        this.audioCtx.resume().catch(() => {});
      }

      this.ttsQueue.push(() => {
        // Transliterate fancy Unicode fonts → ASCII, then strip emoji/symbols
        const cleanText = transliterateFancyUnicode(text);
        if (!cleanText) {
          this.ttsSpeaking = false;
          this._drainTTSQueue();
          resolve();
          return;
        }

        // Resolve voice
        const resolvedConfigVoice =
          this.ttsConfig.voiceURI === '__random__' && this.availableVoices.length > 0
            ? (() => {
                const english = this.availableVoices.filter(v =>
                  v.Locale.toLowerCase().startsWith('en-')
                );
                if (!english.length) return undefined;
                return english[Math.floor(Math.random() * english.length)].ShortName;
              })()
            : this.ttsConfig.voiceURI;
        const activeVoice = targetVoiceURI || resolvedConfigVoice || 'en-US-AriaNeural';

        // Pause music BEFORE the IPC round-trip so the clip starts into silence.
        // Safety window: 30 s — the release() call below clears it as soon as
        // the audio finishes (or errors out).
        const release = this.acquirePause(30_000);

        let finished = false;
        const finish = () => {
          if (!finished) {
            finished = true;
            release();
          }
          if (callback) callback();
          resolve();
          this.ttsSpeaking = false;
          this._drainTTSQueue();
        };

        if (!window.electronAPI?.ttsSpeak) {
          console.warn('[AudioEngine] ttsSpeak IPC not available.');
          finish();
          return;
        }

        window.electronAPI
          .ttsSpeak({
            text: cleanText,
            voiceShortName: activeVoice,
            rate: this.ttsConfig.rate ?? 1.0,
            pitch: this.ttsConfig.pitch ?? 1.0,
          })
          .then((buffer) => {
            if (!buffer || !this.audioCtx || !this.ttsGainNode) {
              finish();
              return;
            }

            const arrayBuffer =
              buffer instanceof ArrayBuffer ? buffer : (buffer as any).buffer ?? buffer;

            this.audioCtx.decodeAudioData(
              arrayBuffer,
              (decoded) => {
                if (!this.audioCtx || !this.ttsGainNode) {
                  finish();
                  return;
                }

                const source = this.audioCtx.createBufferSource();
                source.buffer = decoded;
                source.connect(this.ttsGainNode);

                // Safety: if onended never fires force-drain after duration + 2 s
                const safetyTimer = setTimeout(
                  () => {
                    console.warn('[AudioEngine] TTS onended timeout — forcing drain');
                    finish();
                  },
                  (decoded.duration * 1000 + 2000) || 30_000
                );

                source.onended = () => {
                  clearTimeout(safetyTimer);
                  finish();
                };

                this.audioCtx.resume().then(() => {
                  try { source.start(); } catch (_) { clearTimeout(safetyTimer); finish(); }
                }).catch(() => {
                  try { source.start(); } catch (_) { clearTimeout(safetyTimer); finish(); }
                });
              },
              (err) => {
                console.error('[AudioEngine] decodeAudioData failed:', err);
                finish();
              }
            );
          })
          .catch((err) => {
            console.error('[AudioEngine] ttsSpeak IPC error:', err);
            finish();
          });
      });

      this._drainTTSQueue();
    });
  }

  /** Starts the next queued TTS utterance if nothing is currently speaking. */
  private _drainTTSQueue() {
    if (this.ttsSpeaking || this.ttsQueue.length === 0) return;
    this.ttsSpeaking = true;
    const next = this.ttsQueue.shift()!;
    next();
  }

  // ── Soundboard ──────────────────────────────────────────────────────────────

  /**
   * Plays a soundboard effect via Web Audio synthesis or a custom Data URL.
   * Music is paused for the duration of the clip.
   */
  public playSoundboardEffect(
    type: 'airhorn' | 'cheer' | 'drums' | 'ding' | 'custom',
    customDataUrl?: string
  ) {
    this.init();
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }

    // ── Custom (uploaded) sound ─────────────────────────────────────────────
    if (type === 'custom' && customDataUrl) {
      const release = this.acquirePause(30_000);
      let released = false;
      const releaseOnce = () => {
        if (!released) { released = true; release(); }
      };
      try {
        const audio = new Audio(customDataUrl);
        audio.volume = this.state.soundboardVolume / 100;
        audio.addEventListener('ended', releaseOnce, { once: true });
        audio.addEventListener('error', releaseOnce, { once: true });
        audio.play().catch((e) => {
          releaseOnce();
          console.warn('Custom sound play error:', e);
        });
      } catch (e) {
        releaseOnce();
        console.warn('Custom sound failed:', e);
      }
      return;
    }

    if (!this.audioCtx || !this.sfxGainNode) return;

    // Ensure sfxGainNode reflects current soundboard volume
    this.sfxGainNode.gain.setValueAtTime(
      this.state.soundboardVolume / 100,
      this.audioCtx.currentTime
    );

    switch (type) {
      case 'airhorn': {
        // ~900 ms clip
        const release = this.acquirePause(1200);
        const now = this.audioCtx.currentTime;
        [280, 293.66, 329.63].forEach((freq, idx) => {
          const osc = this.audioCtx!.createOscillator();
          const gain = this.audioCtx!.createGain();
          osc.type = 'sawtooth';
          osc.frequency.setValueAtTime(freq, now + idx * 0.15);
          osc.frequency.linearRampToValueAtTime(freq * 1.05, now + idx * 0.15 + 0.3);
          gain.gain.setValueAtTime(0, now + idx * 0.15);
          gain.gain.linearRampToValueAtTime(0.4, now + idx * 0.15 + 0.05);
          gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.15 + 0.35);
          osc.connect(gain);
          gain.connect(this.sfxGainNode!);
          osc.start(now + idx * 0.15);
          osc.stop(now + idx * 0.15 + 0.4);
        });
        // release after the clip ends
        window.setTimeout(release, 950);
        break;
      }

      case 'cheer': {
        // ~1500 ms clip
        const release = this.acquirePause(1800);
        const now = this.audioCtx.currentTime;
        const bufferSize = this.audioCtx.sampleRate * 1.5;
        const buffer = this.audioCtx.createBuffer(1, bufferSize, this.audioCtx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
        const noise = this.audioCtx.createBufferSource();
        noise.buffer = buffer;
        const filter = this.audioCtx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(1200, now);
        const gain = this.audioCtx.createGain();
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(0.3, now + 0.2);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 1.5);
        noise.connect(filter);
        filter.connect(gain);
        gain.connect(this.sfxGainNode);
        noise.start(now);
        noise.stop(now + 1.5);
        window.setTimeout(release, 1550);
        break;
      }

      case 'drums': {
        // ~1100 ms clip (8 hits × 120 ms)
        const release = this.acquirePause(1400);
        const now = this.audioCtx.currentTime;
        for (let i = 0; i < 8; i++) {
          const osc = this.audioCtx.createOscillator();
          const gain = this.audioCtx.createGain();
          const time = now + i * 0.12;
          osc.frequency.setValueAtTime(150 - i * 5, time);
          gain.gain.setValueAtTime(0.5, time);
          gain.gain.exponentialRampToValueAtTime(0.001, time + 0.1);
          osc.connect(gain);
          gain.connect(this.sfxGainNode);
          osc.start(time);
          osc.stop(time + 0.1);
        }
        window.setTimeout(release, 1150);
        break;
      }

      case 'ding':
      default: {
        // ~1200 ms clip
        const release = this.acquirePause(1500);
        const now = this.audioCtx.currentTime;
        const osc = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(1046.5, now);
        osc.frequency.exponentialRampToValueAtTime(1318.5, now + 0.1);
        gain.gain.setValueAtTime(0.5, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 1.2);
        osc.connect(gain);
        gain.connect(this.sfxGainNode);
        osc.start(now);
        osc.stop(now + 1.2);
        window.setTimeout(release, 1250);
        break;
      }
    }
  }
}

export const audioEngine = new MoodBotAudioEngine();
