import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Gift, RefreshCw, Search, Gem, AlertCircle, Loader2, X, Play, ChevronRight } from 'lucide-react';
import { ChatMessage, MeetMeGift, WheelOption } from '../types';
import lottie, { AnimationItem } from 'lottie-web';
import { useRive } from '@rive-app/react-canvas';

interface GiftPreviewerTabProps {
  chatMessages: ChatMessage[];
  isConnected: boolean;
}

interface IncomingGiftNotif {
  id: string;
  user: string;
  avatar: string;
  giftName: string;
  diamonds: number;
  thumbnailUrl: string;
  timestamp: string;
  catalogGift?: MeetMeGift;
}

/** Resolve the best image URL from a MeetMeGift object. */
function resolveGiftImage(g: MeetMeGift): string {
  return (g.imageUrl || g.thumbnailUrl || g.image || g.thumbnail || '') as string;
}

/** Resolve the diamond price from a MeetMeGift object. */
function resolveGiftPrice(g: MeetMeGift): number {
  return Number(g.diamonds ?? g.price ?? 0);
}

/** Pretty-format diamond amounts */
function fmtDiamonds(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'K';
  return n.toString();
}


// ── Lottie preview player ─────────────────────────────────────────────────────
function LottiePlayer({ url, onLoopComplete }: { url: string; onLoopComplete?: () => void }) {
  const containerRef        = useRef<HTMLDivElement>(null);
  const animRef             = useRef<AnimationItem | null>(null);
  const onLoopCompleteRef   = useRef(onLoopComplete);
  onLoopCompleteRef.current = onLoopComplete;

  useEffect(() => {
    if (!containerRef.current) return;
    animRef.current?.destroy();
    animRef.current = null;

    let cancelled  = false;
    let timerID: ReturnType<typeof setTimeout> | null = null;

    (async () => {
      const result = await window.electronAPI?.fetchAnimationAsset?.(url);
      if (cancelled || !containerRef.current) return;

      if (!result?.ok) {
        console.warn('[LottiePlayer] fetch failed:', result?.error, url);
        return;
      }

      // Decode base64 → UTF-8 bytes → JSON string → animationData object
      // (atob is Latin-1 only and corrupts multi-byte UTF-8; use TextDecoder instead)
      const binary = atob(result.data);
      const bytes  = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const json   = new TextDecoder('utf-8').decode(bytes);
      let animData: object;
      try { animData = JSON.parse(json); } catch (e) {
        console.warn('[LottiePlayer] JSON parse failed:', e);
        return;
      }

      animRef.current = lottie.loadAnimation({
        container:     containerRef.current,
        renderer:      'svg',
        loop:          true,
        autoplay:      true,
        animationData: animData,
      });

      if (onLoopCompleteRef.current) {
        // Fire after one full loop OR after the animation completes (non-looping),
        // whichever comes first. Also set a 3 s timeout as a safety fallback so
        // the wheel always advances even if neither event fires.
        let fired = false;
        const fire = () => {
          if (fired || cancelled) return;
          fired = true;
          if (timerID !== null) { clearTimeout(timerID); timerID = null; }
          onLoopCompleteRef.current?.();
        };
        animRef.current.addEventListener('loopComplete', fire);
        animRef.current.addEventListener('complete',     fire);
        timerID = setTimeout(fire, 3000);
      }
    })();

    return () => {
      cancelled = true;
      if (timerID !== null) clearTimeout(timerID);
      animRef.current?.destroy();
      animRef.current = null;
    };
  }, [url]);

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />;
}

