# Architettura

Nessun server: il sito (React, su Firebase Hosting) parla direttamente con **Supabase** (Postgres + Auth) e con **Scryfall**.

## Livelli e dipendenze
- **Database (`supabase/schema.sql`):** tabelle, regole di sicurezza (RLS), trigger di integrità e le funzioni chiamate dal sito (`supabase.rpc`). Le funzioni interne stanno nello schema `app`, che il sito non può chiamare direttamente.
- **Frontend:** `pages → features → services/components`. Una feature non importa da un'altra feature.
  - `services/api.ts`: `api(path, method, body)`, lo stesso punto d'accesso di quando c'era il server.
  - `services/routes.ts`: le operazioni (`/collection`, `/decks/:id`, …), ognuna fatta con una funzione del database o una query sulle tabelle.
  - `services/scryfall.ts`: unico punto che parla con Scryfall per il catalogo (stampe, legalità, prezzi, riconoscimento delle liste in testo).
  - `services/validate.ts`: regole Commander calcolate dai dati del catalogo (non salvate).
  - `services/supabase.ts`: il client Supabase e la traduzione degli errori.

## Regole che non vanno rotte
1. **Copie reali** (`collection_items`), **composizione desiderata** (`deck_cards`) e **copie riservate** (`deck_assignments`) sono tre cose distinte.
2. L'impossibilità di assegnare più copie di quelle possedute è garantita dai trigger di `schema.sql`, non solo dal codice.
3. Ogni operazione che tocca più tabelle è **una** funzione del database: una chiamata = una transazione, tutto o niente.
4. La legalità si legge da Scryfall; con dati più vecchi di 7 giorni un mazzo non risulta "certificato".
5. Nel sito c'è solo la chiave pubblica di Supabase. La sicurezza vera sono le regole RLS: ogni riga di collezione, mazzi e desideri ha un `user_id` e ognuno vede e modifica solo le proprie. Il trigger delle assegnazioni impedisce di usare copie di un altro utente.
6. Il catalogo (`cards`, `printings`) è condiviso: tutti lo leggono, ma lo scrive solo il database scaricando i dati da Scryfall (`catalog_fetch`, `catalog_refresh`, estensione `http`): il sito passa solo identificativi. Limiti per account e freno alle richieste: vedi `docs/sicurezza.md`.
7. Errori delle funzioni: codici `PTnnn` (Supabase li trasforma nello stato HTTP `nnn`). Il sito li traduce in messaggi con lo stesso stato di prima (400, 404, 409).

## Cartelle storiche
`backend/` è il vecchio server per il Mac (Express + PostgreSQL incorporato). Il sito non lo usa più: resta perché contiene il database locale (`backend/.data`), e perché le prove usano il suo PostgreSQL incorporato.
