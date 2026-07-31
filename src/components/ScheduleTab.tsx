import React, { useState } from 'react';
import { Calendar, Plus, Trash2, Clock, RotateCcw, Bell, BellOff } from 'lucide-react';
import { ScheduleConfig, ScheduleEntry } from '../types';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

interface ScheduleTabProps {
  scheduleConfig: ScheduleConfig;
  onConfigChange: (cfg: ScheduleConfig) => void;
}

export function ScheduleTab({ scheduleConfig, onConfigChange }: ScheduleTabProps) {
  const [newDay, setNewDay] = useState<number>(1);
  const [newStart, setNewStart] = useState('18:00');
  const [newEnd, setNewEnd] = useState('');
  const [newTitle, setNewTitle] = useState('');

  const addEntry = () => {
    if (!newTitle.trim() || !newStart) return;
    const entry: ScheduleEntry = {
      id: Date.now().toString(),
      dayOfWeek: newDay,
      startTime: newStart,
      endTime: newEnd || undefined,
      title: newTitle.trim(),
      enabled: true,
    };
    onConfigChange({ ...scheduleConfig, entries: [...scheduleConfig.entries, entry] });
    setNewTitle('');
    setNewEnd('');
  };

  const removeEntry = (id: string) => {
    onConfigChange({ ...scheduleConfig, entries: scheduleConfig.entries.filter((e) => e.id !== id) });
  };

  const toggleEntry = (id: string) => {
    onConfigChange({
      ...scheduleConfig,
      entries: scheduleConfig.entries.map((e) => e.id === id ? { ...e, enabled: !e.enabled } : e),
    });
  };

  // Sort entries by day then time for display
  const sorted = [...scheduleConfig.entries].sort((a, b) =>
    a.dayOfWeek !== b.dayOfWeek ? a.dayOfWeek - b.dayOfWeek : a.startTime.localeCompare(b.startTime)
  );

  // Compute next upcoming entry relative to now
  const getNextEntry = (): ScheduleEntry | null => {
    if (scheduleConfig.entries.length === 0) return null;
    const now = new Date();
    const nowDay = now.getDay();
    const nowMins = now.getHours() * 60 + now.getMinutes();

    const enabled = scheduleConfig.entries.filter((e) => e.enabled);
    if (enabled.length === 0) return null;

    // Try to find the next upcoming entry within the next 7 days
    for (let offset = 0; offset < 7; offset++) {
      const checkDay = (nowDay + offset) % 7;
      const dayEntries = enabled
        .filter((e) => e.dayOfWeek === checkDay)
        .sort((a, b) => a.startTime.localeCompare(b.startTime));

      for (const entry of dayEntries) {
        const [h, m] = entry.startTime.split(':').map(Number);
        const entryMins = h * 60 + m;
        if (offset > 0 || entryMins > nowMins) return entry;
      }
    }
    return enabled[0]; // fallback: first enabled entry
  };

  const nextEntry = getNextEntry();

  const formatTime12 = (time24: string) => {
    const [h, m] = time24.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, minmax(0, 1fr))', gap: '24px', alignItems: 'start' }}>

      {/* LEFT COL — add entry + announce settings */}
      <div style={{ gridColumn: 'span 5' }}>
        <div className="flex flex-col gap-6">
          {/* PAGE HEADER */}
          <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl shadow-xl shrink-0">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2.5 bg-purple-500/10 text-purple-400 rounded-xl"><Calendar className="h-5 w-5" /></div>
              <div>
                <h3 className="text-sm font-bold text-slate-100">Stream Schedule</h3>
                <p className="text-xs text-slate-400">Set weekly stream times · viewers can query with <code className="text-purple-300">!schedule</code></p>
              </div>
            </div>
            {nextEntry && (
              <div className="flex items-center gap-3 px-4 py-3 bg-purple-500/10 border border-purple-500/20 rounded-xl">
                <Clock className="h-4 w-4 text-purple-400 shrink-0" />
                <div className="text-xs text-slate-200">
                  <span className="font-bold text-purple-300">Next stream:</span>{' '}
                  <span className="font-semibold">{nextEntry.title}</span>
                  {' — '}{DAY_NAMES[nextEntry.dayOfWeek]} at {formatTime12(nextEntry.startTime)}
                  {nextEntry.endTime ? ` – ${formatTime12(nextEntry.endTime)}` : ''}
                </div>
              </div>
            )}
          </div>

          {/* ADD ENTRY FORM */}
          <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl shadow-xl space-y-3 shrink-0">
            <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
              <Plus className="h-3.5 w-3.5" /> Add Entry
            </h4>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] text-slate-400 mb-1 font-bold">Day</label>
                <select value={newDay} onChange={(e) => setNewDay(Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-purple-500">
                  {DAY_NAMES.map((d, i) => <option key={i} value={i}>{d}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[10px] text-slate-400 mb-1 font-bold">Start Time</label>
                <input type="time" value={newStart} onChange={(e) => setNewStart(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-purple-500" />
              </div>
              <div>
                <label className="block text-[10px] text-slate-400 mb-1 font-bold">End Time <span className="text-slate-600">(opt)</span></label>
                <input type="time" value={newEnd} onChange={(e) => setNewEnd(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-purple-500" />
              </div>
              <div>
                <label className="block text-[10px] text-slate-400 mb-1 font-bold">Stream Title</label>
                <input type="text" value={newTitle} placeholder="e.g. Chill Gaming" onChange={(e) => setNewTitle(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addEntry()}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-purple-500" />
              </div>
            </div>
            <button onClick={addEntry} disabled={!newTitle.trim() || !newStart}
              className="w-full px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all">
              <Plus className="h-3.5 w-3.5" /> Add to Schedule
            </button>
          </div>

          {/* AUTO-ANNOUNCE SETTINGS */}
          <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl shadow-xl space-y-3 shrink-0">
            <div className="flex items-center justify-between">
              <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                {scheduleConfig.announceEnabled ? <Bell className="h-3.5 w-3.5 text-amber-400" /> : <BellOff className="h-3.5 w-3.5 text-slate-500" />}
                Auto-Announce
              </h4>
              <button onClick={() => onConfigChange({ ...scheduleConfig, announceEnabled: !scheduleConfig.announceEnabled })}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all border ${scheduleConfig.announceEnabled ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20' : 'bg-slate-900 text-slate-500 border-slate-700 hover:bg-slate-800'}`}>
                {scheduleConfig.announceEnabled ? 'Enabled' : 'Disabled'}
              </button>
            </div>
            <div className="space-y-2">
              <div>
                <label className="block text-[10px] text-slate-400 mb-1 font-bold">Announce X minutes before</label>
                <input type="number" min={1} max={60} value={scheduleConfig.announceMinutesBefore}
                  onChange={(e) => onConfigChange({ ...scheduleConfig, announceMinutesBefore: Math.max(1, Number(e.target.value)) })}
                  disabled={!scheduleConfig.announceEnabled}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-purple-500 disabled:opacity-40" />
              </div>
              <div>
                <label className="block text-[10px] text-slate-400 mb-1 font-bold">Announcement Message</label>
                <input type="text" value={scheduleConfig.announceMessage} placeholder="Stream starting soon: {title} at {time}!"
                  onChange={(e) => onConfigChange({ ...scheduleConfig, announceMessage: e.target.value })}
                  disabled={!scheduleConfig.announceEnabled}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-purple-500 disabled:opacity-40" />
                <p className="text-[10px] text-slate-500 mt-1">Placeholders: <code className="text-purple-400">{'{title}'}</code> <code className="text-purple-400">{'{time}'}</code> <code className="text-purple-400">{'{day}'}</code></p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* RIGHT COL — schedule entries list */}
      <div style={{ gridColumn: 'span 7' }}>
        <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl flex flex-col">
          <div className="px-6 py-5 border-b border-slate-800 shrink-0">
            <h4 className="text-xs font-bold text-slate-200 flex items-center gap-2">
              <Calendar className="h-4 w-4 text-purple-400" />
              Weekly Entries
              <span className="ml-1 text-[10px] font-mono bg-slate-800 text-slate-400 px-2 py-0.5 rounded-full">{sorted.length}</span>
            </h4>
          </div>
          <div className="flex-1 overflow-y-auto no-scrollbar p-6 space-y-2">
            {sorted.length === 0 ? (
              <div className="py-10 text-center text-xs text-slate-500">No entries yet — add one on the left.</div>
            ) : (
              sorted.map((entry) => (
                <div key={entry.id} className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-all ${entry.enabled ? 'bg-slate-950 border-slate-800' : 'bg-slate-950/50 border-slate-800/60 opacity-50'}`}>
                  <div className="flex-1 min-w-0 flex items-center gap-2">
                    <span className="text-[10px] font-bold text-purple-300 uppercase tracking-wider shrink-0">{DAY_NAMES[entry.dayOfWeek].slice(0, 3)}</span>
                    <p className="text-xs font-semibold text-slate-200 truncate">{entry.title}</p>
                    <span className="text-[10px] text-slate-400 font-mono shrink-0 ml-auto">{formatTime12(entry.startTime)}{entry.endTime ? ` – ${formatTime12(entry.endTime)}` : ''}</span>
                  </div>
                  <button onClick={() => toggleEntry(entry.id)}
                    className={`shrink-0 px-2 py-1 rounded-lg text-[10px] font-bold transition-colors ${entry.enabled ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20' : 'bg-slate-800 text-slate-500 border border-slate-700 hover:bg-slate-700'}`}>
                    {entry.enabled ? 'ON' : 'OFF'}
                  </button>
                  <button onClick={() => removeEntry(entry.id)} className="shrink-0 p-1.5 text-slate-500 hover:text-rose-400 rounded-lg transition-colors">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
