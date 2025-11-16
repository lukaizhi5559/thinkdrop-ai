import React from 'react';
import ReactDOM from 'react-dom/client';
import { OverlayToast } from './components/OverlayToast';

// Render the Overlay Toast (replaces hotkey-toast.html)
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <OverlayToast />
  </React.StrictMode>
);

console.log('🍞 [OVERLAY TOAST] React app mounted');