// ── Rive preview player ───────────────────────────────────────────────────────
function RivePlayer({ url }: { url: string }) {
  const [buffer, setBuffer] = useState<ArrayBuffer | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const result = await window.electronAPI?.fetchAnimationAsset?.(url);
      if (cancelled) return;

      if (!result?.ok) {
        console.warn('[RivePlayer] fetch failed:', result?.error, url);
        return;
      }

      // Decode base64 → Uint8Array → ArrayBuffer
      const binary = atob(result.data);
      const bytes  = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      if (!cancelled) setBuffer(bytes.buffer);
    })();

    return () => {
      cancelled = true;
      setBuffer(null);
    };
  }, [url]);

  const { RiveComponent } = useRive(
    buffer ? { buffer, autoplay: true } : null,
  );

  if (!buffer) return <div style={{ width: '100%', height: '100%' }} />;
  return <RiveComponent style={{ width: '100%', height: '100%' }} />;
}

// ── Preview modal ─────────────────────────────────────────────────────────────
interface PreviewModalProps {
  gift: MeetMeGift;
  onClose: () => void;
}

/**
 * Phase of the wheel preview:
 *   'wheel'   – showing the wheel spin lottie
 *   'outcome' – showing a chosen outcome animation
 */
type WheelPhase = 'wheel' | 'spinning' | 'outcome';

