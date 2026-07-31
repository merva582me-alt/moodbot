import React, { useState, useEffect, useRef } from 'react';
import { MessageSquare, Send, Gift, Bot, ChevronDown, Trash2, ShieldAlert, ShieldCheck, UserPlus, Heart } from 'lucide-react';
import { ChatMessage } from '../types';

interface LiveChatPanelProps {
  chatMessages: ChatMessage[];
  onSendMessage: (text: string) => void;
  onClearChat?: () => void;
  onLaunchScraperSession?: () => void;
  isConnected: boolean;
}

// MeetMe Level Color Helper function
export function getLevelColor(level: number): { hex: string; bgGradient: string; textClass: string } {
  if (level >= 90) {
    return {
      hex: '#F59E0B',
      bgGradient: 'from-amber-400 via-rose-500 to-purple-600',
      textClass: 'text-amber-300',
    };
  } else if (level >= 50) {
    return {
      hex: '#EF4444',
      bgGradient: 'from-rose-500 to-red-600',
      textClass: 'text-rose-400',
    };
  } else if (level >= 30) {
    return {
      hex: '#F59E0B',
      bgGradient: 'from-amber-400 to-orange-500',
      textClass: 'text-amber-400',
    };
  } else if (level >= 20) {
    return {
      hex: '#A855F7',
      bgGradient: 'from-purple-500 to-indigo-600',
      textClass: 'text-purple-400',
    };
  } else if (level >= 10) {
    return {
      hex: '#3B82F6',
      bgGradient: 'from-blue-500 to-cyan-500',
      textClass: 'text-blue-400',
    };
  } else {
    return {
      hex: '#23CCEB',
      bgGradient: 'from-cyan-400 to-blue-500',
      textClass: 'text-cyan-400',
    };
  }
}

