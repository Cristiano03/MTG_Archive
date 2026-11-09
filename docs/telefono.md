# Usarla dal telefono come app

Una volta pubblicato il sito (vedi `docs/firebase-supabase.md`), sul telefono basta aprire il suo indirizzo (`https://nome-progetto.web.app`) e accedere con il tuo account:
- **iPhone (Safari):** Condividi → Aggiungi alla schermata Home.
- **Android (Chrome):** pulsante "Installa app" nella Home del sito, oppure menu ⋮ → Installa app.

Il sito è in HTTPS, quindi la fotocamera per lo scanner funziona.

## Cosa sapere
- Offline l'interfaccia si apre, ma i dati no: inventario e mazzi non vengono mai copiati in cache, per non mostrare quantità vecchie.
- Le immagini delle carte già viste restano in cache sul telefono (fino a circa 300).

## Provare dal telefono la versione in sviluppo (facoltativo)
Per vedere sul telefono il sito che gira sul Mac con `npm run dev` serve l'HTTPS: il modo più semplice e privato è **Tailscale** (gratuito per uso personale).
1. Installa Tailscale sul Mac e sul telefono con lo stesso account; nella console (https://login.tailscale.com/admin/dns) attiva **MagicDNS** e **HTTPS Certificates**.
2. Sul Mac, con `npm run dev` acceso: `tailscale serve --bg 5173` e apri sul telefono l'indirizzo `https://….ts.net` che stampa.
3. Per smettere: `tailscale serve reset`. Non usare `tailscale funnel`, che pubblica il sito su Internet.
