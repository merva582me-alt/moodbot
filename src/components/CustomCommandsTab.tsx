import React, { useState } from 'react';
import {
  Plus,
  Trash2,
  Pencil,
  Check,
  X,
  Terminal,
  RotateCcw,
  Mic,
  ChevronDown,
} from 'lucide-react';
import {
  CustomCommand,
  CommandPermissionLevel,
  BADGE_HIERARCHY,
  ALL_BADGES,
} from '../types';

// ─── helpers ─────────────────────────────────────────────────────────────────

const BADGE_STYLES: Record<
  CommandPermissionLevel,
  { pill: string; dot: string }
> = {
  everyone:    { pill: 'bg-slate-700 border-slate-600 text-slate-200',         dot: 'bg-slate-400' },
  Bouncer:     { pill: 'bg-blue-500/20 border-blue-500/40 text-blue-200',      dot: 'bg-blue-400' },
  'Boss VIP':  { pill: 'bg-amber-500/20 border-amber-500/40 text-amber-200',   dot: 'bg-amber-400' },
  'Black VIP': { pill: 'bg-slate-600/50 border-slate-500/50 text-slate-200',   dot: 'bg-slate-300' },
  'Purple VIP':{ pill: 'bg-purple-500/20 border-purple-500/40 text-purple-200',dot: 'bg-purple-400' },
  'Green VIP': { pill: 'bg-emerald-500/20 border-emerald-500/40 text-emerald-200', dot: 'bg-emerald-400' },
  'Top Badge': { pill: 'bg-rose-500/20 border-rose-500/40 text-rose-200',      dot: 'bg-rose-400' },
};

function normaliseTrigger(raw: string): string {
  const t = raw.trim().toLowerCase();
  return t.startsWith('!') ? t : `!${t}`;
}

// ─── Badge picker sub-component ───────────────────────────────────────────────

