import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { resolve } from 'node:path';

// `npm run dev:https` serves over HTTPS on the LAN so phones (especially iPhone)
// can use the gyroscope, which requires a secure context.
export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode === 'https' ? [basicSsl()] : [])],
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        control: resolve(import.meta.dirname, 'control.html'),
        astronaut: resolve(import.meta.dirname, 'a.html'),
      },
    },
  },
}));
