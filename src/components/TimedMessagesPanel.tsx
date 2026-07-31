import React, { useState, useEffect, useRef } from 'react';
import { Clock, Plus, Trash2, Play, Square, GripVertical, AlarmClock, MessageSquare, Hash } from 'lucide-react';

export interface TimedMessage {
  id: string;
  text: string;
  enabled: boolean;
}

export type CooldownMode = 'time' | 'messages';

export interface TimedMessagesConfig {
  messages: TimedMessage[];
  cooldownMode: CooldownMode;
  /** seconds between sends (when cooldownMode === 'time') */
  intervalSeconds: number;
  /** number of chat messages between sends (when cooldownMode === 'messages') */
  intervalMessages: number;
}

interface TimedMessagesPanelProps {
  config: TimedMessagesConfig;
  onConfigChange: (cfg: TimedMessagesConfig) => void;
  /** called with the message text to inject into live chat */
  onSendMessage: (text: string) => void;
  /** total chat messages received — used for message-count cooldown */
  chatMessageCount: number;
  /** controlled running state — lifted to parent for top-bar button */
  isRunning: boolean;
  onStart: () => void;
  onStop: () => void;
}

export function TimedMessagesPanel({
  config,
  onConfigChange,
  onSendMessage,
  chatMessageCount,
  isRunning,
  onStart,
  onStop,
}: TimedMessagesPanelProps) {
  const [newText, setNewText] = useState('');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [nextFireIn, setNextFireIn] = useState(0);

  // Refs so interval callbacks always see fresh values without re-creating
  const configRef = useRef(config);
  const isRunningRef = useRef(isRunning);
  const currentIndexRef = useRef(currentIndex);
  const chatMessageCountRef = useRef(chatMessageCount);
  const lastFireMsgCountRef = useRef<number>(chatMessageCount);
  useEffect(() => { configRef.current = config; }, [config]);
  useEffect(() => { isRunningRef.current = isRunning; }, [isRunning]);
  useEffect(() => { currentIndexRef.current = currentIndex; }, [currentIndex]);
  useEffect(() => { chatMessageCountRef.current = chatMessageCount; }, [chatMessageCount]);

  // ── TIME-BASED COOLDOWN ───────────────────────────────────────────────────
  const timeIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearTimers = () => {
    if (timeIntervalRef.current) { clearInterval(timeIntervalRef.current); timeIntervalRef.current = null; }
    if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
  };

  const getEnabledMessages = () => configRef.current.messages.filter((m) => m.enabled && m.text.trim());

  const fireNext = () => {
    const enabled = getEnabledMessages();
    if (!enabled.length) return;
    const idx = currentIndexRef.current % enabled.length;
    onSendMessage(enabled[idx].text.trim());
    const nextIdx = (idx + 1) % enabled.length;
    setCurrentIndex(nextIdx);
    currentIndexRef.current = nextIdx;
  };

  const startTimeBased = () => {
    const secs = configRef.current.intervalSeconds;
    setNextFireIn(secs);

    // countdown display ticker (every second)
    countdownRef.current = setInterval(() => {
      setNextFireIn((prev) => {
        if (prev <= 1) return configRef.current.intervalSeconds;
        return prev - 1;
      });
    }, 1000);

    // actual send interval
    timeIntervalRef.current = setInterval(() => {
      if (!isRunningRef.current) return;
      fireNext();
      setNextFireIn(configRef.current.intervalSeconds);
    }, secs * 1000);
  };

  // ── MESSAGE-COUNT-BASED COOLDOWN ─────────────────────────────────────────
  const msgCountCheckRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startMessageBased = () => {
    lastFireMsgCountRef.current = chatMessageCountRef.current;
    setNextFireIn(configRef.current.intervalMessages);

    msgCountCheckRef.current = setInterval(() => {
      if (!isRunningRef.current) return;
      const gap = chatMessageCountRef.current - lastFireMsgCountRef.current;
      const needed = configRef.current.intervalMessages;
      setNextFireIn(Math.max(0, needed - gap));
      if (gap >= needed) {
        fireNext();
        lastFireMsgCountRef.current = chatMessageCountRef.current;
        setNextFireIn(needed);
      }
    }, 500);
  };

  const clearMsgCountTimer = () => {
    if (msgCountCheckRef.current) { clearInterval(msgCountCheckRef.current); msgCountCheckRef.current = null; }
  };

  const handleStart = () => {
    if (!getEnabledMessages().length) return;
    onStart(); // triggers useEffect to start timers
  };

  const handleStop = () => {
    onStop(); // triggers useEffect to stop timers
  };

  // React to externally driven start/stop (e.g. top-bar button)
  const prevIsRunningRef = useRef(isRunning);
  useEffect(() => {
    const wasRunning = prevIsRunningRef.current;
    prevIsRunningRef.current = isRunning;
    if (isRunning && !wasRunning) {
      // External start — kick off timers
      setCurrentIndex(0);
      currentIndexRef.current = 0;
      if (configRef.current.cooldownMode === 'time') {
        startTimeBased();
      } else {
        startMessageBased();
      }
    } else if (!isRunning && wasRunning) {
      // External stop — clear timers
      clearTimers();
      clearMsgCountTimer();
      setNextFireIn(0);
    }
  }, [isRunning]);

  // Stop & clean up on unmount
  useEffect(() => {
    return () => {
      clearTimers();
      clearMsgCountTimer();
    };
  }, []);

  // ── CONFIG HELPERS ────────────────────────────────────────────────────────
  const update = (partial: Partial<TimedMessagesConfig>) =>
    onConfigChange({ ...config, ...partial });

  const addMessage = () => {
    const t = newText.trim();
    if (!t) return;
    update({
      messages: [
        ...config.messages,
        { id: 'tm_' + Date.now(), text: t, enabled: true },
      ],
    });
    setNewText('');
  };

  const removeMessage = (id: string) =>
    update({ messages: config.messages.filter((m) => m.id !== id) });

  const toggleMessage = (id: string) =>
    update({
      messages: config.messages.map((m) =>
        m.id === id ? { ...m, enabled: !m.enabled } : m
      ),
    });

  const updateMessageText = (id: string, text: string) =>
    update({
      messages: config.messages.map((m) => (m.id === id ? { ...m, text } : m)),
    });

  const enabledCount = config.messages.filter((m) => m.enabled && m.text.trim()).length;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, minmax(0, 1fr))', gap: '24px', height: '100%', minHeight: 0 }}>

      {/* LEFT COL — header + cooldown config */}
      <div style={{ gridColumn: 'span 5', height: '100%', minHeight: 0 }}>
        <div className="flex flex-col h-full gap-6">
          {/* HEADER */}
          <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl shadow-xl shrink-0">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-cyan-500/10 text-cyan-400 rounded-xl border border-cyan-500/20">
                <Clock className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-100">Timed Chat Messages</h3>
                <p className="text-xs text-slate-400">Automatically cycle messages into chat on a timer or every N chat messages.</p>
              </div>
            </div>
          </div>

          {/* COOLDOWN MODE */}
          <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl shadow-xl space-y-4 shrink-0">
            <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider">Cooldown Mode</h4>
            <div className="grid grid-cols-1 gap-3">
              <button type="button" onClick={() => { if (!isRunning) update({ cooldownMode: 'time' }); }}
                className={`p-3 rounded-xl border text-left transition-all ${config.cooldownMode === 'time' ? 'bg-cyan-500/10 border-cyan-500/40 text-cyan-300' : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:border-slate-700'} ${isRunning ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}>
                <div className="flex items-center gap-2 mb-1"><AlarmClock className="h-4 w-4" /><span className="text-xs font-bold">Every X Seconds</span></div>
                <p className="text-[11px] opacity-70">Send a message after a fixed time interval.</p>
              </button>
              <button type="button" onClick={() => { if (!isRunning) update({ cooldownMode: 'messages' }); }}
                className={`p-3 rounded-xl border text-left transition-all ${config.cooldownMode === 'messages' ? 'bg-purple-500/10 border-purple-500/40 text-purple-300' : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:border-slate-700'} ${isRunning ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}>
                <div className="flex items-center gap-2 mb-1"><Hash className="h-4 w-4" /><span className="text-xs font-bold">Every X Chat Messages</span></div>
                <p className="text-[11px] opacity-70">Send a message after N viewers chat.</p>
              </button>
            </div>
            <div className="flex items-center gap-3">
              <label className="text-xs text-slate-400 font-medium shrink-0">
                {config.cooldownMode === 'time' ? 'Interval (seconds)' : 'After every (messages)'}
              </label>
              <input type="number" min={config.cooldownMode === 'time' ? 10 : 1} max={config.cooldownMode === 'time' ? 3600 : 1000}
                value={config.cooldownMode === 'time' ? config.intervalSeconds : config.intervalMessages} disabled={isRunning}
                onChange={(e) => { const v = Math.max(config.cooldownMode === 'time' ? 10 : 1, Number(e.target.value)||(config.cooldownMode==='time'?30:10)); config.cooldownMode==='time' ? update({intervalSeconds:v}) : update({intervalMessages:v}); }}
                className="w-28 bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-cyan-500/60 disabled:opacity-50" />
              <span className="text-[11px] text-slate-500">{config.cooldownMode === 'time' ? 'seconds' : 'chat messages'}</span>
            </div>
          </div>

          {/* START / STOP */}
          <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl shadow-xl shrink-0">
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-0.5">
                {isRunning ? (
                  <>
                    <p className="text-xs font-bold text-emerald-400 flex items-center gap-1.5">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      Running — cycling {enabledCount} message{enabledCount !== 1 ? 's' : ''}
                    </p>
                    <p className="text-[11px] text-slate-400">
                      {config.cooldownMode === 'time' ? `Next send in ~${nextFireIn}s` : `Next send after ${nextFireIn} more chat message${nextFireIn !== 1 ? 's' : ''}`}
                    </p>
                  </>
                ) : (
                  <p className="text-xs text-slate-400">
                    {enabledCount === 0 ? 'Add at least one enabled message to start.' : `Ready — ${enabledCount} message${enabledCount !== 1 ? 's' : ''} queued.`}
                  </p>
                )}
              </div>
              {isRunning ? (
                <button type="button" onClick={handleStop}
                  className="px-5 py-2.5 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-bold flex items-center gap-2 transition-all cursor-pointer shrink-0 shadow-lg">
                  <Square className="h-4 w-4 fill-white" />Stop
                </button>
              ) : (
                <button type="button" onClick={handleStart} disabled={enabledCount === 0}
                  className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white rounded-xl text-xs font-bold flex items-center gap-2 transition-all cursor-pointer shrink-0 shadow-lg">
                  <Play className="h-4 w-4 fill-white" />Start
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* RIGHT COL — message list */}
      <div style={{ gridColumn: 'span 7', height: '100%', minHeight: 0 }}>
        <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl flex flex-col h-full">
          <div className="px-5 py-4 border-b border-slate-800 shrink-0 flex items-center justify-between">
            <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider">Messages ({enabledCount} active)</h4>
            <span className="text-[11px] text-slate-500 font-mono">Sent in order, then loops</span>
          </div>
          <div className="flex-1 overflow-y-auto no-scrollbar p-5 space-y-2">
            {config.messages.length === 0 && (
              <div className="py-8 text-center text-xs text-slate-500">No messages yet — add some below.</div>
            )}
            {config.messages.map((msg, i) => (
              <div key={msg.id} className={`flex items-center gap-2 p-2.5 rounded-xl border transition-all ${msg.enabled ? 'bg-slate-950/60 border-slate-800' : 'bg-slate-950/30 border-slate-800/50 opacity-50'}`}>
                <GripVertical className="h-3.5 w-3.5 text-slate-600 shrink-0" />
                <span className="text-[10px] font-mono text-slate-600 w-4 text-center shrink-0">{i + 1}</span>
                <input type="text" value={msg.text} onChange={(e) => updateMessageText(msg.id, e.target.value)}
                  placeholder="Enter message text…" className="flex-1 bg-transparent text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none" />
                <button type="button" onClick={() => toggleMessage(msg.id)}
                  className={`p-1 rounded transition-colors cursor-pointer ${msg.enabled ? 'text-cyan-400 hover:text-cyan-300' : 'text-slate-600 hover:text-slate-400'}`}
                  title={msg.enabled ? 'Enabled — click to disable' : 'Disabled — click to enable'}>
                  <MessageSquare className="h-3.5 w-3.5" />
                </button>
                <button type="button" onClick={() => removeMessage(msg.id)}
                  className="p-1 rounded text-slate-600 hover:text-rose-400 transition-colors cursor-pointer" title="Remove message">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
          {/* Add message row */}
          <div className="p-5 border-t border-slate-800 shrink-0 flex items-center gap-2">
            <input type="text" value={newText} onChange={(e) => setNewText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addMessage()} placeholder="New message text… (Enter to add)"
              className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-cyan-500/60 transition-all" />
            <button type="button" onClick={addMessage} disabled={!newText.trim()}
              className="px-4 py-2 bg-cyan-700 hover:bg-cyan-600 disabled:opacity-40 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shrink-0">
              <Plus className="h-3.5 w-3.5" />Add
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
