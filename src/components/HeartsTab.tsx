import React, { useState, useEffect, useRef } from 'react';
import { Heart, Zap, Square, Radio, AlertCircle, CheckCircle2, Activity } from 'lucide-react';
import { HeartsStatus } from '../types';

interface HeartsTabProps {
  isStreamConnected: boolean;
}

export function HeartsTab({ isStreamConnected }: HeartsTabProps) {
  const [status, setStatus]     = useState<HeartsStatus>({ running: false, totalSent: 0, totalFail: 0, sessionUrl: null });
  const [isStarting, setIsStarting] = useState(false);
  // Likes/sec estimate — rolling window over last 10 updates
  const sentTimesRef = useRef<{ t: number; sent: number }[]>([]);
  const [likesPerSec, setLikesPerSec] = useState<number>(0);

  useEffect(() => {
    if (!window.electronAPI?.onHeartsUpdate) return;
    const unsub = window.electronAPI.onHeartsUpdate((data) => {
      setStatus(data);
      if (data.running) {
        const now = Date.now();
        sentTimesRef.current.push({ t: now, sent: data.totalSent });
        if (sentTimesRef.current.length > 10) sentTimesRef.current.shift();
        const arr = sentTimesRef.current;
        if (arr.length >= 2) {
          const span = (arr[arr.length - 1].t - arr[0].t) / 1000;
          const diff = arr[arr.length - 1].sent - arr[0].sent;
          setLikesPerSec(span > 0 ? Math.round((diff * 25) / span) : 0);
        }
      } else {
        sentTimesRef.current = [];
        setLikesPerSec(0);
      }
    });
    return unsub;
  }, []);

  useEffect(() => {
    window.electronAPI?.heartsStatus?.().then((s) => { if (s) setStatus(s); }).catch(() => {});
  }, []);

  const handleStart = async () => {
    setIsStarting(true);
    try {
      await window.electronAPI?.heartsStart?.();
    } catch (e) {
      console.warn('[HeartsTab] Failed to start:', e);
    } finally {
      setIsStarting(false);
    }
  };

  const handleStop = async () => {
    try { await window.electronAPI?.heartsStop?.(); }
    catch (e) { console.warn('[HeartsTab] Failed to stop:', e); }
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, minmax(0, 1fr))', gap: '24px' }}>

      {/* LEFT COL — controls */}
      <div style={{ gridColumn: 'span 6' }}>
        <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl flex flex-col">
          <div className="px-6 py-5 border-b border-slate-800 shrink-0 flex items-center gap-3">
            <div className={`p-2.5 rounded-xl transition-colors ${status.running ? 'bg-rose-500/20 text-rose-400' : 'bg-slate-800 text-slate-400'}`}>
              <Heart className={`h-5 w-5 ${status.running ? 'fill-rose-500/30 animate-pulse' : ''}`} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-slate-100">Super Speed Hearts</h3>
                <span className={`px-2 py-0.5 text-[10px] font-bold rounded-full border ${status.running ? 'bg-rose-500/10 text-rose-400 border-rose-500/30 animate-pulse' : 'bg-slate-800 text-slate-400 border-slate-700'}`}>
                  {status.running ? '❤️ ACTIVE' : 'IDLE'}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">Continuous like flood — 20 parallel requests, no interval.</p>
            </div>
          </div>
          <div className="p-6 space-y-5">
            {/* SESSION URL STATUS */}
            {(() => {
              const captured = status.sessionUrl;
              return (
                <div className={`p-3 rounded-xl border flex items-start gap-2.5 text-xs ${
                  !captured ? 'bg-amber-500/5 border-amber-500/20' : 'bg-emerald-500/5 border-emerald-500/20'
                }`}>
                  {!captured ? (
                    <>
                      <AlertCircle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                      <div>
                        <span className="font-bold text-amber-300 block">Step 1 — Open a stream</span>
                        <span className="text-slate-400">Go to the <span className="text-slate-200 font-bold">Livestream</span> tab and open any live stream.</span>
                      </div>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <span className="font-bold text-emerald-300 block">Step 2 — Hold the heart button once</span>
                        <span className="text-slate-400 font-mono break-all">{captured}</span>
                        <span className="text-slate-400 block mt-1">In the Livestream tab, <span className="text-slate-200 font-bold">hold the ❤ button</span> for a moment so MeetMe sends one like — this captures the request. Then come back and start hearts.</span>
                      </div>
                    </>
                  )}
                </div>
              );
            })()}
            {/* START / STOP */}
            <div className="flex gap-3">
              {!status.running ? (
                <button onClick={handleStart} disabled={isStarting}
                  className="flex-1 py-3 bg-gradient-to-r from-rose-600 to-pink-600 hover:from-rose-500 hover:to-pink-500 disabled:opacity-50 text-white font-bold rounded-xl text-sm transition-all shadow-lg shadow-rose-600/20 flex items-center justify-center gap-2">
                  <Heart className="h-4 w-4 fill-white/30" />{isStarting ? 'Starting...' : 'Start Hearts'}<Zap className="h-4 w-4" />
                </button>
              ) : (
                <button onClick={handleStop}
                  className="flex-1 py-3 bg-slate-800 hover:bg-slate-700 text-rose-300 font-bold rounded-xl text-sm transition-all border border-rose-500/30 flex items-center justify-center gap-2">
                  <Square className="h-4 w-4 fill-rose-400/30" />Stop Hearts
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* RIGHT COL — stats + info */}
      <div style={{ gridColumn: 'span 6' }}>
        <div className="flex flex-col gap-6">
          {/* STATS CARD */}
          <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl shadow-xl shrink-0">
            <h4 className="text-xs font-bold text-slate-300 flex items-center gap-2 mb-4">
              <Activity className="h-3.5 w-3.5 text-rose-400" />Live Statistics
            </h4>
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 text-center">
                <span className="block text-lg font-extrabold text-rose-400">{status.totalSent.toLocaleString()}</span>
                <span className="text-[10px] text-slate-500 uppercase tracking-wider">Batches Sent</span>
              </div>
              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 text-center">
                <span className="block text-lg font-extrabold text-amber-400">{status.totalFail.toLocaleString()}</span>
                <span className="text-[10px] text-slate-500 uppercase tracking-wider">Failed</span>
              </div>
              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 text-center col-span-2">
                <span className="block text-2xl font-extrabold text-emerald-400">
                  {likesPerSec > 0 ? likesPerSec.toLocaleString() : '—'}
                </span>
                <span className="text-[10px] text-slate-500 uppercase tracking-wider">Likes / sec</span>
              </div>
            </div>
          </div>
          {/* HOW IT WORKS */}
          <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl shadow-xl">
            <h4 className="text-xs font-bold text-slate-300 flex items-center gap-2 mb-4">
              <Radio className="h-3.5 w-3.5 text-slate-500" />How Super Speed Hearts Works
            </h4>
            <ol className="text-[11px] text-slate-400 space-y-2 list-decimal list-inside">
              <li>Go to the <span className="text-slate-200 font-bold">Livestream</span> tab and open the stream you want to boost.</li>
              <li><span className="text-slate-200 font-bold">Hold the ❤ button</span> in the stream — MoodBot intercepts the request MeetMe sends.</li>
              <li>Come back here and press <span className="text-slate-200 font-bold">Start Hearts</span> — MoodBot fires 20 parallel replays of that request in a continuous loop with no interval.</li>
              <li>Each batch sends 25 likes × 20 parallel = <span className="text-slate-200 font-bold">500 likes per loop</span> at maximum network speed.</li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
}
