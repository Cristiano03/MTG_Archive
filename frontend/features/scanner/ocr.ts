// Fotogramma -> ritaglio della zona -> OCR (tesseract.js, caricato solo quando si apre lo scanner).
import type { Worker } from 'tesseract.js';
import { guideRect, TITLE, FOOTER } from './recognize';
type Zone = { x: number; y: number; w: number; h: number };
let nameWorker: Promise<Worker> | null = null, footWorker: Promise<Worker> | null = null;
const make = async (langs: string, psm: string, whitelist: string) => {
  const { createWorker } = await import('tesseract.js');
  const w = await createWorker(langs, 1);
  await w.setParameters({ tessedit_pageseg_mode: psm as any, tessedit_char_whitelist: whitelist, preserve_interword_spaces: '1' });
  return w;
};
export const loadOcr = () => {
  nameWorker ??= make('eng+ita', '6', "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyzÀÈÉÌÒÙàèéìòù',- ");
  footWorker ??= make('eng', '6', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/•. ');
  return Promise.all([nameWorker, footWorker]);
};
export async function stopOcr() { for (const w of [nameWorker, footWorker]) (await w?.catch(() => null))?.terminate(); nameWorker = footWorker = null; }

// Ritaglia la zona (frazioni della carta) dal fotogramma, ingrandisce, scala di grigi, contrasto, inverte se il testo è chiaro.
function crop(video: HTMLVideoElement, z: Zone) {
  const vw = video.videoWidth, vh = video.videoHeight, g = guideRect(vw, vh);
  const sx = (g.x + z.x * g.w) * vw, sy = (g.y + z.y * g.h) * vh, sw = z.w * g.w * vw, sh = z.h * g.h * vh;
  const scale = Math.max(1, 1000 / sw), cv = document.createElement('canvas');
  cv.width = Math.round(sw * scale); cv.height = Math.round(sh * scale);
  const ctx = cv.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, cv.width, cv.height);
  const im = ctx.getImageData(0, 0, cv.width, cv.height), d = im.data; let min = 255, max = 0, sum = 0;
  for (let i = 0; i < d.length; i += 4) { const y = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; d[i] = y; if (y < min) min = y; if (y > max) max = y; sum += y; }
  const mean = sum / (d.length / 4), invert = mean < 110, k = 255 / Math.max(1, max - min);
  for (let i = 0; i < d.length; i += 4) { let y = (d[i] - min) * k; if (invert) y = 255 - y; d[i] = d[i + 1] = d[i + 2] = y; }
  ctx.putImageData(im, 0, 0); return cv;
}
export async function readCard(video: HTMLVideoElement) {
  const [nw, fw] = await loadOcr();
  const [n, f] = await Promise.all([nw.recognize(crop(video, TITLE)), fw.recognize(crop(video, FOOTER))]);
  return { nameText: n.data.text, nameConf: n.data.confidence, footerText: f.data.text };
}