function BadgePicker({
  value,
  onChange,
}: {
  value: CommandPermissionLevel[];
  onChange: (next: CommandPermissionLevel[]) => void;
}) {
  const toggle = (lvl: CommandPermissionLevel) => {
    onChange(value.includes(lvl) ? value.filter((b) => b !== lvl) : [...value, lvl]);
  };
  return (
    <div className="flex flex-wrap gap-1.5">
      {BADGE_HIERARCHY.map((lvl) => {
        const active = value.includes(lvl);
        const s = BADGE_STYLES[lvl];
        return (
          <button
            key={lvl}
            type="button"
            onClick={() => toggle(lvl)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-semibold transition-all ${
              active
                ? s.pill
                : 'bg-transparent border-slate-700 text-slate-600 hover:border-slate-500 hover:text-slate-400'
            }`}
          >
            {active && <span className={`w-1.5 h-1.5 rounded-full ${s.dot} shrink-0`} />}
            {lvl}
          </button>
        );
      })}
    </div>
  );
}

// ─── Inline editor row ────────────────────────────────────────────────────────

interface EditRowProps {
  initial: CustomCommand;
  onSave: (updated: CustomCommand) => void;
  onCancel: () => void;
}

function EditRow({ initial, onSave, onCancel }: EditRowProps) {
  const [trigger, setTrigger]       = useState(initial.trigger);
  const [response, setResponse]     = useState(initial.response);
  const [desc, setDesc]             = useState(initial.description ?? '');
  const [badges, setBadges]         = useState<CommandPermissionLevel[]>(initial.allowedBadges);
  const [tts, setTts]               = useState(initial.tts);

  const valid = trigger.trim().length > 0 && response.trim().length > 0;

  const save = () => {
    if (!valid) return;
    onSave({
      ...initial,
      trigger: normaliseTrigger(trigger),
      response: response.trim(),
      description: desc.trim() || undefined,
      allowedBadges: badges,
      tts,
    });
  };

  return (
    <div className="bg-slate-950 border border-purple-500/40 rounded-xl p-4 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        {/* Trigger */}
        <div>
          <label className="block text-[10px] font-semibold text-slate-400 uppercase mb-1">Trigger</label>
          <input
            value={trigger}
            onChange={(e) => setTrigger(e.target.value)}
            placeholder="!hello"
            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-purple-500/60 placeholder-slate-600"
          />
        </div>
        {/* Description */}
        <div>
          <label className="block text-[10px] font-semibold text-slate-400 uppercase mb-1">Description (optional)</label>
          <input
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            placeholder="Greet the chat"
            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-purple-500/60 placeholder-slate-600"
          />
        </div>
      </div>

      {/* Response */}
      <div>
        <label className="block text-[10px] font-semibold text-slate-400 uppercase mb-1">
          Response <span className="normal-case text-slate-500 font-normal">— use <code className="text-amber-300">&#123;user&#125;</code> for the sender's name</span>
        </label>
        <textarea
          rows={2}
          value={response}
          onChange={(e) => setResponse(e.target.value)}
          placeholder="Hey {user}, welcome to the stream!"
          className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-purple-500/60 placeholder-slate-600 resize-none"
        />
      </div>

      {/* Allowed badges */}
      <div>
        <label className="block text-[10px] font-semibold text-slate-400 uppercase mb-1.5">Who can use this command</label>
        <BadgePicker value={badges} onChange={setBadges} />
        {badges.length === 0 && (
          <p className="text-[10px] text-rose-400 mt-1">No badges selected — command will be disabled.</p>
        )}
      </div>

      {/* TTS + action buttons */}
      <div className="flex items-center justify-between gap-3 pt-1">
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={tts}
            onChange={(e) => setTts(e.target.checked)}
            className="accent-purple-500"
          />
          <Mic className="h-3.5 w-3.5 text-emerald-400" />
          <span className="text-xs text-slate-300 font-medium">Also speak via TTS</span>
        </label>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 border border-slate-700 text-slate-300 hover:text-slate-100 transition-colors flex items-center gap-1.5"
          >
            <X className="h-3.5 w-3.5" /> Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!valid}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-purple-600/20 border border-purple-500/40 text-purple-300 hover:bg-purple-600/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
          >
            <Check className="h-3.5 w-3.5" /> Save
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── New command builder form ─────────────────────────────────────────────────

function NewCommandForm({ onAdd }: { onAdd: (cmd: CustomCommand) => void }) {
  const blank: CustomCommand = {
    id: '',
    trigger: '',
    response: '',
    allowedBadges: [...ALL_BADGES],
    tts: false,
    enabled: true,
    description: '',
  };

  const [open, setOpen]             = useState(false);
  const [trigger, setTrigger]       = useState('');
  const [response, setResponse]     = useState('');
  const [desc, setDesc]             = useState('');
  const [badges, setBadges]         = useState<CommandPermissionLevel[]>([...ALL_BADGES]);
  const [tts, setTts]               = useState(false);

  const valid = trigger.trim().length > 0 && response.trim().length > 0;

  const reset = () => {
    setTrigger(''); setResponse(''); setDesc('');
    setBadges([...ALL_BADGES]); setTts(false);
  };

  const handleAdd = () => {
    if (!valid) return;
    onAdd({
      id: 'cc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      trigger: normaliseTrigger(trigger),
      response: response.trim(),
      description: desc.trim() || undefined,
      allowedBadges: badges,
      tts,
      enabled: true,
    });
    reset();
    setOpen(false);
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-purple-600/10 hover:bg-purple-600/20 border border-purple-500/30 hover:border-purple-500/50 text-purple-300 rounded-xl text-xs font-semibold transition-all"
      >
        <Plus className="h-4 w-4" /> Add New Command
      </button>
    );
  }

  return (
    <div className="bg-slate-950 border border-purple-500/40 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-bold text-purple-300 flex items-center gap-1.5">
          <Plus className="h-3.5 w-3.5" /> New Custom Command
        </span>
        <button type="button" onClick={() => { reset(); setOpen(false); }} className="text-slate-500 hover:text-slate-300 transition-colors">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-[10px] font-semibold text-slate-400 uppercase mb-1">Trigger</label>
          <input
            value={trigger}
            onChange={(e) => setTrigger(e.target.value)}
            placeholder="!hello"
            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-purple-500/60 placeholder-slate-600"
          />
        </div>
        <div>
          <label className="block text-[10px] font-semibold text-slate-400 uppercase mb-1">Description (optional)</label>
          <input
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            placeholder="Greet the chat"
            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-purple-500/60 placeholder-slate-600"
          />
        </div>
      </div>

      <div>
        <label className="block text-[10px] font-semibold text-slate-400 uppercase mb-1">
          Response <span className="normal-case text-slate-500 font-normal">— use <code className="text-amber-300">&#123;user&#125;</code> for the sender's name</span>
        </label>
        <textarea
          rows={2}
          value={response}
          onChange={(e) => setResponse(e.target.value)}
          placeholder="Hey {user}, welcome to the stream!"
          className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-purple-500/60 placeholder-slate-600 resize-none"
        />
      </div>

      <div>
        <label className="block text-[10px] font-semibold text-slate-400 uppercase mb-1.5">Who can use this command</label>
        <BadgePicker value={badges} onChange={setBadges} />
        {badges.length === 0 && (
          <p className="text-[10px] text-rose-400 mt-1">No badges selected — command will be disabled.</p>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 pt-1">
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={tts}
            onChange={(e) => setTts(e.target.checked)}
            className="accent-purple-500"
          />
          <Mic className="h-3.5 w-3.5 text-emerald-400" />
          <span className="text-xs text-slate-300 font-medium">Also speak via TTS</span>
        </label>

        <button
          type="button"
          onClick={handleAdd}
          disabled={!valid}
          className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-purple-600/20 border border-purple-500/40 text-purple-300 hover:bg-purple-600/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
        >
          <Plus className="h-3.5 w-3.5" /> Add Command
        </button>
      </div>
    </div>
  );
}

// ─── Main tab component ───────────────────────────────────────────────────────

export interface CustomCommandsTabProps {
  commands: CustomCommand[];
  onCommandsChange: (cmds: CustomCommand[]) => void;
}

export function CustomCommandsTab({ commands, onCommandsChange }: CustomCommandsTabProps) {
  const [editingId, setEditingId] = useState<string | null>(null);

  const handleAdd = (cmd: CustomCommand) => {
    onCommandsChange([...commands, cmd]);
  };

  const handleDelete = (id: string) => {
    onCommandsChange(commands.filter((c) => c.id !== id));
    if (editingId === id) setEditingId(null);
  };

  const handleToggleEnabled = (id: string) => {
    onCommandsChange(commands.map((c) => (c.id === id ? { ...c, enabled: !c.enabled } : c)));
  };

  const handleSaveEdit = (updated: CustomCommand) => {
    onCommandsChange(commands.map((c) => (c.id === updated.id ? updated : c)));
    setEditingId(null);
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl flex flex-col h-full">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="px-6 py-5 border-b border-slate-800 shrink-0 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-purple-500/10 text-purple-400 rounded-xl">
            <Terminal className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-100">Custom Command Builder</h3>
            <p className="text-xs text-slate-400">
              Create chat commands that trigger an automatic response.&nbsp;
              Use&nbsp;<code className="text-amber-300">&#123;user&#125;</code> in your response to mention the sender.
            </p>
          </div>
        </div>

        {commands.length > 0 && (
          <span className="text-[11px] font-semibold text-slate-400 bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1 shrink-0">
            {commands.filter((c) => c.enabled).length} / {commands.length} active
          </span>
        )}
      </div>

      {/* ── Scrollable command list ─────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto no-scrollbar p-6 space-y-3">

        {commands.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-slate-500">
            <Terminal className="h-10 w-10 text-slate-700" />
            <p className="text-sm font-semibold">No custom commands yet</p>
            <p className="text-xs text-slate-600">Use the builder below to create your first command.</p>
          </div>
        )}

        {commands.map((cmd) => {
          if (editingId === cmd.id) {
            return (
              <EditRow
                key={cmd.id}
                initial={cmd}
                onSave={handleSaveEdit}
                onCancel={() => setEditingId(null)}
              />
            );
          }

          return (
            <div
              key={cmd.id}
              className={`bg-slate-950 border rounded-xl px-4 py-3 transition-colors hover:border-slate-700 ${
                cmd.enabled ? 'border-slate-800' : 'border-slate-800/50 opacity-60'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                {/* Left: trigger + meta */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="font-mono text-xs font-bold text-purple-300">{cmd.trigger}</span>
                    {cmd.tts && (
                      <span className="flex items-center gap-1 text-[10px] font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded px-1.5 py-0.5">
                        <Mic className="h-3 w-3" /> TTS
                      </span>
                    )}
                    {!cmd.enabled && (
                      <span className="text-[10px] font-semibold text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded px-1.5 py-0.5">
                        Disabled
                      </span>
                    )}
                    {cmd.allowedBadges.length === 0 && (
                      <span className="text-[10px] font-semibold text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded px-1.5 py-0.5">
                        No permission
                      </span>
                    )}
                  </div>

                  {cmd.description && (
                    <p className="text-[10px] text-slate-500 mb-1">{cmd.description}</p>
                  )}

                  <p className="text-xs text-slate-300 truncate">
                    <span className="text-slate-500 mr-1">→</span>
                    {cmd.response}
                  </p>

                  {cmd.allowedBadges.length > 0 && cmd.allowedBadges.length < ALL_BADGES.length && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {cmd.allowedBadges.map((b) => {
                        const s = BADGE_STYLES[b];
                        return (
                          <span key={b} className={`flex items-center gap-1 text-[10px] font-semibold rounded-full px-2 py-0.5 border ${s.pill}`}>
                            <span className={`w-1 h-1 rounded-full ${s.dot}`} />{b}
                          </span>
                        );
                      })}
                    </div>
                  )}
                  {cmd.allowedBadges.length === ALL_BADGES.length && (
                    <span className="mt-1 inline-block text-[10px] text-slate-500">Everyone can use this</span>
                  )}
                </div>

                {/* Right: action buttons */}
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleToggleEnabled(cmd.id)}
                    title={cmd.enabled ? 'Disable command' : 'Enable command'}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-colors ${
                      cmd.enabled
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/20'
                        : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {cmd.enabled ? 'On' : 'Off'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingId(cmd.id)}
                    title="Edit command"
                    className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 border border-transparent hover:border-slate-700 transition-colors"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(cmd.id)}
                    title="Delete command"
                    className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 border border-transparent hover:border-rose-500/20 transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}

        {/* ── Add new command form ───────────────────────────────────────── */}
        <NewCommandForm onAdd={handleAdd} />
      </div>
    </div>
  );
}
