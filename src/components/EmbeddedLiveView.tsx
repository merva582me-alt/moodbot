import React, { useState, useEffect } from 'react';
import { Tv, Youtube } from 'lucide-react';
import { ElectronBrowserView } from './ElectronBrowserView';

const MEETME_HOMEPAGE     = 'https://app.meetme.com';
const MEETME_TRENDING_URL = 'https://app.meetme.com/live/search/trending/all';
const YOUTUBE_INITIAL_URL = 'https://www.youtube.com';

interface EmbeddedLiveViewProps {
  streamTabActive: boolean;
}

export function EmbeddedLiveView({ streamTabActive }: EmbeddedLiveViewProps) {
  const [activeTab, setActiveTab] = useState<'meetme' | 'youtube'>('meetme');
  // null = still resolving; once resolved holds the URL to pass to ElectronBrowserView
  const [meetmeInitialUrl, setMeetmeInitialUrl] = useState<string | null>(null);

  useEffect(() => {
    if (window.electronAPI?.getMeetMeInitialUrl) {
      window.electronAPI.getMeetMeInitialUrl()
        .then((url: string) => setMeetmeInitialUrl(url))
        .catch(() => setMeetmeInitialUrl(MEETME_TRENDING_URL));
    } else {
      setMeetmeInitialUrl(MEETME_TRENDING_URL);
    }
  }, []);

  function switchTab(tab: 'meetme' | 'youtube') {
    setActiveTab(tab);
    window.electronAPI?.bringViewToFront({ viewId: tab });
  }


  return (
    <div className="bg-slate-900 border border-slate-800 flex-1 flex flex-col" style={{ overflow: 'hidden', position: 'relative', borderRadius: '12px 12px 0 0', minHeight: 0 }}>

      {/* Tab bar */}
      <div className="bg-slate-950 border-b border-slate-800 px-3 pt-2 flex items-center gap-1.5 shrink-0" style={{ borderRadius: '12px 12px 0 0' }}>
        <button
          onClick={() => switchTab('meetme')}
          className={`px-4 py-2 rounded-t-xl text-xs font-bold flex items-center gap-2 border-t border-x transition-all cursor-pointer ${
            activeTab === 'meetme'
              ? 'bg-slate-900 text-purple-300 border-slate-800'
              : 'bg-slate-950/60 text-slate-400 hover:text-slate-200 border-transparent hover:bg-slate-900/40'
          }`}
        >
          <Tv className="h-3.5 w-3.5 text-purple-400" />
          Livestream
        </button>
        <button
          onClick={() => switchTab('youtube')}
          className={`px-4 py-2 rounded-t-xl text-xs font-bold flex items-center gap-2 border-t border-x transition-all cursor-pointer ${
            activeTab === 'youtube'
              ? 'bg-slate-900 text-rose-300 border-slate-800'
              : 'bg-slate-950/60 text-slate-400 hover:text-slate-200 border-transparent hover:bg-slate-900/40'
          }`}
        >
          <Youtube className="h-3.5 w-3.5 text-rose-500" />
          YouTube
        </button>
      </div>

      {/* Content area */}
      <div className="flex-1 relative bg-slate-950" style={{ overflow: 'hidden' }}>

        {/* Livestream panel */}
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
          visibility: activeTab === 'meetme' ? 'visible' : 'hidden',
          pointerEvents: activeTab === 'meetme' ? 'auto' : 'none',
        }}>
          <div style={{ flex: 1, position: 'relative' }}>
            {meetmeInitialUrl !== null && (
              <ElectronBrowserView
                src={meetmeInitialUrl}
                viewId="meetme"
                partition="persist:meetme"
                active={streamTabActive && activeTab === 'meetme'}
              />
            )}
          </div>
        </div>

        {/* YouTube panel */}
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
          visibility: activeTab === 'youtube' ? 'visible' : 'hidden',
          pointerEvents: activeTab === 'youtube' ? 'auto' : 'none',
        }}>
          <div style={{ flex: 1, position: 'relative' }}>
            <ElectronBrowserView
              src={YOUTUBE_INITIAL_URL}
              viewId="youtube"
              partition="persist:youtube"
              active={streamTabActive && activeTab === 'youtube'}
            />
          </div>
        </div>

      </div>
    </div>
  );
}
