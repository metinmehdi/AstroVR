import type { Transport } from './types';
import { LocalTransport } from './local';

export type { Transport, Unsub } from './types';

export function supabaseConfigured(): boolean {
  return Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
}

/**
 * Supabase Realtime when configured (phone ↔ laptop), otherwise same-browser BroadcastChannel (dev).
 * Force local with `?transport=local` in the URL.
 */
export async function createTransport(code: string): Promise<Transport> {
  const forceLocal = new URLSearchParams(window.location.search).get('transport') === 'local';
  if (supabaseConfigured() && !forceLocal) {
    const { SupabaseTransport } = await import('./supabase');
    return new SupabaseTransport(code);
  }
  return new LocalTransport(code);
}
