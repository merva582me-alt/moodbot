import React, { useState, useEffect } from 'react';

interface LicenseGateProps {
  onLicensed: () => void;
}

type Screen = 'checking' | 'activate' | 'revoked' | 'offline_warning';

export function LicenseGate({ onLicensed }: LicenseGateProps) {
  const [screen,   setScreen]   = useState<Screen>('checking');
  const [keyInput, setKeyInput] = useState('');
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);
  const [hwid,     setHwid]     = useState('');
  const [revokedMsg, setRevokedMsg] = useState('');
  const [offlineHours, setOfflineHours] = useState(0);

  // ── On mount: run the initial license check — runs exactly once ────────
  useEffect(() => {
    async function check() {
      const api = window.electronAPI;
      if (!api?.licenseCheck) {
        // Running in a browser (dev without Electron) — skip gate
        onLicensed();
        return;
      }

      const result = await api.licenseCheck();

      if (result.ok) {
        if (result.offline) {
          // Offline grace — warn briefly then let through
          setOfflineHours(result.hoursLeft ?? 0);
          setScreen('offline_warning');
          setTimeout(() => onLicensed(), 4000);
        } else {
          onLicensed();
        }
      } else {
        // Show activation screen with any pre-filled key
        if (result.storedKey) setKeyInput(result.storedKey);
        if (result.message)   setError(result.message);
        setScreen('activate');
      }

      // Also load HWID for support display
      api.licenseHwid?.().then((r: { hwid: string }) => setHwid(r?.hwid ?? ''));
    }
    check();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- intentionally runs once on mount

  // ── Subscribe to mid-session revocation ────────────────────────────────
  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onLicenseRevoked) return;
    const unsub = api.onLicenseRevoked((data: { message: string }) => {
      setRevokedMsg(data?.message ?? 'Your license has been revoked by the administrator.');
      setScreen('revoked');
    });
    return unsub;
  }, []);

  // ── Activate handler ────────────────────────────────────────────────────
  async function handleActivate() {
    const trimmed = keyInput.trim().toUpperCase();
    if (!trimmed) { setError('Please enter your license key.'); return; }
    setLoading(true);
    setError('');
    const result = await window.electronAPI?.licenseActivate(trimmed);
    setLoading(false);
    if (result?.ok) {
      onLicensed();
    } else {
      setError(result?.message ?? 'Activation failed. Please try again.');
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  //  CHECKING SCREEN
  // ────────────────────────────────────────────────────────────────────────
  if (screen === 'checking') {
    return (
      <div style={styles.backdrop}>
        <div style={styles.card}>
          <div style={styles.logo}>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" width="48" height="48">
              <defs>
                <linearGradient id="lg1" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#9333ea"/>
                  <stop offset="50%" stopColor="#ec4899"/>
                  <stop offset="100%" stopColor="#f59e0b"/>
                </linearGradient>
              </defs>
              <rect x="1" y="1" width="38" height="38" rx="10" fill="url(#lg1)"/>
              <rect x="3" y="3" width="34" height="34" rx="8" fill="#030712"/>
              <rect x="10" y="13" width="20" height="14" rx="3" fill="none" stroke="#c084fc" strokeWidth="2"/>
              <line x1="20" y1="13" x2="20" y2="9" stroke="#c084fc" strokeWidth="2"/>
              <circle cx="20" cy="8" r="1.5" fill="#c084fc"/>
            </svg>
          </div>
          <h1 style={styles.heading}>MoodBot</h1>
          <p style={{ ...styles.sub, marginTop: 8 }}>Verifying license…</p>
          <div style={styles.spinner} />
        </div>
      </div>
    );
  }

  // ────────────────────────────────────────────────────────────────────────
  //  OFFLINE WARNING (grace period active — auto-dismisses)
  // ────────────────────────────────────────────────────────────────────────
  if (screen === 'offline_warning') {
    return (
      <div style={styles.backdrop}>
        <div style={styles.card}>
          <div style={{ ...styles.iconBox, background: 'rgba(234,179,8,0.15)', border: '1px solid rgba(234,179,8,0.3)' }}>
            <span style={{ fontSize: 24 }}>⚠️</span>
          </div>
          <h1 style={styles.heading}>Offline Mode</h1>
          <p style={styles.sub}>
            MoodBot can't reach the license server.<br />
            Running in offline grace mode — <strong style={{ color: '#fbbf24' }}>{offlineHours}h remaining</strong>.
          </p>
          <p style={{ ...styles.sub, color: '#64748b', fontSize: 12 }}>Launching MoodBot…</p>
        </div>
      </div>
    );
  }

  // ────────────────────────────────────────────────────────────────────────
  //  MID-SESSION REVOCATION
  // ────────────────────────────────────────────────────────────────────────
  if (screen === 'revoked') {
    return (
      <div style={styles.backdrop}>
        <div style={styles.card}>
          <div style={{ ...styles.iconBox, background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)' }}>
            <span style={{ fontSize: 24 }}>🚫</span>
          </div>
          <h1 style={{ ...styles.heading, color: '#f87171' }}>License Revoked</h1>
          <p style={styles.sub}>{revokedMsg}</p>
          <p style={{ ...styles.sub, fontSize: 12, color: '#64748b' }}>
            Contact support if you believe this is an error.
          </p>
          <button
            style={{ ...styles.btn, background: '#1e293b', border: '1px solid #334155', color: '#94a3b8', marginTop: 20 }}
            onClick={() => {
              window.electronAPI?.licenseClear();
              setScreen('activate');
              setError('');
            }}
          >
            Enter a Different Key
          </button>
        </div>
      </div>
    );
  }

  // ────────────────────────────────────────────────────────────────────────
  //  ACTIVATION SCREEN
  // ────────────────────────────────────────────────────────────────────────
  return (
    <div style={styles.backdrop}>
      <div style={styles.card}>
        {/* Logo */}
        <div style={styles.logo}>
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" width="52" height="52">
            <defs>
              <linearGradient id="lg2" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#9333ea"/>
                <stop offset="50%" stopColor="#ec4899"/>
                <stop offset="100%" stopColor="#f59e0b"/>
              </linearGradient>
            </defs>
            <rect x="1" y="1" width="38" height="38" rx="10" fill="url(#lg2)"/>
            <rect x="3" y="3" width="34" height="34" rx="8" fill="#030712"/>
            <rect x="10" y="13" width="20" height="14" rx="3" fill="none" stroke="#c084fc" strokeWidth="2"/>
            <line x1="20" y1="13" x2="20" y2="9" stroke="#c084fc" strokeWidth="2"/>
            <circle cx="20" cy="8" r="1.5" fill="#c084fc"/>
            <rect x="13.5" y="17.5" width="3" height="3" rx=".75" fill="#c084fc"/>
            <rect x="23.5" y="17.5" width="3" height="3" rx=".75" fill="#c084fc"/>
            <line x1="15" y1="23" x2="25" y2="23" stroke="#c084fc" strokeWidth="1.8"/>
          </svg>
        </div>

        <h1 style={styles.heading}>MoodBot</h1>
        <p style={styles.sub}>The Ultimate Livestream Assistant!</p>

        <div style={styles.divider} />

        <p style={styles.label}>Enter Your License Key</p>
        <input
          style={{
            ...styles.input,
            borderColor: error ? '#ef4444' : '#334155',
          }}
          type="text"
          value={keyInput}
          onChange={e => { setKeyInput(e.target.value.toUpperCase()); setError(''); }}
          onKeyDown={e => { if (e.key === 'Enter') handleActivate(); }}
          placeholder="MBOT-XXXX-XXXX-XXXX-XXXX"
          spellCheck={false}
          autoComplete="off"
        />

        {error && (
          <div style={styles.errorBox}>
            <span style={{ color: '#f87171', marginRight: 6 }}>⚠</span>
            {error}
          </div>
        )}

        <button
          style={{
            ...styles.btn,
            opacity: loading ? 0.6 : 1,
            cursor: loading ? 'default' : 'pointer',
          }}
          onClick={handleActivate}
          disabled={loading}
        >
          {loading ? 'Activating…' : 'Activate MoodBot'}
        </button>

        {/* HWID info for support */}
        {hwid && (
          <p
            style={{ fontSize: 10, color: '#334155', marginTop: 20, cursor: 'pointer', userSelect: 'all' }}
            title="Click to copy — share with support if needed"
            onClick={() => navigator.clipboard.writeText(hwid)}
          >
            HWID: {hwid.substring(0, 16)}…
          </p>
        )}
      </div>
    </div>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────
const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position:        'fixed',
    inset:           0,
    background:      '#0f172a',
    display:         'flex',
    alignItems:      'center',
    justifyContent:  'center',
    zIndex:          9999,
  },
  card: {
    background:    '#1e293b',
    border:        '1px solid #334155',
    borderRadius:  20,
    padding:       '40px 40px 32px',
    width:         420,
    maxWidth:      '92vw',
    display:       'flex',
    flexDirection: 'column',
    alignItems:    'center',
    gap:           0,
  },
  logo: {
    marginBottom: 16,
  },
  heading: {
    fontSize:   24,
    fontWeight: 800,
    background: 'linear-gradient(135deg, #a855f7, #ec4899, #f59e0b)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor:  'transparent',
    margin: 0,
  },
  sub: {
    fontSize:   13,
    color:      '#94a3b8',
    marginTop:  6,
    textAlign:  'center',
    lineHeight: 1.5,
  },
  divider: {
    width:        '100%',
    height:       1,
    background:   '#334155',
    margin:       '24px 0 20px',
  },
  label: {
    fontSize:     11,
    fontWeight:   700,
    color:        '#64748b',
    letterSpacing:'.06em',
    textTransform:'uppercase',
    alignSelf:    'flex-start',
    marginBottom: 8,
  },
  input: {
    width:        '100%',
    padding:      '11px 14px',
    background:   '#0f172a',
    border:       '1px solid #334155',
    borderRadius: 10,
    color:        '#f1f5f9',
    fontSize:     14,
    fontFamily:   '"Courier New", monospace',
    letterSpacing:'.08em',
    outline:      'none',
    textAlign:    'center',
  },
  errorBox: {
    width:        '100%',
    marginTop:    10,
    padding:      '9px 12px',
    background:   'rgba(239,68,68,0.08)',
    border:       '1px solid rgba(239,68,68,0.25)',
    borderRadius: 8,
    fontSize:     12,
    color:        '#f87171',
    display:      'flex',
    alignItems:   'center',
  },
  btn: {
    width:         '100%',
    marginTop:     16,
    padding:       '12px 20px',
    background:    'linear-gradient(135deg, #9333ea, #ec4899)',
    border:        'none',
    borderRadius:  10,
    color:         '#fff',
    fontSize:      14,
    fontWeight:    700,
    cursor:        'pointer',
    letterSpacing: '.02em',
  },
  iconBox: {
    width:         56,
    height:        56,
    borderRadius:  16,
    display:       'flex',
    alignItems:    'center',
    justifyContent:'center',
    marginBottom:  14,
  },
  spinner: {
    width:          28,
    height:         28,
    border:         '3px solid rgba(168,85,247,0.2)',
    borderTop:      '3px solid #a855f7',
    borderRadius:   '50%',
    marginTop:      20,
    animation:      'spin 0.8s linear infinite',
  },
};

// Inject spinner keyframe globally
if (typeof document !== 'undefined') {
  const style = document.createElement('style');
  style.textContent = '@keyframes spin { to { transform: rotate(360deg); } }';
  document.head.appendChild(style);
}
