import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// Il sito parla direttamente con Supabase (URL e chiave in frontend/.env): in locale basta `npm run dev:web`.
// Il server di sviluppo ascolta solo su 127.0.0.1; dal telefono si arriva tramite Tailscale (*.ts.net, HTTPS), vedi docs/telefono.md.
export default defineConfig({ plugins: [react()], optimizeDeps: { include: ['tesseract.js'] }, server: { host: '127.0.0.1', strictPort: true, allowedHosts: ['.ts.net'],
  // anteprima locale (npm run anteprima): le operazioni vanno al database temporaneo di tests/anteprima.ts
  proxy: process.env.VITE_DEMO === '1' ? { '/__mock': 'http://127.0.0.1:5180' } : undefined } });
