# Pubblicare con Supabase (database e account) e Firebase (sito), tutto gratuito

- **Supabase**: il database Postgres con la collezione, i mazzi e gli account (Supabase Auth). Le regole di sicurezza (RLS) fanno vedere a ognuno solo i propri dati.
- **Firebase Hosting**: il sito. È solo un insieme di file: niente server e niente Cloud Functions, quindi basta il piano gratuito **Spark** (nessuna carta di credito).

Il sito parla direttamente con Supabase dal browser, come Chronarch. Il Mac non deve restare acceso e il sito è già in HTTPS (la fotocamera del telefono funziona).

> Supabase gratuito: i progetti **vengono messi in pausa dopo circa una settimana senza utilizzo**. Si riattivano dal pannello di Supabase (Restore project) e i dati restano.

## 1. Supabase: crea il progetto
Su https://supabase.com/dashboard crea un **nuovo progetto** (regione **Central EU (Frankfurt)**) e salva la password del database (qui non serve, ma tienila).

## 2. Supabase: crea le tabelle
1. Nel progetto apri **SQL Editor** → **New query**.
2. Apri il file `supabase/schema.sql` di questo progetto, copia **tutto** il contenuto, incollalo e premi **Run**.
3. Deve comparire *Success. No rows returned*. Va fatto **una volta sola**: una seconda esecuzione dà errore perché le tabelle esistono già.

## 3. Supabase: indirizzo e chiave pubblica
1. **Project Settings** → **API Keys** (oppure il pulsante **Connect** in alto): copia la **Publishable key** (`sb_publishable_…`). Va bene anche la vecchia chiave **anon** (`eyJ…`).
   Questa chiave è fatta per stare nel sito: la protezione dei dati la fanno le regole RLS. **Non usare mai** la chiave *secret* / *service_role*.
2. **Project Settings** → **Data API**: copia il **Project URL** (`https://xxxx.supabase.co`).
3. Nel file `frontend/.env` di questo progetto scrivi:
   ```
   VITE_SUPABASE_URL=https://xxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=sb_publishable_...
   ```

## 4. Supabase: impostazioni degli account
In **Authentication** → **Sign In / Providers** → **Email**:
- **Confirm email**: se lo lasci attivo, alla registrazione arriva un'email con un link da aprire prima di poter accedere. Il servizio email gratuito di Supabase ne manda pochissime all'ora: per un uso personale conviene **disattivarlo** (così la registrazione è immediata).

In **Authentication** → **URL Configuration**, dopo il passo 6, metti come **Site URL** l'indirizzo del sito (`https://nome-progetto.web.app`): serve ai link nelle email.

## 5. Firebase: crea il progetto e collegalo
1. Su https://console.firebase.google.com crea un **progetto** (Google Analytics e Gemini non servono). Resta sul piano gratuito **Spark**.
2. Nel Terminale, nella cartella del progetto:
   ```
   cd ~/Desktop/mtg-commander-manager
   npm install
   npm run firebase -- login
   npm run firebase -- use --add
   ```
   Con `use --add` scegli il progetto appena creato e, come nome (alias), scrivi `default`.

## 6. Pubblica
```
npm run deploy
```
Compila il sito (con l'indirizzo e la chiave di `frontend/.env`) e lo carica su Firebase Hosting. Alla fine stampa l'indirizzo, tipo `https://nome-progetto.web.app`.

## 7. Primo accesso
Apri l'indirizzo del sito e **registrati**. I dati stanno su Supabase: non c'è una sezione di backup nel sito.

## 8. Chiudere le registrazioni (consigliato)
Dopo aver creato il tuo account: Supabase → **Authentication** → **Sign In / Providers** → disattiva **Allow new users to sign up**. Chi prova a registrarsi vedrà "Le registrazioni sono chiuse".

## Aggiornamenti
Quando ricevi file nuovi: `npm install` (se è cambiato `package.json`) e `npm run deploy`.
Se cambia `supabase/schema.sql`, insieme ai file arriva anche lo script SQL da eseguire nel SQL Editor (lo schema completo va eseguito solo su un progetto nuovo).

## In locale
`npm run dev` e apri http://127.0.0.1:5173: è lo stesso sito, collegato allo stesso database Supabase.

## Prove
- `npm test`: prova lo schema su un PostgreSQL temporaneo che imita Supabase (sicurezza tra utenti, mazzi, importazioni, desideri, richieste simultanee). Non tocca Supabase.
- `npm run test:web`: prova tutte le operazioni del sito contro lo stesso database temporaneo, con Scryfall vero (serve la rete).

## Se qualcosa non va
- **"Configurazione mancante"**: `frontend/.env` è vuoto o incompleto (passo 3). Correggilo e pubblica di nuovo.
- **"Supabase non raggiungibile"**: il progetto è in pausa (riattivalo dal pannello) oppure manca la connessione.
- **"Devi prima confermare l'email"**: apri il link nell'email di Supabase, oppure disattiva *Confirm email* (passo 4) e registrati di nuovo.
- **Errori tipo "function … does not exist"**: lo script `supabase/schema.sql` non è stato eseguito (passo 2).
