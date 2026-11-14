import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { resolve } from 'node:path';
import { mintRadioToken } from './api/live-token';

/**
 * `npm run dev` has no Vercel functions, so /api/live-token (Moon Base Radio) is
 * served by the same code here. The Gemini keys stay in Node (never VITE_*).
 */
function liveTokenDev(env: Record<string, string>): Plugin {
  const handler = async (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const result = await mintRadioToken(
      { lang: url.searchParams.get('lang'), key: url.searchParams.get('key'), name: url.searchParams.get('name') },
      { ...process.env, ...env },
    );
    res.statusCode = result.status;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(result.body));
  };
  return {
    name: 'astrovr-live-token-dev',
    configureServer(server) {
      server.middlewares.use('/api/live-token', (req, res) => void handler(req, res));
    },
    configurePreviewServer(server) {
      server.middlewares.use('/api/live-token', (req, res) => void handler(req, res));
    },
  };
}

// `npm run dev:https` serves over HTTPS on the LAN so phones (especially iPhone)
// can use the gyroscope and the microphone, which require a secure context.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, import.meta.dirname, '');
  return {
    plugins: [react(), liveTokenDev(env), ...(mode === 'https' ? [basicSsl()] : [])],
    build: {
      rollupOptions: {
        input: {
          main: resolve(import.meta.dirname, 'index.html'),
          control: resolve(import.meta.dirname, 'control.html'),
          astronaut: resolve(import.meta.dirname, 'a.html'),
          radio: resolve(import.meta.dirname, 'radio.html'),
        },
      },
    },
  };
});
