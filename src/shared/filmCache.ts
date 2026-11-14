/**
 * Preload the real NASA window film into memory long before liftoff (Mission Control: on page load; phone: on
 * START, while the story plays and the cadet waits on the pad). A blob URL plays instantly and never stalls on
 * venue Wi-Fi. Until it is ready, the normal URL is used.
 */
import { FILM_URL } from './flightFilm';

let blobUrl: string | null = null;
let loading: Promise<string> | null = null;

export function preloadFilm(): Promise<string> {
  if (blobUrl) return Promise.resolve(blobUrl);
  if (!loading) {
    loading = fetch(FILM_URL)
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.blob();
      })
      .then((b) => (blobUrl = URL.createObjectURL(b)))
      .catch(() => {
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
