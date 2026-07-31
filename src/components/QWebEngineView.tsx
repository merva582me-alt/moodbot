import React from 'react';
import { ElectronBrowserView } from './ElectronBrowserView';

interface QWebEngineViewProps {
  src: string;
  title?: string;
  className?: string;
  onLoad?: () => void;
  zoomLevel?: number;
}

/**
 * Legacy wrapper forwarding to ElectronBrowserView.
 */
export const QWebEngineView: React.FC<QWebEngineViewProps> = (props) => {
  return <ElectronBrowserView {...props} />;
};
