// Informativa sulla privacy (GDPR, art. 13). È una bozza: titolare e contatto vanno completati e il testo va verificato
// da chi gestisce il sito (vedi docs/sicurezza.md). Si legge sia prima dell'accesso sia da Account.
export const OWNER = 'Cristiano Brisco', CONTACT = 'cristianobrisco@gmail.com', UPDATED = '5 novembre 2026';
export default function Privacy() {
  return <div style={{ fontSize: 15 }}>
    <h2 style={{ marginTop: 0 }}>Informativa sulla privacy</h2>
    <p className="m">Ultimo aggiornamento: {UPDATED}</p>
    <h3>Chi tratta i dati</h3>
    <p>Il titolare è {OWNER} ({CONTACT}). MTG Commander Archive è un progetto personale e non commerciale per gestire collezioni di carte Magic e mazzi Commander.</p>
    <h3>Quali dati e perché</h3>
    <ul>
      <li><b>Account</b>: email e password (salvata solo in forma cifrata, non leggibile da nessuno), per farti accedere.</li>
      <li><b>Contenuti</b>: collezione, mazzi, lista dei desideri, note, e la cronologia delle ultime operazioni, per far funzionare il sito. Li vedi e li modifichi solo tu.</li>
      <li><b>Dati tecnici</b>: indirizzo IP e informazioni del browser registrati dai fornitori qui sotto, per sicurezza e per impedire abusi.</li>
    </ul>
    <p>La base giuridica è l’esecuzione del servizio che chiedi registrandoti (art. 6.1.b GDPR) e, per i dati tecnici, il legittimo interesse alla sicurezza (art. 6.1.f). Non ci sono pubblicità, profilazione, né cessione di dati.</p>
    <h3>Fornitori che ricevono i dati</h3>
    <ul>
      <li><b>Supabase</b> (database e account, server in Germania).</li>
      <li><b>Google Firebase Hosting</b> (pubblica le pagine del sito).</li>
      <li><b>Scryfall</b> (catalogo e prezzi delle carte): il tuo browser invia le ricerche direttamente a Scryfall.</li>
      <li><b>jsDelivr</b> (solo se usi lo scanner: scarica il programma che legge il testo delle carte).</li>
      <li><b>Cloudflare Turnstile</b> (solo se attiva la verifica anti-bot all’accesso).</li>
    </ul>
    <p>Alcuni fornitori possono trattare dati fuori dall’Unione europea, con le garanzie previste dal GDPR (clausole contrattuali standard o Data Privacy Framework).</p>
    <h3>Cookie e memoria del browser</h3>
    <p>Il sito non usa cookie di profilazione né di terze parti per la pubblicità. Nel browser salva solo ciò che serve a funzionare: la sessione di accesso e alcune preferenze (es. l’ordinamento scelto).</p>
    <h3>Per quanto tempo</h3>
    <p>Finché tieni l’account. Se lo elimini, tutti i tuoi dati vengono cancellati subito; le copie di sicurezza dei fornitori si sovrascrivono entro pochi giorni.</p>
    <h3>I tuoi diritti</h3>
    <p>Puoi vedere, scaricare (Account → I tuoi dati) e cancellare (Account → Elimina l’account) i tuoi dati in qualsiasi momento. Per accesso, rettifica, limitazione, opposizione o portabilità puoi scrivere a {CONTACT}. Puoi anche presentare reclamo al Garante per la protezione dei dati personali (garanteprivacy.it).</p>
  </div>;
}
