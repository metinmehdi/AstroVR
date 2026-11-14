/**
 * Preload the real NASA window film into memory long before liftoff (Mission Control: on page load; phone: on
 * START, while the story plays and the cadet waits on the pad). A blob URL plays instantly and never stalls on
 * venue Wi-Fi. Until it is ready, the normal URL is used. Progress is reported for the lobby readiness chip.
 */
import { FILM_URL } from './flightFilm';

let blobUrl: string | null = null;
let loading: Promise<string> | null = null;
let progress = 0;
const listeners = new Set<(p: number) => void>();

function emit(p: number) {
  progress = p;
  listeners.forEach((l) => l(p));
}

/** subscribe to download progress (0..1); returns an unsubscribe function */
export function onFilmProgress(l: (p: number) => void): () => void {
  listeners.add(l);
  l(progress);
  return () => listeners.delete(l);
}

export function preloadFilm(): Promise<string> {
  if (blobUrl) return Promise.resolve(blobUrl);
  if (!loading) {
    loading = (async () => {
      const r = await fetch(FILM_URL);
      if (!r.ok || !r.body) throw new Error(String(r.status));
      const total = Number(r.headers.get('content-length')) || 0;
      const reader = r.body.getReader();
      const chunks: Uint8Array[] = [];
      let got = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        got += value.length;
        if (total) emit(Math.min(0.99, got / total));
      }
      blobUrl = URL.createObjectURL(new Blob(chunks as BlobPart[], { type: 'video/mp4' }));
      emit(1);
      return blobUrl;
    })().catch(() => {
      loading = null; // try again next time
      return FILM_URL;
    });
  }
  return loading;
}

/** the best source right now: the in-memory copy if it is ready */
export function filmSrc(): string {
  return blobUrl ?? FILM_URL;
}

export function filmReady(): boolean {
  return blobUrl !== null;
}
