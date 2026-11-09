# MTG Commander Archive

Gestione della collezione fisica di Magic e dei mazzi Commander: inventario, copie assegnate ai mazzi, validazione delle regole, import/esportazione. Specifica: `docs/specifica-funzionale-v1.txt`.

Nessun server: il sito sta su **Firebase Hosting** (piano gratuito) e parla direttamente con **Supabase** (database e account, piano gratuito). Come pubblicarlo: `docs/firebase-supabase.md`. Sicurezza del sito pubblico: `docs/sicurezza.md`.

## Struttura
```
frontend/   React + TypeScript + Vite (il sito)
  components/  parti riusabili (ricerca carte, menu…)
  pages/       schermate (Home, Collezione, Mazzi, Altro, Scansiona, Accesso)
  features/    collection/ decks/ import/ scanner/ wishlist/ account/
  services/    api.ts + routes.ts (operazioni su Supabase), scryfall.ts, validate.ts, supabase.ts
supabase/   schema.sql: tabelle, regole di sicurezza (RLS) e funzioni, da eseguire una volta nel SQL Editor
tests/      prove dello schema e delle operazioni su un PostgreSQL temporaneo
docs/       specifica, architettura, operazioni, pubblicazione, telefono, scanner
backend/    vecchio server per il Mac (non più usato dal sito): contiene il database locale
```

## Comandi
```
npm install
npm run dev            # il sito in locale: http://127.0.0.1:5173 (serve frontend/.env con i dati di Supabase)
npm run deploy         # compila e pubblica su Firebase Hosting
npm test               # prove dello schema (sicurezza tra utenti, mazzi, importazioni, desideri, richieste simultanee)
npm run test:web       # prove di tutte le operazioni del sito (serve la rete per Scryfall)
npm run test:scanner   # logica di riconoscimento dello scanner
npm run typecheck
npm run anteprima      # il sito sul Mac con dati di esempio, senza Supabase: http://127.0.0.1:5174
```

Per installarla come app (PWA): in Chrome/Edge usa il pulsante "Installa app" nella Home; per il telefono vedi `docs/telefono.md`.

## Stato
Fatto: collezione (filtri, modifica, cambio stampa), mazzi fisici/virtuali, assegnazioni atomiche, validazione Commander, import di testo, Home con statistiche, esportazioni, account (Supabase Auth, dati separati per utente con RLS), PWA, scanner con fotocamera (vedi `docs/scanner.md`), lista dei desideri con acquisto guidato e prezzi di riferimento.
