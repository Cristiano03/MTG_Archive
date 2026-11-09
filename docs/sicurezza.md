# Sicurezza del sito pubblico

Il sito è aperto a tutti: chiunque può registrarsi. Ecco cosa protegge i dati e cosa va impostato nei pannelli.

## Cosa fa già il codice
- **Dati separati per account** (Row Level Security di Supabase): ognuno legge e modifica solo la propria collezione, i mazzi e i desideri. Le prove (`npm test`) lo verificano con due account.
- **Catalogo condiviso a prova di manomissione**: nomi, immagini, legalità e prezzi delle carte li scrive solo il database, scaricandoli da Scryfall (estensione `http`). Il sito manda soltanto gli identificativi delle stampe: nessun utente può falsare ciò che vedono gli altri.
- **Tabelle condivise in sola lettura** per gli utenti, cronologia non modificabile, funzioni interne (schema `app`) non chiamabili dal sito.
- **Limiti per account**: 20.000 righe di collezione, 300 mazzi, 400 carte diverse per mazzo, 3.000 desideri; quantità e lunghezza dei testi controllate; cronologia limitata alle ultime 2.000 operazioni.
- **Freno alle richieste**: al massimo 120 richieste a Scryfall al minuto per account, 75 carte per richiesta.
- **Nessuna informazione sugli account**: la pagina di accesso non dice se un'email è registrata (né in registrazione né al recupero password).
- **Password di almeno 10 caratteri**, cambio password con verifica di quella attuale, "Esci da tutti i dispositivi".
- **Eliminazione dell'account** (Account → Elimina l’account): cancella subito account e dati. **Esportazione dei dati** (CSV) e **informativa privacy** (pagina Privacy).
- **Intestazioni di sicurezza** su Firebase (`firebase.json`): CSP (il browser accetta script e connessioni solo da Supabase, Scryfall e il suo server delle immagini, jsDelivr per lo scanner e Cloudflare per l'anti-bot; il service worker scarica le immagini con fetch, quindi anche `*.scryfall.io` sta in connect-src), HSTS, blocco dell'inserimento in altri siti, fotocamera solo per questo sito, microfono e posizione disattivati.

## Da fare nel pannello di Supabase (una volta)
1. **SQL Editor**: esegui `supabase/aggiorna-sicurezza-pubblico.sql` (nei progetti nuovi basta `supabase/schema.sql`).
2. **Authentication → Sign In / Providers → Email**
   - *Allow new users to sign up*: **attivo** (sito pubblico).
   - *Confirm email*: **attivo**, così nessuno registra account con email altrui. Il servizio email incluso in Supabase ne manda pochissime all'ora: per un sito pubblico configura un **SMTP tuo** (passo 4).
   - *Minimum password length*: **10**. *Password requirements*: lettere e numeri. *Secure password change*: attivo.
3. **Authentication → URL Configuration**
   - *Site URL*: `https://mtg-commander-archive.web.app`
   - *Redirect URLs*: solo `https://mtg-commander-archive.web.app/**` (togli `localhost` se c'è).
4. **Authentication → Emails → SMTP Settings** (consigliato): un servizio come Resend o Brevo (hanno piani gratuiti). Senza, le email di conferma e di recupero password arrivano solo a poche persone all'ora.
5. **Authentication → Rate Limits**: i valori predefiniti vanno bene; se vedi registrazioni sospette abbassa *sign-ups and sign-ins*.
6. **Anti-bot (facoltativo, consigliato)**: crea un widget gratuito su Cloudflare **Turnstile** per il dominio `mtg-commander-archive.web.app`. Metti la *Secret key* in Supabase → **Authentication → Attack Protection → Enable Captcha protection** (provider Turnstile), e la *Site key* in `frontend/.env` come `VITE_TURNSTILE_SITE_KEY=...`, poi `npm run deploy`.
7. **Project Settings → API Keys**: nel sito c'è solo la chiave *publishable/anon*. La chiave *secret/service_role* non va mai messa nel sito né condivisa.

## Privacy
La pagina Privacy (`frontend/pages/PrivacyPage.tsx`) è una bozza: completa titolare e contatto (`OWNER`, `CONTACT`) e fai verificare il testo se il sito ha molti utenti. Non servono banner dei cookie: il sito salva nel browser solo sessione e preferenze tecniche.

## Costi
Supabase e Firebase restano sui piani gratuiti, che non addebitano nulla: al limite dei piani il servizio rallenta o si ferma, non arrivano fatture. Supabase gratuito mette in pausa il progetto dopo una settimana senza visite (si riattiva dal pannello).