function PreviewModal({ gift, onClose }: PreviewModalProps) {
  const lottieList  = gift.lottieList ?? [];
  const riveAnim    = gift.riveAnimation ?? null;
  const wheelOptions: WheelOption[] = gift.options ?? [];

  const isWheel  = wheelOptions.length > 0;
  const hasRive  = !!riveAnim?.src;
  const hasLottie = lottieList.length > 0;

  // Wheel-specific state: which phase we're in and which outcome is selected
  const [wheelPhase, setWheelPhase]       = useState<WheelPhase>('wheel');
  const [selectedOption, setSelectedOption] = useState<WheelOption | null>(null);
  // Animation index within a non-wheel lottie list (for regular gifts with multiple lotties)
  const [lottieIdx, setLottieIdx] = useState(0);
  // Incremented each time we start a new spin so LottiePlayer remounts & picks up the new callback
  const [spinKey, setSpinKey] = useState(0);
  // Incremented each time we directly show an outcome so LottiePlayer remounts even if URL is the same
  const [outcomeKey, setOutcomeKey] = useState(0);

  // Ref so LottiePlayer can notify us when the spin finishes one loop
  const onSpinCompleteRef = useRef<(() => void) | null>(null);

  const canPreview = hasRive || hasLottie || isWheel;

  /** Pick the most-common option: highest numeric percent, or first if unparseable.
   *  percent strings look like "6500/9161 (70.95%)" — extract the number in parens. */
  function defaultWheelOption(): WheelOption | null {
    if (!wheelOptions.length) return null;
    const parsePct = (s: string | undefined) => {
      const m = (s ?? '').match(/\(([0-9.]+)%\)/);
      return m ? parseFloat(m[1]) : 0;
    };
    return wheelOptions.reduce((best, opt) =>
      parsePct(opt.percent) > parsePct(best.percent) ? opt : best,
    wheelOptions[0]);
  }

  // Reset wheel state whenever the gift changes, then auto-spin the default prize
  useEffect(() => {
    onSpinCompleteRef.current = null;
    setWheelPhase('wheel');
    setSelectedOption(null);
    setLottieIdx(0);

    if (isWheel) {
      const def = defaultWheelOption();
      if (def) {
        // Defer one tick so state resets above have flushed before we re-trigger
        setTimeout(() => {
          const opt = def;
          onSpinCompleteRef.current = () => {
            onSpinCompleteRef.current = null;
            setOutcomeKey((k) => k + 1);
            setWheelPhase('outcome');
          };
          setSelectedOption(opt);
          setSpinKey((k) => k + 1);
          setWheelPhase('spinning');
        }, 0);
      }
    }
  }, [gift]); // eslint-disable-line react-hooks/exhaustive-deps

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  /**
   * Jump straight to the outcome animation for the given option.
   * Used when clicking an outcome button.
   */
  function showOutcome(opt: WheelOption) {
    onSpinCompleteRef.current = null;
    setSelectedOption(opt);
    setOutcomeKey((k) => k + 1);
    setWheelPhase('outcome');
  }

  /**
   * Play the wheel spin first, then advance to the outcome animation.
   * Used when clicking the "Wheel Spin" breadcrumb button.
   */
  function spinThenOutcome(opt: WheelOption) {
    setSelectedOption(opt);
    onSpinCompleteRef.current = () => {
      onSpinCompleteRef.current = null;
      setOutcomeKey((k) => k + 1);
      setWheelPhase('outcome');
    };
    setSpinKey((k) => k + 1);
    setWheelPhase('spinning');
  }

  /** Build the current animation URL to pass to the player. */
  function currentAnimUrl(): string | null {
    if (isWheel) {
      if (wheelPhase === 'wheel' || wheelPhase === 'spinning') {
        // Play the wheel spin lottie (first entry in lottieList)
        return lottieList[0] ?? null;
      }
      // Outcome phase — use the first lottie in the selected option's animations.
      // assets:fetch will handle fetching from CDN (via the MeetMe session) for
      // any file not already in lottie_cache, and will save it for next time.
      return selectedOption?.animations.find(a => a.lottie)?.lottie ?? null;
    }
    // Regular (non-wheel) gift
    if (hasRive) return riveAnim!.src;
    return lottieList[lottieIdx] ?? null;
  }

  const animUrl = currentAnimUrl();

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* backdrop */}
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.75)' }} />

      {/* panel */}
      <div className="relative bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl flex flex-col"
        style={{ width: 440, maxHeight: '90vh', zIndex: 1 }}>

        {/* header */}
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg overflow-hidden bg-slate-800 border border-slate-700 shrink-0 flex items-center justify-center">
              {resolveGiftImage(gift) ? (
                <img src={resolveGiftImage(gift)} alt={gift.name} className="h-full w-full object-contain" />
              ) : (
                <span className="text-lg">{(gift.emoji as string) || '🎁'}</span>
              )}
            </div>
            <div>
              <p className="text-sm font-bold text-slate-100 leading-tight">{gift.name}</p>
              <div className="flex items-center gap-1 text-[10px]">
                <Gem className="h-2.5 w-2.5 text-cyan-400" />
                <span className="text-cyan-300 font-bold">{fmtDiamonds(resolveGiftPrice(gift))}</span>
                {isWheel && <span className="ml-2 text-fuchsia-400 font-semibold">Mystery Wheel · {wheelOptions.length} outcomes</span>}
                {!isWheel && hasRive && <span className="ml-2 text-purple-400 font-semibold">Rive</span>}
              </div>
            </div>
          </div>
          <button onClick={onClose}
            className="text-slate-500 hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-800 transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* animation area */}
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
          {!canPreview ? (
            <div className="flex flex-col items-center justify-center h-48 gap-2 text-center">
              <Gift className="h-10 w-10 text-slate-600" />
              <p className="text-xs text-slate-500">No animation data available for this gift.</p>
            </div>
          ) : (
            <>
              {/* ── Wheel phase breadcrumb ── */}
              {isWheel && (
                <div className="flex items-center gap-1.5 text-[10px]">
                  <button
                    onClick={() => { const def = defaultWheelOption(); if (def) spinThenOutcome(def); }}
                    className={`font-semibold transition-colors ${wheelPhase !== 'outcome' ? 'text-fuchsia-300' : 'text-slate-500 hover:text-slate-300'}`}>
                    Wheel Spin
                  </button>
                  <ChevronRight className="h-3 w-3 text-slate-600" />
                  <span className={`font-semibold ${wheelPhase === 'outcome' ? 'text-amber-300' : 'text-slate-600'}`}>
                    {wheelPhase === 'outcome' && selectedOption ? selectedOption.name : 'Outcome'}
                  </span>
                </div>
              )}

              {/* ── Animation player ── */}
              <div className="rounded-xl bg-slate-950 border border-slate-800 overflow-hidden flex items-center justify-center"
                style={{ height: 260 }}>
                {animUrl ? (
                  /* Use RivePlayer for rive URLs (non-wheel), LottiePlayer for everything else */
                  (!isWheel && hasRive)
                    ? <RivePlayer url={animUrl} />
                    : <LottiePlayer
                        key={isWheel
                          ? (wheelPhase === 'outcome' ? `outcome-${outcomeKey}` : `spin-${spinKey}`)
                          : animUrl}
                        url={animUrl}
                        onLoopComplete={isWheel && wheelPhase === 'spinning' ? () => onSpinCompleteRef.current?.() : undefined}
                      />
                ) : (
                  <p className="text-xs text-slate-600">No animation</p>
                )}
              </div>

              {/* ── Wheel outcome picker ── */}
              {isWheel && (
                <div className="flex flex-col gap-1.5">
                  <p className="text-[10px] text-slate-500 font-semibold uppercase tracking-wide">
                    {wheelPhase === 'outcome' ? 'Outcomes — click to preview' : 'Click an outcome to preview it'}
                  </p>
                  <div className="flex flex-col gap-1">
                    {wheelOptions.map((opt) => (
                      <button
                        key={opt.name}
                        onClick={() => showOutcome(opt)}
                        className={`flex items-center justify-between px-3 py-2 rounded-lg text-xs border transition-colors text-left ${
                          selectedOption?.name === opt.name && wheelPhase === 'outcome'
                            ? 'bg-fuchsia-500/15 border-fuchsia-500/40 text-fuchsia-200'
                            : 'bg-slate-800 border-slate-700 text-slate-300 hover:border-slate-600 hover:text-slate-100'
                        }`}>
                        <span className="font-semibold">{opt.name}</span>
                        {opt.percent && (
                          <span className="text-[10px] text-slate-500 ml-2 shrink-0">{opt.percent.split(' ')[1]}</span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Non-wheel: lottie selector (multiple animations) ── */}
              {!isWheel && !hasRive && lottieList.length > 1 && (
                <div className="flex flex-wrap gap-1.5">
                  {lottieList.map((_, i) => (
                    <button key={i} onClick={() => setLottieIdx(i)}
                      className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border transition-colors ${
                        i === lottieIdx
                          ? 'bg-amber-500/20 border-amber-500/40 text-amber-300'
                          : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200'
                      }`}>
                      VERSION {i + 1}
                    </button>
                  ))}
                </div>
              )}

            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export function GiftPreviewerTab({ chatMessages, isConnected }: GiftPreviewerTabProps) {
  const [catalog, setCatalog]         = useState<MeetMeGift[]>([]);
  const [loading, setLoading]         = useState(false);
  const [loadError, setLoadError]     = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [incoming, setIncoming]       = useState<IncomingGiftNotif[]>([]);
  const [sortBy, setSortBy]           = useState<'name' | 'price-asc' | 'price-desc'>('price-desc');
  const [filterCategory, setFilterCategory] = useState<string>('');
  const [previewGift, setPreviewGift] = useState<MeetMeGift | null>(null);
  const lastProcessedIdRef = useRef<Set<string>>(new Set());

  // Load gift catalogue from MeetMe API
  const loadCatalog = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const result = await window.electronAPI?.giftsGetCatalog?.();
      if (result?.success && Array.isArray(result.gifts)) {
        // Deduplicate by name — keep the entry with the most animation data
        const seen = new Map<string, MeetMeGift>();
        for (const g of result.gifts) {
          const key = (g.name || '').toLowerCase().trim();
          if (!seen.has(key)) {
            seen.set(key, g);
          } else {
            // Prefer whichever has more lottie animations
            const existing     = seen.get(key)!;
            const existingLen  = (existing.lottieList as string[] | undefined)?.length ?? 0;
            const newLen       = (g.lottieList as string[] | undefined)?.length ?? 0;
            const existingRive = !!(existing.riveAnimation as any)?.src;
            const newRive      = !!(g.riveAnimation as any)?.src;
            if (newRive && !existingRive) seen.set(key, g);
            else if (!existingRive && newLen > existingLen) seen.set(key, g);
          }
        }
        setCatalog(Array.from(seen.values()));
      } else {
        setLoadError(result?.error || 'Failed to fetch gift catalogue. Connect to a stream first.');
        setCatalog([]);
      }
    } catch (e: any) {
      setLoadError(e?.message || 'Unexpected error loading gift catalogue.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadCatalog(); }, []);

  // Detect new gift chat messages and push them as incoming previews
  useEffect(() => {
    for (const msg of chatMessages) {
      if (msg.type !== 'gift') continue;
      if (lastProcessedIdRef.current.has(msg.id)) continue;
      lastProcessedIdRef.current.add(msg.id);

      const rawGiftName = msg.giftName || msg.text;
      const giftName    = rawGiftName || 'Gift';
      const diamonds    = msg.giftValue || 0;

      const catalogMatch = catalog.find(
        (g) => g.name?.toLowerCase() === giftName.toLowerCase()
      );

      const notif: IncomingGiftNotif = {
        id:          msg.id,
        user:        msg.user.name,
        avatar:      msg.user.avatar,
        giftName,
        diamonds,
        thumbnailUrl: catalogMatch ? resolveGiftImage(catalogMatch) : '',
        timestamp:   msg.timestamp,
        catalogGift: catalogMatch,
      };

      setIncoming((prev) => [notif, ...prev]);
    }
  }, [chatMessages, catalog]);

  // Clear the gift log when the user leaves the live (disconnects)
  const prevConnectedRef = useRef(isConnected);
  useEffect(() => {
    if (prevConnectedRef.current && !isConnected) {
      setIncoming([]);
      lastProcessedIdRef.current.clear();
    }
    prevConnectedRef.current = isConnected;
  }, [isConnected]);

  const getCategory = (g: MeetMeGift): string => {
    if (g.category) return g.category as string;
    if (Array.isArray(g.categories) && (g.categories as string[]).length > 0) return (g.categories as string[])[0];
    return '';
  };

  const categories = Array.from(new Set(catalog.map(getCategory).filter(Boolean))) as string[];

  const filtered = catalog
    .filter((g) => {
      if (filterCategory && getCategory(g) !== filterCategory) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return g.name?.toLowerCase().includes(q) || String(resolveGiftPrice(g)).includes(q);
      }
      return true;
    })
    .sort((a, b) => {
      if (sortBy === 'name')        return (a.name || '').localeCompare(b.name || '');
      if (sortBy === 'price-asc')   return resolveGiftPrice(a) - resolveGiftPrice(b);
      if (sortBy === 'price-desc')  return resolveGiftPrice(b) - resolveGiftPrice(a);
      return 0;
    });

  const openPreview = useCallback((g: MeetMeGift) => setPreviewGift(g), []);
  const closePreview = useCallback(() => setPreviewGift(null), []);

  return (
    <>
      {previewGift && <PreviewModal gift={previewGift} onClose={closePreview} />}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, minmax(0, 1fr))', gap: '24px', height: '100%', minHeight: 0 }}>

        {/* LEFT COL — catalogue */}
        <div style={{ gridColumn: 'span 7', height: '100%', minHeight: 0 }}>
          <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl flex flex-col h-full">
            {/* HEADER */}
            <div className="px-6 py-5 border-b border-slate-800 shrink-0 flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-amber-500/10 text-amber-400 rounded-xl"><Gift className="h-5 w-5" /></div>
                <div>
                  <h3 className="text-sm font-bold text-slate-100">MeetMe Gift Catalogue</h3>
                  <p className="text-xs text-slate-400">{catalog.length > 0 ? `${catalog.length} gifts loaded` : 'Live gift catalogue from MeetMe API'}</p>
                </div>
              </div>
              <button onClick={loadCatalog} disabled={loading}
                className="px-3 py-1.5 bg-slate-950 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 text-slate-400 hover:text-slate-200 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors disabled:opacity-40">
                {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                {loading ? 'Loading...' : 'Refresh'}
              </button>
            </div>

            {/* FILTERS */}
            {catalog.length > 0 && (
              <div className="px-6 py-3 border-b border-slate-800 shrink-0 flex flex-wrap items-center gap-2">
                <div className="relative flex-1 min-w-[140px]">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500 pointer-events-none" />
                  <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search gifts..."
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-amber-500/50" />
                </div>
                {categories.length > 0 && (
                  <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}
                    className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-amber-500/50">
                    <option value="">All Categories</option>
                    {categories.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
                  </select>
                )}
                <select value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                  className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-amber-500/50">
                  <option value="price-desc">Price: High → Low</option>
                  <option value="price-asc">Price: Low → High</option>
                  <option value="name">Name A–Z</option>
                </select>
                <span className="text-[10px] text-slate-500 font-mono">{filtered.length} shown</span>
              </div>
            )}

            {/* GIFT GRID */}
            <div className="flex-1 overflow-y-auto no-scrollbar p-6">
              {loadError && (
                <div className="flex items-start gap-2.5 p-3 bg-rose-500/5 border border-rose-500/20 rounded-xl text-xs mb-4">
                  <AlertCircle className="h-4 w-4 text-rose-400 shrink-0 mt-0.5" />
                  <div><span className="font-bold text-rose-300 block">Failed to load catalogue</span><span className="text-slate-400">{loadError}</span></div>
                </div>
              )}
              {loading && catalog.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full gap-3">
                  <Loader2 className="h-8 w-8 text-amber-400 animate-spin" />
                  <p className="text-xs text-slate-400">Loading gift catalogue…</p>
                </div>
              ) : catalog.length === 0 && !loadError ? (
                <div className="flex flex-col items-center justify-center h-full gap-2 text-center">
                  <Gift className="h-10 w-10 text-slate-600" />
                  <p className="text-sm font-bold text-slate-400">No gifts loaded yet</p>
                  <p className="text-xs text-slate-500 max-w-xs">{isConnected ? 'Click Refresh to fetch the live MeetMe gift catalogue.' : 'Connect to a MeetMe stream first, then click Refresh.'}</p>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-3">
                  {filtered.map((gift) => {
                    const imgUrl     = resolveGiftImage(gift);
                    const price      = resolveGiftPrice(gift);
                    const lottieList = (gift.lottieList as string[] | undefined) ?? [];
                    const hasRive    = !!(gift.riveAnimation as any)?.src;
                    const hasAnim    = hasRive || lottieList.length > 0;
                    return (
                      <div key={gift.id || gift.name}
                        className="group p-3 bg-slate-950 rounded-xl border border-slate-800/80 hover:border-amber-500/30 transition-all flex flex-col items-center gap-2 text-center cursor-default">
                        <div className="h-14 w-14 rounded-lg flex items-center justify-center bg-slate-900 border border-slate-800 overflow-hidden group-hover:border-amber-500/20 transition-all">
                          {imgUrl ? (
                            <img src={imgUrl} alt={gift.name} className="h-full w-full object-contain"
                              onError={(e) => { const el = e.target as HTMLImageElement; el.style.display = 'none'; el.parentElement!.innerHTML = `<span class="text-2xl">${(gift.emoji as string) || '🎁'}</span>`; }} />
                          ) : (
                            <span className="text-2xl">{(gift.emoji as string) || '🎁'}</span>
                          )}
                        </div>
                        <p className="text-[11px] font-bold text-slate-200 leading-tight line-clamp-2 group-hover:text-amber-300 transition-colors">{gift.name}</p>
                        <div className="flex items-center gap-1 text-[10px] font-bold">
                          <Gem className="h-3 w-3 text-cyan-400 shrink-0" />
                          <span className={price > 0 ? 'text-cyan-300' : 'text-slate-500'}>{price > 0 ? fmtDiamonds(price) : 'Free'}</span>
                        </div>
                        {/* Preview button */}
                        <button
                          onClick={() => openPreview(gift)}
                          disabled={!hasAnim}
                          className={`w-full flex items-center justify-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold border transition-colors ${
                            hasAnim
                              ? 'bg-amber-500/10 border-amber-500/30 text-amber-300 hover:bg-amber-500/20 hover:border-amber-500/50 cursor-pointer'
                              : 'bg-slate-800/50 border-slate-700 text-slate-600 cursor-not-allowed'
                          }`}
                        >
                          <Play className="h-2.5 w-2.5 shrink-0" />
                          {hasAnim ? 'PREVIEW' : 'No preview'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* RIGHT COL — live gift alerts */}
        <div style={{ gridColumn: 'span 5', height: '100%', minHeight: 0 }}>
          <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl flex flex-col h-full">
            <div className="px-6 py-5 border-b border-slate-800 shrink-0 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Gift className="h-4 w-4 text-amber-400" />
                <h3 className="text-sm font-bold text-slate-100">Live Gift Alerts</h3>
              </div>
              {incoming.length > 0 && (
                <span className="bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded-full text-[10px] font-bold border border-amber-500/20">{incoming.length}</span>
              )}
            </div>
            <div className="flex-1 overflow-y-auto no-scrollbar p-5 space-y-2">
              {incoming.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
                  <Gift className="h-10 w-10 text-slate-700" />
                  <p className="text-xs font-bold text-slate-500">No gift alerts yet</p>
                  <p className="text-[11px] text-slate-600">Gift notifications will appear here in real time when viewers send gifts during your stream.</p>
                </div>
              ) : (
                incoming.map((notif) => (
                  <div key={notif.id} className="flex items-center gap-3 p-3 bg-gradient-to-r from-amber-950/40 via-slate-950 to-slate-950 border border-amber-500/30 rounded-xl shadow-lg">
                    <div className="h-12 w-12 rounded-lg shrink-0 flex items-center justify-center bg-amber-500/10 border border-amber-500/20 overflow-hidden">
                      {notif.thumbnailUrl ? (
                        <img src={notif.thumbnailUrl} alt={notif.giftName} className="h-full w-full object-contain"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                      ) : (
                        <Gift className="h-6 w-6 text-amber-400" />
                      )}
                    </div>
                    <div className="h-8 w-8 rounded-full shrink-0 overflow-hidden border border-slate-700">
                      {notif.avatar ? (
                        <img src={notif.avatar} alt={notif.user} className="h-full w-full object-cover" />
                      ) : (
                        <div className="h-full w-full bg-slate-700 flex items-center justify-center text-slate-400 text-xs font-bold">{notif.user.charAt(0).toUpperCase()}</div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-slate-100 truncate">
                        <span className="text-amber-300">{notif.user}</span> <span className="text-slate-300">sent</span> <span className="text-amber-200">{notif.giftName}</span>
                      </p>
                      <p className="text-[10px] text-slate-400 flex items-center gap-1">
                        <Gem className="h-3 w-3 text-cyan-400" />
                        {notif.diamonds > 0 ? `${notif.diamonds.toLocaleString()} Diamonds` : 'Gift received'}
                        <span className="ml-auto text-slate-600">{notif.timestamp}</span>
                      </p>
                    </div>
                    <button onClick={() => setIncoming((prev) => prev.filter((n) => n.id !== notif.id))}
                      className="text-slate-500 hover:text-slate-300 p-1 shrink-0">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
