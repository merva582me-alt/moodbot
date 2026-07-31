import React, { useEffect, useRef } from 'react';

interface ElectronBrowserViewProps {
  src: string;
  viewId: string;
  partition: string;
  active: boolean; // when false the native view is collapsed to zero so it doesn't cover other UI
  /** Per-side insets in px to keep the native layer inside rounded borders. */
  insetTop?: number;
  insetRight?: number;
  insetBottom?: number;
  insetLeft?: number;
}

export const ElectronBrowserView: React.FC<ElectronBrowserViewProps> = ({
  src,
  viewId,
  partition,
  active,
  insetTop    = 0,
  insetRight  = 0,
  insetBottom = 0,
  insetLeft   = 0,
}) => {
  const divRef    = useRef<HTMLDivElement>(null);
  const activeRef = useRef(active);
  const isElectron = typeof window !== 'undefined' && Boolean(window.electronAPI);

  // Keep activeRef in sync with the active prop on every render
  useEffect(() => { activeRef.current = active; });

  // Subscribe to resize pings from main once on mount
  useEffect(() => {
    if (!isElectron || !window.electronAPI?.onViewRequestResize) return;
    const unsub = window.electronAPI.onViewRequestResize(() => {});
    return unsub;
  }, [isElectron]);

  // Create the view once on mount, reposition on resize. Never re-runs.
  useEffect(() => {
    if (!isElectron || !window.electronAPI) return;

    const initialPartition   = partition;
    const initialViewId      = viewId;
    const initialSrc         = src;
    const initialInsetTop    = insetTop;
    const initialInsetRight  = insetRight;
    const initialInsetBottom = insetBottom;
    const initialInsetLeft   = insetLeft;

    let rafId = 0;
    let destroyed = false;
    let viewCreated = false;

    // Kick off background load immediately, regardless of active state.
    // This ensures the view starts loading even when the tab is not visible.
    function ensureViewCreated() {
      if (viewCreated || !window.electronAPI) return;
      viewCreated = true;
      // Create the view with zero bounds so it loads in the background without
      // covering any UI. Bounds will be set to the real size once active.
      window.electronAPI.createOrUpdateWebContentsView({
        viewId: initialViewId, partition: initialPartition,
        bounds: { x: 0, y: 0, width: 0, height: 0 },
      }).catch(() => {});
      window.electronAPI.navigateWebContentsView({ viewId: initialViewId, url: initialSrc });
    }

    function sendBounds() {
      if (destroyed) return;
      const el = divRef.current;
      if (!el || !window.electronAPI) return;

      ensureViewCreated();

      // When inactive, collapse to zero so the native layer doesn't cover React UI
      if (!activeRef.current) {
        window.electronAPI!.createOrUpdateWebContentsView({
          viewId: initialViewId, partition: initialPartition,
          bounds: { x: 0, y: 0, width: 0, height: 0 },
        }).catch(() => {});
        return;
      }

      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) return;

      if (activeRef.current) {
        window.electronAPI.bringViewToFront?.({ viewId: initialViewId });
      }
      window.electronAPI!.createOrUpdateWebContentsView({
        viewId:    initialViewId,
        partition: initialPartition,
        bounds: {
          x:      Math.round(r.left   + initialInsetLeft),
          y:      Math.round(r.top    + initialInsetTop),
          width:  Math.round(r.width  - initialInsetLeft  - initialInsetRight),
          height: Math.round(r.height - initialInsetTop   - initialInsetBottom),
        },
      }).catch(() => {});
    }

    function scheduleSendBounds() {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        sendBounds();
        rafId = requestAnimationFrame(sendBounds);
      });
    }

    // Immediately kick off background load without waiting for the RAF loop.
    ensureViewCreated();
    scheduleSendBounds();

    const ro = typeof ResizeObserver !== 'undefined' && divRef.current
      ? new ResizeObserver(scheduleSendBounds)
      : null;
    ro?.observe(divRef.current!);

    window.addEventListener('resize',              scheduleSendBounds);
    window.addEventListener('moodbot:view-resize', scheduleSendBounds);

    return () => {
      destroyed = true;
      cancelAnimationFrame(rafId);
      ro?.disconnect();
      window.removeEventListener('resize',              scheduleSendBounds);
      window.removeEventListener('moodbot:view-resize', scheduleSendBounds);
      window.electronAPI?.createOrUpdateWebContentsView({
        viewId:    initialViewId,
        partition: initialPartition,
        bounds: { x: 0, y: 0, width: 0, height: 0 },
      }).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // empty deps — runs once on mount, never re-runs

  // Whenever active changes, immediately push updated bounds so the native
  // view shows/hides without waiting for the next resize event.
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('moodbot:view-resize'));
  }, [active]);

  if (isElectron) {
    return (
      <div
        ref={divRef}
        style={{ width: '100%', height: '100%', display: 'block', backgroundColor: '#090d16' }}
      />
    );
  }

  // Web preview fallback
  return (
    <iframe
      src={src}
      style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
    />
  );
};
