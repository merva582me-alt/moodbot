import { useState, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { LicenseGate } from './components/LicenseGate.tsx';
import './index.css';

function Root() {
  const [licensed, setLicensed] = useState(false);
  return licensed ? <App /> : <LicenseGate onLicensed={() => setLicensed(true)} />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