export function LiveChatPanel({
  chatMessages,
  onSendMessage,
  onClearChat,
  onLaunchScraperSession,
  isConnected,
}: LiveChatPanelProps) {
  const [inputText, setInputText] = useState('');
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  // True while the user is manually scrolled up — suppresses auto-scroll
  const userScrolledUpRef = useRef(false);
  // Debounce timer so programmatic instant-scrolls don't flip the button on
  const scrollDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    const el = chatContainerRef.current;
    if (!el) return;
    if (!userScrolledUpRef.current || chatMessages.length <= 5) {
      // Use instant so rapid messages never outpace the animation
      el.scrollTop = el.scrollHeight;
      setShowScrollBottom(false);
    } else {
      setShowScrollBottom(true);
    }
  }, [chatMessages]);

  const handleScroll = () => {
    const el = chatContainerRef.current;
    if (!el) return;

    // Clear any pending debounce tick
    if (scrollDebounceRef.current !== null) {
      clearTimeout(scrollDebounceRef.current);
    }

    // Wait a short moment so that a programmatic instant-scroll (scrollTop assignment)
    // has already settled before we re-evaluate position
    scrollDebounceRef.current = setTimeout(() => {
      if (!el) return;
      const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      userScrolledUpRef.current = !isAtBottom;
      setShowScrollBottom(!isAtBottom);
    }, 50);
  };

  const scrollToBottom = () => {
    const el = chatContainerRef.current;
    if (!el) return;
    userScrolledUpRef.current = false;
    el.scrollTop = el.scrollHeight;
    setShowScrollBottom(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;
    onSendMessage(inputText.trim());
    setInputText('');
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl flex flex-col h-full shadow-2xl relative overflow-hidden">
      {/* HEADER BAR */}
      <div className="bg-slate-950 border-b border-slate-800 px-4 py-3 flex items-center justify-between gap-2 shrink-0 z-10">
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-purple-500/10 text-purple-400 rounded-xl border border-purple-500/20">
            <MessageSquare className="h-4 w-4" />
          </div>
          <h3 className="text-xs font-bold text-slate-100 flex items-center gap-2">
            <span>Live Chat</span>
            <span className="text-[10px] font-mono text-slate-400">({chatMessages.length})</span>
          </h3>
        </div>

        <div className="flex items-center gap-2">
          {isConnected ? (
            <span className="flex items-center gap-1.5 text-[10px] font-bold text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-full border border-emerald-500/20 shadow-sm">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              LIVE
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-[10px] font-bold text-slate-500 bg-slate-800/60 px-2.5 py-1 rounded-full border border-slate-700/50">
              <span className="h-1.5 w-1.5 rounded-full bg-slate-500" />
              OFFLINE
            </span>
          )}

          {onClearChat && chatMessages.length > 0 && (
            <button
              onClick={onClearChat}
              className="p-1 bg-slate-800/80 hover:bg-rose-500/20 hover:text-rose-400 text-slate-400 rounded-lg transition-all cursor-pointer"
              title="Clear Chat"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* CHAT MESSAGES CONTAINER */}
      <div
        ref={chatContainerRef}
        onScroll={handleScroll}
        id="ChatHistoryContainer"
        className="flex-1 overflow-y-auto p-3.5 space-y-2.5 no-scrollbar relative bg-slate-950/40"
      >
        {chatMessages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center p-6 space-y-2 my-auto">
            <div className="p-3 bg-purple-500/10 text-purple-400 rounded-2xl border border-purple-500/20 animate-pulse">
              <MessageSquare className="h-6 w-6" />
            </div>
            <p className="text-xs font-bold text-slate-200">Waiting for chat messages...</p>
            <p className="text-[11px] text-slate-400 max-w-xs">
              Live comments from the stream will display here automatically.
            </p>
          </div>
        ) : (
          chatMessages.map((msg) => {
            // Use the real MeetMe CSS-variable color when available (scraped from DOM),
            // otherwise fall back to our computed gradient based on numeric level.
            const levelInfo = getLevelColor(msg.user?.level || 1);
            const userLevel = msg.user?.level || 1;
            // If MeetMe gave us a raw hex/hsl color string, use it directly for the ring
            const realLevelHex = msg.user?.levelColor && !msg.user.levelColor.startsWith('from-')
              ? msg.user.levelColor
              : levelInfo.hex;
            const realBgGradient = msg.user?.levelColor && !msg.user.levelColor.startsWith('from-')
              ? undefined  // will use inline border-color instead
              : levelInfo.bgGradient;

            // Show ring + level badge only when the user actually has a coloured level.
            // White (#fff / rgb(255,255,255)) means MeetMe assigned no level colour,
            // and system messages never get a ring regardless.
            const isWhite = /^(#fff(fff)?|rgb\(\s*255\s*,\s*255\s*,\s*255\s*\))$/i.test(
              (realLevelHex || '').trim()
            );
            const showLevelRing = msg.type !== 'system' && !isWhite && !!realLevelHex;

            // ── System notices (modbot / welcome / rules) ─────────────────────
            // Rendered as full-width banners with no avatar column, matching MeetMe's
            // own chat UI for these built-in messages.
            if (msg.type === 'system') {
              const isModbot    = /modbot/i.test(msg.text);
              const isWarning   = /nudity|obscene|deletion|keep.*live.*fun/i.test(msg.text);
              const isBattle    = /⚔️|🏁|pk battle/i.test(msg.text);
              const isDetach    = /⚠️.*lost dom|lost dom/i.test(msg.text);
              const isReattach  = /🔄.*reattach|reattach/i.test(msg.text);
              return (
                <div
                  key={msg.id}
                  className={`flex items-start gap-2 px-2 py-2 rounded-xl text-xs font-medium leading-snug ${
                    isModbot
                      ? 'bg-purple-500/10 border border-purple-500/20 text-purple-200'
                      : isWarning
                      ? 'bg-amber-500/10 border border-amber-500/20 text-amber-200'
                      : isBattle
                      ? 'bg-rose-500/10 border border-rose-500/20 text-rose-200'
                      : isDetach
                      ? 'bg-yellow-500/10 border border-yellow-500/20 text-yellow-200'
                      : isReattach
                      ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-200'
                      : 'bg-slate-800/60 border border-slate-700/40 text-slate-300'
                  }`}
                >
                  {isModbot ? (
                    <ShieldCheck className="h-3.5 w-3.5 shrink-0 mt-0.5 text-purple-400" />
                  ) : isWarning ? (
                    <ShieldAlert className="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-400" />
                  ) : (
                    <Bot className={`h-3.5 w-3.5 shrink-0 mt-0.5 ${
                      isBattle   ? 'text-rose-400'
                      : isDetach   ? 'text-yellow-400'
                      : isReattach ? 'text-emerald-400'
                      : 'text-slate-400'
                    }`} />
                  )}
                  <span>{msg.text}</span>
                </div>
              );
            }

            return (
              <div
                key={msg.id}
                id={`ChatMessage_${msg.id}`}
                className={`chat-cell tmg-live-video-chat-message-item group/cell transition-all hover:bg-slate-900/60 p-1.5 rounded-xl border border-transparent hover:border-slate-800/80 flex gap-2.5 ${msg.type === 'join' ? 'join-row items-center' : 'items-start'}`}
              >
                {/* MEETME AVATAR & LEVEL BADGE */}
                <div
                  className={`tmg-live-video-react-chat-message-container tmg-live-video-chat-image-container relative shrink-0${msg.type === 'join' ? ' self-center' : ''}`}
                  style={{ '--levels-group-current-color': realLevelHex } as React.CSSProperties}
                >
                  <div className="relative w-9 h-9">
                    {/* Ring glow — shown only when the user has a real level colour */}
                    {showLevelRing && (
                      realBgGradient ? (
                        <div
                          className={`absolute -inset-0.5 rounded-full bg-gradient-to-r ${realBgGradient} opacity-75 blur-[1px]`}
                        />
                      ) : (
                        <div
                          className="absolute -inset-0.5 rounded-full opacity-75 blur-[1px]"
                          style={{ backgroundColor: realLevelHex }}
                        />
                      )
                    )}

                    {/* Avatar image frame */}
                    <div
                      className="chat-avatar-img-holder w-9 h-9 rounded-full overflow-hidden border-2 relative z-10 bg-slate-950 flex items-center justify-center shadow-md"
                      style={showLevelRing
                        ? { borderColor: realLevelHex, outlineColor: realLevelHex }
                        : { borderColor: 'transparent' }}
                    >
                      <img
                        className="tmg-live-video-react-chat-message-image tmg-live-video-chat-message-image w-full h-full object-cover"
                        alt={msg.user?.name || 'MeetMe User'}
                        src={msg.user?.avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100'}
                        onError={(e) => {
                          (e.target as HTMLImageElement).src =
                            'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100';
                        }}
                      />
                    </div>

                    {/* Level number badge — shown only when user has a real level colour */}
                    {showLevelRing && (
                      <div
                        className={`level-number absolute -bottom-1 left-1/2 -translate-x-1/2 z-20 py-0.5 rounded-full font-black font-mono text-white shadow border border-slate-950 leading-none text-center${userLevel >= 100 ? ' px-0.5 text-[6.5px] min-w-[18px]' : ' px-1 text-[8px] min-w-[14px]'}`}
                        style={{ backgroundColor: realLevelHex }}
                      >
                        {userLevel}
                      </div>
                    )}
                  </div>
                </div>

                {/* USERNAME & MESSAGE TEXT */}
                <div className={`tmg-live-video-react-chat-message-container tmg-live-video-chat-message-container flex-1 min-w-0${msg.type === 'join' ? ' flex items-center' : ''}`}>

                  {/* ── Header row: name + badges + timestamp — hidden for joins ── */}
                  {msg.type !== 'join' && <div className="flex items-center gap-1.5 flex-wrap leading-tight">
                    <span className="font-bold text-xs truncate max-w-[160px]" style={{
                      color: msg.type === 'join'   ? 'rgb(134,239,172)'  // green-300
                           : msg.type === 'gift'   ? 'rgb(252,211,77)'   // amber-300
                           : msg.type === 'follow' ? 'rgb(249,168,212)'  // pink-300
                           : 'rgb(241,245,249)',                          // slate-100
                    }}>
                      <span className="title-cell-name-holder">{msg.user?.name || 'MeetMe Viewer'}</span>
                    </span>

                    {(msg.user?.badges ?? (msg.user?.badge ? [msg.user.badge] : []))
                      .map((b) => (
                      <span
                        key={b}
                        className={`px-1.5 py-0.5 rounded text-[9px] font-extrabold uppercase border tracking-wider shadow-sm ${
                          b === 'BOT'           ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
                          : b === 'MOD'         ? 'bg-purple-500/20 text-purple-300 border-purple-500/40'
                          : b === 'GREEN VIP'   ? 'bg-green-500/20 text-green-300 border-green-500/40'
                          : b === 'PURPLE VIP'  ? 'bg-purple-500/20 text-purple-300 border-purple-500/40'
                          : b === 'BLACK VIP'   ? 'bg-slate-600/40 text-slate-200 border-slate-500/60'
                          : b === 'BOSS VIP'    ? 'bg-teal-500/20 text-teal-300 border-teal-500/40'
                          : b === 'VIP'         ? 'bg-green-500/20 text-green-300 border-green-500/40'
                          : b === 'BOUNCER'     ? 'bg-blue-500/20 text-blue-300 border-blue-500/40'
                          : b === 'GIFTER'      ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                          : b === 'TOP BADGE'   ? 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40'
                          : 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40'
                        }`}
                      >
                        {b}
                      </span>
                    ))}

                    <span className="text-[10px] text-slate-500 ml-auto font-mono shrink-0">
                      {msg.timestamp || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>}

                  {/* ── Message body — distinct per type ── */}
                  {msg.type === 'join' ? (
                    <div className="flex items-center gap-1.5 w-full min-w-0">
                      <UserPlus className="h-3 w-3 text-green-400 shrink-0" />
                      <span className="text-xs text-green-300/80 font-medium flex-1 min-w-0 whitespace-nowrap overflow-hidden">
                        <span className="font-bold text-green-300">{msg.user?.name || 'Someone'}</span>
                        {' joined the stream'}
                      </span>
                      {(msg.user?.badges ?? (msg.user?.badge ? [msg.user.badge] : []))
                        .map((b) => (
                        <span
                          key={b}
                          className={`shrink-0 px-1.5 py-0.5 rounded text-[9px] font-extrabold uppercase border tracking-wider shadow-sm ${
                            b === 'BOT'           ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
                            : b === 'MOD'         ? 'bg-purple-500/20 text-purple-300 border-purple-500/40'
                            : b === 'GREEN VIP'   ? 'bg-green-500/20 text-green-300 border-green-500/40'
                            : b === 'PURPLE VIP'  ? 'bg-purple-500/20 text-purple-300 border-purple-500/40'
                            : b === 'BLACK VIP'   ? 'bg-slate-600/40 text-slate-200 border-slate-500/60'
                            : b === 'BOSS VIP'    ? 'bg-teal-500/20 text-teal-300 border-teal-500/40'
                            : b === 'VIP'         ? 'bg-green-500/20 text-green-300 border-green-500/40'
                            : b === 'BOUNCER'     ? 'bg-blue-500/20 text-blue-300 border-blue-500/40'
                            : b === 'GIFTER'      ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                            : b === 'TOP BADGE'   ? 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40'
                            : 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40'
                          }`}
                        >
                          {b}
                        </span>
                      ))}
                    </div>

                  ) : msg.type === 'follow' ? (
                    <div className="mt-0.5 flex items-center gap-1.5">
                      <Heart className="h-3 w-3 text-pink-400 shrink-0" />
                      <span className="text-xs text-pink-300/80 font-medium">
                        <span className="font-bold text-pink-300">{msg.user?.name || 'Someone'}</span>
                        {' favorited the host'}
                      </span>
                    </div>

                  ) : msg.type === 'gift' ? (
                    <div className="mt-0.5 flex items-center gap-1.5 bg-amber-500/10 border border-amber-500/25 rounded-lg px-2 py-1">
                      <Gift className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                      <span className="text-xs text-amber-200/90 font-medium flex-1 min-w-0 truncate">
                        <span className="font-bold text-amber-300">{msg.user?.name || 'Someone'}</span>
                        {' sent '}
                        <span className="font-semibold">{msg.giftName || msg.text}</span>
                      </span>
                      {msg.giftValue && (
                        <span className="text-[10px] font-bold text-amber-300 font-mono shrink-0">
                          +{msg.giftValue}💎
                        </span>
                      )}
                    </div>

                  ) : (
                    <span className="tmg-live-video-react-chat-message tmg-live-video-chat-message mt-0.5 text-xs text-slate-200 font-normal leading-relaxed block break-words">
                      {msg.text}
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* SCROLL TO BOTTOM BUTTON */}
      {showScrollBottom && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-16 right-4 z-20 px-3 py-1.5 bg-purple-600 hover:bg-purple-500 text-white rounded-full text-xs font-bold shadow-2xl flex items-center gap-1.5 transition-all cursor-pointer border border-purple-400/30"
        >
          <ChevronDown className="h-3.5 w-3.5" />
          <span>New Messages</span>
        </button>
      )}

      {/* CHAT INPUT FORM */}
      <div className="p-3 bg-slate-950 border-t border-slate-800 shrink-0 z-10">
        <form onSubmit={handleSubmit} className="flex items-center gap-2">
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="Send message to stream chat..."
            className="flex-1 bg-slate-900 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-purple-500/60 transition-all"
          />
          <button
            type="submit"
            disabled={!inputText.trim()}
            className="px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white rounded-xl text-xs font-bold shadow-lg transition-all flex items-center gap-1.5 cursor-pointer shrink-0"
          >
            <Send className="h-3.5 w-3.5" />
            <span>Send</span>
          </button>
        </form>
      </div>
    </div>
  );
}
