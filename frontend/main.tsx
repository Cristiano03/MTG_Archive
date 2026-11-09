import { createRoot } from 'react-dom/client';
import App from './App';
import '@fontsource/barlow-condensed/latin-700.css';
import './style.css';
import { initTheme } from './services/theme';
initTheme(); // colori del tema prima di disegnare la pagina
createRoot(document.getElementById('root')!).render(<App />);
// Il service worker funziona solo in un contesto sicuro (HTTPS o localhost)
if ('serviceWorker' in navigator && isSecureContext)
  addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(e => console.warn('Service worker non registrato', e)));
