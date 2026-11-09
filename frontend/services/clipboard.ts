// Copia negli appunti un testo che arriva dal database. Su iPhone la copia deve partire subito dal tocco:
// per questo si passa a Safari una promessa (ClipboardItem) invece di aspettare la risposta.
export async function copyText(text: Promise<string>) {
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    try { await navigator.clipboard.write([new ClipboardItem({ 'text/plain': text.then(t => new Blob([t], { type: 'text/plain' })) })]); return; } catch { /* si prova con writeText */ }
  }
  await navigator.clipboard.writeText(await text);
}
