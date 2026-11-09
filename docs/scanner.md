# Scanner

Apri **Scansiona**. La prima volta il browser chiede il permesso per la fotocamera e scarica i dati del riconoscimento del testo (qualche MB, poi restano in memoria).
Sul telefono serve l'indirizzo HTTPS di Tailscale (`docs/telefono.md`): senza HTTPS i browser non aprono la fotocamera.

## Come inquadrare
- Tieni la carta dentro la sagoma bianca, dritta, con la **barra del nome nel riquadro tratteggiato**.
- Luce uniforme, senza riflessi sul nome (le foil riflettono: inclinale un po'). Se c'è, usa il pulsante **Torcia**.
- Per la stampa lo scanner prova a leggere set e numero in basso a sinistra (carte recenti). Sulle carte vecchie non ci sono: la stampa proposta è la più recente e va verificata.

## Modalità
- **Singola:** inquadri e tocchi **Scatta**.
- **Continua:** la fotocamera resta aperta e ogni carta viene acquisita da sola quando la lettura è stabile. Per una seconda copia della stessa carta tocca **+1 ultima** (oppure togli e rimetti la carta).
- **Annulla ultima** toglie l'ultima acquisizione (o l'ultimo +1).

## Prima di salvare
Niente entra nella collezione finché non tocchi **Aggiungi … alla collezione**, e il pulsante resta disattivato finché ci sono carte **da verificare**:
- *nome da verificare*: la lettura era incerta. Controlla, poi **Confermo** o **Correggi** (ricerca manuale).
- *stampa da verificare*: il nome è giusto ma l'edizione è una proposta. Scegli quella giusta dal menu, oppure, se i nomi sono certi, **Confermo le stampe proposte**.
Puoi cambiare quantità e finitura (normale/foil). Le carte uguali si sommano. L'elenco resta salvato nel browser se chiudi la pagina.

## Limiti noti
- Riconosce nomi in inglese e italiano; altre lingue vanno corrette a mano.
- Carte con cornici particolari (showcase, borderless, full art, a due facce ruotate) possono richiedere la correzione manuale.
